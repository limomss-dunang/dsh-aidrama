/**
 * MiMo 音色设计：`mimo-v2.5-tts-voicedesign`
 *
 * 协议是 OpenAI 兼容的 /chat/completions：
 *   user      = 音色描述（年龄/性别/口音/质感…）
 *   assistant = 让这个音色说的一句样音
 *   audio     = { format: 'wav', optimize_text_preview: true }
 * 返回 choices[0].message.audio.data（base64 WAV）。
 *
 * 注意：voicedesign 不返回 voiceId，每次调用都是重新设计的音色；
 * 所以这里只负责生成「一条参考样音」，由项目保存并在后续视频生成里作为
 * reference_audio 使用。要逐句复刻对白，应改用 mimo-v2.5-tts-voiceclone。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { messageOf } from './util.ts'

export interface VoiceDesignRequest {
  baseUrl: string
  apiKey: string
  model: string
  description: string
  sampleText: string
  outFile: string
  timeoutSec?: number
  signal?: AbortSignal
}

function chatUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (base === '') throw new Error('未配置 MiMo 接口地址（设置 → AI 短剧工坊）')
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`
  if (/\/chat\/completions$/i.test(base)) return base
  return `${base}/v1/chat/completions`
}

function audioOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const choices = (payload as { choices?: Array<{ message?: Record<string, unknown> }> }).choices
  const message = choices?.[0]?.message
  if (message === undefined) return undefined
  const audio = message.audio
  if (audio !== null && typeof audio === 'object') {
    const data = (audio as { data?: unknown }).data
    if (typeof data === 'string' && data.trim() !== '') return data
  }
  return undefined
}

export async function designVoice(request: VoiceDesignRequest): Promise<{ file: string, bytes: number }> {
  const description = request.description.trim()
  const sampleText = request.sampleText.trim()
  if (description === '') throw new Error('音色描述为空：先写一句角色音色描述')
  if (sampleText === '') throw new Error('试音文本为空')
  if (request.apiKey.trim() === '') throw new Error('未配置 MiMo API Key（设置 → AI 短剧工坊）')
  const timeoutMs = Math.max(60_000, (request.timeoutSec ?? 300) * 1000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (request.signal !== undefined) {
    if (request.signal.aborted) controller.abort()
    else request.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let response: Response
  try {
    response = await fetch(chatUrl(request.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey.trim()}`,
        'api-key': request.apiKey.trim(),
      },
      body: JSON.stringify({
        model: request.model.trim() || 'mimo-v2.5-tts-voicedesign',
        messages: [
          { role: 'user', content: description },
          { role: 'assistant', content: sampleText },
        ],
        audio: { format: 'wav', optimize_text_preview: true },
        stream: false,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(`MiMo 音色设计请求失败：${messageOf(error)}`)
  } finally {
    clearTimeout(timer)
  }
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`MiMo 音色设计 HTTP ${response.status}：${text.slice(0, 500)}`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`MiMo 音色设计返回的不是 JSON：${text.slice(0, 300)}`)
  }
  const data = audioOf(payload)
  if (data === undefined) throw new Error(`MiMo 音色设计没有返回音频：${text.slice(0, 300)}`)
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 512) throw new Error(`MiMo 音色设计返回的音频过小（${bytes.length} 字节）`)
  await mkdir(dirname(request.outFile), { recursive: true })
  await writeFile(request.outFile, bytes)
  return { file: request.outFile, bytes: bytes.length }
}
