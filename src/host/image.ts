/**
 * Seedream 生图（方舟 /api/v3/images/generations）。
 *
 * 用途：角色参考图、场景/道具参考图、分镜首帧。
 * 角色/场景/道具默认文生图；分镜首帧可带角色参考图（JSON image 数组）。
 *
 * 尺寸按方舟 Seedream 的 2K 表选，避免像素总量不足被 400。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SeedreamImageRequest {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  aspect: '1:1' | '9:16' | '16:9' | '3:4' | '4:3'
  outFile: string
  signal?: AbortSignal
}

export interface SeedreamImageResult {
  file: string
  bytes: number
}

const SIZES: Record<'pro' | 'lite', Record<string, string>> = {
  pro: { '1:1': '2048x2048', '4:3': '2368x1776', '3:4': '1776x2368', '16:9': '2816x1584', '9:16': '1584x2816' },
  lite: { '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2848x1600', '9:16': '1600x2848' },
}

function endpointOf(baseUrl: string): string {
  const raw = baseUrl.trim().replace(/\/+$/, '')
  if (raw === '') throw new Error('未配置图片接口地址（设置 → AI 短剧工坊）')
  if (/\/images\/generations$/i.test(raw)) return raw
  if (/\/api\/v3$/i.test(raw)) return `${raw}/images/generations`
  if (/\/api$/i.test(raw)) return `${raw}/v3/images/generations`
  if (/\/v1$/i.test(raw)) return `${raw.replace(/\/v1$/i, '/api/v3')}/images/generations`
  return `${raw}/api/v3/images/generations`
}

function sizeOf(model: string, aspect: SeedreamImageRequest['aspect']): string {
  const family: 'pro' | 'lite' = /seedream-5-0-(pro|flash)/i.test(model) ? 'pro' : 'lite'
  return SIZES[family][aspect] ?? SIZES[family]['9:16']
}

export async function generateSeedreamImage(request: SeedreamImageRequest): Promise<SeedreamImageResult> {
  if (request.apiKey.trim() === '') throw new Error('未配置图片 API Key（设置 → AI 短剧工坊）')
  if (request.model.trim() === '') throw new Error('未配置 Seedream 模型名（设置 → AI 短剧工坊）')
  if (request.prompt.trim() === '') throw new Error('图片提示词为空')
  const size = sizeOf(request.model, request.aspect)
  const body: Record<string, unknown> = {
    model: request.model.trim(),
    prompt: request.prompt.trim(),
    n: 1,
    size,
    response_format: 'b64_json',
    sequential_image_generation: 'disabled',
    stream: false,
    watermark: false,
  }
  // 当前只用文字锁面生图；参考图/图生图后续再接。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300_000)
  let response: Response
  try {
    response = await fetch(endpointOf(request.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(`Seedream 请求失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
  const text = await response.text()
  if (!response.ok) throw new Error(`Seedream HTTP ${response.status}：${text.slice(0, 500)}`)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Seedream 返回的不是 JSON：${text.slice(0, 300)}`)
  }
  const item = (payload as { data?: Array<Record<string, unknown>> })?.data?.[0]
  const b64 = item?.b64_json
  if (typeof b64 === 'string' && b64 !== '') {
    const bytes = Buffer.from(b64, 'base64')
    if (bytes.length < 512) throw new Error(`Seedream 图片过小（${bytes.length} 字节）`)
    await mkdir(dirname(request.outFile), { recursive: true })
    await writeFile(request.outFile, bytes)
    return { file: request.outFile, bytes: bytes.length }
  }
  const url = typeof item?.url === 'string' ? item.url : ''
  if (/^https?:\/\//.test(url)) {
    const imageResponse = await fetch(url)
    if (!imageResponse.ok) throw new Error(`下载 Seedream 图片失败：HTTP ${imageResponse.status}`)
    const bytes = Buffer.from(await imageResponse.arrayBuffer())
    if (bytes.length < 512) throw new Error(`Seedream 图片过小（${bytes.length} 字节）`)
    await mkdir(dirname(request.outFile), { recursive: true })
    await writeFile(request.outFile, bytes)
    return { file: request.outFile, bytes: bytes.length }
  }
  throw new Error(`Seedream 响应里没有图片：${text.slice(0, 300)}`)
}
