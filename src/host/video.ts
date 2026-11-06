/**
 * Seedance 2.0 对白视频：多模态参考模式。
 *
 *   POST {base}/contents/generations/tasks
 *   {
 *     model,
 *     content: [
 *       {type:'text', text: prompt},
 *       {type:'image_url', image_url:{url}, role:'reference_image'},
 *       {type:'audio_url', audio_url:{url}, role:'reference_audio'}
 *     ],
 *     ratio, duration, resolution, generate_audio: true, watermark: false
 *   }
 *   GET {base}/contents/generations/tasks/{id}
 *
 * 参考音频只提供音色；台词由提示词里的对白决定。Seedance 2.0 要求
 * 带参考音频时至少有一个参考图片/视频，所以本模块强制至少一张参考图。
 */

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}
export interface SeedanceVideoRequest {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  duration: number
  ratio: '9:16' | '16:9'
  /** HTTP URL 或项目内相对路径。 */
  images: string[]
  /** 项目内相对路径（角色音色样音）。 */
  audios: string[]
  projectDir: string
  outFile: string
  pollSec?: number
  timeoutSec?: number
  onProgress?: (message: string, progress: number) => void
  /** 任务提交成功后立即回调，调用方应在这里持久化 taskId。 */
  onSubmitted?: (taskId: string) => void | Promise<void>
  signal?: AbortSignal
}

export interface SeedanceVideoResult {
  file: string
  bytes: number
  taskId: string
  videoUrl: string
}

function mimeOf(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.m4a': return 'audio/mp4'
    case '.aac': return 'audio/aac'
    default: return 'application/octet-stream'
  }
}

async function dataUrlOf(file: string, projectDir: string): Promise<string> {
  const root = resolve(projectDir)
  const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file)
  const rel = relative(root, absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`素材路径越界：${file}`)
  const realRoot = await realpath(root)
  const realFile = await realpath(absolute)
  const realRel = relative(realRoot, realFile)
  if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) throw new Error(`素材路径越界：${file}`)
  const bytes = await readFile(realFile)
  if (bytes.length > 22 * 1024 * 1024) throw new Error(`素材超过 22MB：${file}`)
  return `data:${mimeOf(realFile)};base64,${bytes.toString('base64')}`
}

async function mediaUrl(value: string, projectDir: string): Promise<string> {
  if (/^https?:\/\//i.test(value.trim())) return value.trim()
  return await dataUrlOf(value.trim(), projectDir)
}

function seedanceEndpoint(baseUrl: string, path: string): string {
  const raw = baseUrl.trim().replace(/\/+$/, '')
  if (raw === '') throw new Error('未配置视频接口地址（设置 → AI 短剧工坊）')
  let base = raw.replace(/\/contents\/generations\/tasks$/i, '')
  if (/\/api\/v3$/i.test(base)) {
    // 已经是 /api/v3。
  } else if (/\/api$/i.test(base)) {
    base = `${base}/v3`
  } else if (/\/v1$/i.test(base)) {
    base = base.replace(/\/v1$/i, '/api/v3')
  } else {
    base = `${base}/api/v3`
  }
  return `${base}${path}`
}

function taskIdOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  for (const key of ['id', 'task_id', 'taskId']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  const data = record.data
  if (data !== null && typeof data === 'object') {
    const nested = data as Record<string, unknown>
    for (const key of ['id', 'task_id', 'taskId']) {
      const value = nested[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return undefined
}

function statusOf(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  const data = record.data !== null && typeof record.data === 'object' ? record.data as Record<string, unknown> : undefined
  for (const candidate of [record.status, data?.status]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate.toLowerCase()
  }
  return ''
}

function videoUrlOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const candidates: unknown[] = [
    record.video_url,
    record.videoUrl,
    (record.content as Record<string, unknown> | undefined)?.video_url,
    (record.content as Record<string, unknown> | undefined)?.videoUrl,
    (record.data as Record<string, unknown> | undefined)?.video_url,
    (record.data as Record<string, unknown> | undefined)?.videoUrl,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return undefined
}

function errorOf(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '视频生成失败'
  const record = payload as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '视频生成失败'
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 500)}`)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`响应不是 JSON：${text.slice(0, 300)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function generateSeedanceVideo(request: SeedanceVideoRequest): Promise<SeedanceVideoResult> {
  if (request.apiKey.trim() === '') throw new Error('未配置视频 API Key（设置 → AI 短剧工坊）')
  if (request.model.trim() === '') throw new Error('未配置 Seedance 2.0 模型名（设置 → AI 短剧工坊）')
  if (request.prompt.trim() === '') throw new Error('分镜提示词为空：先编译提示词')
  if (request.images.length === 0) throw new Error('Seedance 2.0 至少需要一张参考图；先给这个分镜上传首帧或填参考图路径')
  const timeoutMs = Math.max(120_000, (request.timeoutSec ?? 900) * 1000)
  const pollSec = Math.max(2, request.pollSec ?? 5)
  request.onProgress?.('准备参考素材…', 0.05)
  const imageUrls = await Promise.all(request.images.slice(0, 9).map(image => mediaUrl(image, request.projectDir)))
  const audioUrls = await Promise.all(request.audios.slice(0, 3).map(audio => mediaUrl(audio, request.projectDir)))
  const body = {
    model: request.model.trim(),
    content: [
      { type: 'text', text: request.prompt.trim() },
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })),
      ...audioUrls.map(url => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })),
    ],
    ratio: request.ratio,
    duration: Math.round(Math.min(15, Math.max(4, request.duration))),
    resolution: '720p',
    generate_audio: true,
    watermark: false,
  }
  request.onProgress?.('提交 Seedance 2.0 任务…', 0.1)
  const submitted = await fetchJson(seedanceEndpoint(request.baseUrl, '/contents/generations/tasks'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${request.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
  }, 180_000)
  const taskId = taskIdOf(submitted)
  if (taskId === undefined) throw new Error(`Seedance 没有返回任务 ID：${JSON.stringify(submitted).slice(0, 400)}`)
  await request.onSubmitted?.(taskId)
  request.onProgress?.(`任务 ${taskId} 已提交，等待生成…`, 0.15)

  const started = Date.now()
  let lastStatus = ''
  while (Date.now() - started < timeoutMs) {
    if (request.signal?.aborted === true) throw new Error('视频生成已取消')
    await delay(pollSec * 1000)
    const polled = await fetchJson(seedanceEndpoint(request.baseUrl, `/contents/generations/tasks/${encodeURIComponent(taskId)}`), {
      method: 'GET',
      headers: { authorization: `Bearer ${request.apiKey.trim()}` },
    }, 120_000)
    const status = statusOf(polled)
    if (status !== lastStatus) {
      lastStatus = status
      request.onProgress?.(`Seedance 状态：${status || '未知'}`, 0.3)
    }
    if (status === 'succeeded' || status === 'success' || status === 'completed') {
      const videoUrl = videoUrlOf(polled)
      if (videoUrl === undefined) throw new Error('Seedance 任务成功但没有 video_url')
      request.onProgress?.('下载视频…', 0.85)
      const videoResponse = await fetch(videoUrl)
      if (!videoResponse.ok) throw new Error(`下载视频失败：HTTP ${videoResponse.status}`)
      const bytes = Buffer.from(await videoResponse.arrayBuffer())
      if (bytes.length < 1024) throw new Error('下载的视频文件过小')
      await mkdir(dirname(request.outFile), { recursive: true })
      await writeFile(request.outFile, bytes)
      request.onProgress?.('视频已保存', 1)
      return { file: request.outFile, bytes: bytes.length, taskId, videoUrl }
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      throw new Error(`Seedance 任务失败：${errorOf(polled)}`)
    }
  }
  throw new Error(`Seedance 任务超时（${Math.round(timeoutMs / 60000)} 分钟）：${taskId}`)
}
