/**
 * DSH 已配置模型接入层（文本）。
 *
 * 与 dsh-video-replica 的 DshModels 同源思路：设置里不重复填密钥，直接读
 * DSH「设置 → 模型」里的提供商 / 模型 / 凭据，走宿主 `llm.stream`。
 * 图像/视频/语音不在 v0.1 范围，因此这里只保留文本能力。
 */

import type { DshModelCatalog, DshModelOption, DshProviderOption } from '../shared/types.ts'
import { asString, messageOf } from './util.ts'

interface LlmProviderInfo { id?: unknown, name?: unknown }
interface LlmModelInfo { id?: unknown, name?: unknown, inputModalities?: unknown }
interface LlmStreamChunk {
  type?: unknown
  text?: unknown
  reason?: { kind?: unknown, failure?: { message?: unknown } }
  usage?: { inputTokens?: unknown, outputTokens?: unknown }
}
interface LlmService {
  listProviders?: () => LlmProviderInfo[]
  listModels?: (provider: string) => Promise<LlmModelInfo[]>
  stream?: (options: Record<string, unknown>) => AsyncIterable<LlmStreamChunk>
}
interface AgentDefaultModelService {
  currentSelection?: () => { provider?: unknown, model?: unknown, providerId?: unknown, modelId?: unknown } | undefined
}

function optional<T>(get: (name: string) => unknown, name: string): T | undefined {
  try {
    return get(name) as T | undefined
  } catch {
    return undefined
  }
}

function toModalities(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export interface ChatRequest {
  provider: string
  model: string
  label: string
  system?: string
  user: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface ChatReply {
  text: string
  usage: { inputTokens: number, outputTokens: number }
  finish: string
}

export class DshLlm {
  private catalogCache: { at: number, value: DshModelCatalog } | undefined

  constructor(private readonly get: (name: string) => unknown) {}

  private llm(): LlmService | undefined {
    return optional<LlmService>(this.get, 'llm')
  }

  get available(): boolean {
    return typeof this.llm()?.stream === 'function'
  }

  defaultSelection(): { provider: string, model: string } | undefined {
    const service = optional<AgentDefaultModelService>(this.get, 'agentDefaultModel')
    try {
      const selection = service?.currentSelection?.()
      const provider = asString(selection?.provider ?? selection?.providerId).trim()
      const model = asString(selection?.model ?? selection?.modelId).trim()
      if (provider !== '' && model !== '') return { provider, model }
    } catch {
      // 版本差异：读不到就当没有默认值
    }
    return undefined
  }

  async catalog(force = false): Promise<DshModelCatalog> {
    if (!force && this.catalogCache !== undefined && Date.now() - this.catalogCache.at < 60_000) {
      return this.catalogCache.value
    }
    const errors: string[] = []
    const providers: DshProviderOption[] = []
    const llm = this.llm()
    if (llm === undefined) {
      const value = { providers, errors: ['DSH 的 llm 服务不可用'] }
      this.catalogCache = { at: Date.now(), value }
      return value
    }
    let declared: Array<{ id: string, name: string }> = []
    try {
      declared = (llm.listProviders?.() ?? [])
        .map(entry => ({ id: asString(entry?.id).trim(), name: asString(entry?.name).trim() }))
        .filter(entry => entry.id !== '')
    } catch (error) {
      errors.push(`读取提供商列表失败：${messageOf(error)}`)
    }
    const results = await Promise.all(declared.map(async (provider) => {
      const models: DshModelOption[] = []
      let error: string | undefined
      try {
        const listed = await Promise.resolve(llm.listModels?.(provider.id) ?? [])
        for (const model of listed) {
          const id = asString(model?.id).trim()
          if (id === '') continue
          models.push({ id, name: asString(model?.name).trim() || id, modalities: toModalities(model?.inputModalities) })
        }
      } catch (cause) {
        error = messageOf(cause)
      }
      return {
        id: provider.id,
        name: provider.name || provider.id,
        models: models.sort((a, b) => a.id.localeCompare(b.id)),
        routeReady: true,
        ...(error === undefined ? {} : { error: error.slice(0, 160) }),
      } satisfies DshProviderOption
    }))
    providers.push(...results)
    const value: DshModelCatalog = {
      providers,
      errors,
      ...(this.defaultSelection() === undefined ? {} : { default: this.defaultSelection() }),
    }
    this.catalogCache = { at: Date.now(), value }
    return value
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    const llm = this.llm()
    if (llm?.stream === undefined) {
      throw new Error(`${request.label}：DSH 的 llm 服务不可用，请先在「设置 → 模型」配置提供商`)
    }
    const provider = request.provider.trim()
    const model = request.model.trim()
    if (provider === '' || model === '') {
      throw new Error(`${request.label}：还没有选择模型（设置 → AI 短剧工坊 → 选择提供商与模型）`)
    }
    const stream = llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
      ...(request.system === undefined || request.system === '' ? {} : { system: request.system }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    let text = ''
    let inputTokens = 0
    let outputTokens = 0
    let finish = 'stop'
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') {
        text += asString(chunk.text)
        continue
      }
      if (chunk?.type === 'usage') {
        inputTokens = Number(chunk.usage?.inputTokens ?? 0) || inputTokens
        outputTokens = Number(chunk.usage?.outputTokens ?? 0) || outputTokens
        continue
      }
      if (chunk?.type === 'finish') {
        const kind = asString(chunk.reason?.kind)
        finish = kind || finish
        if (kind === 'error') {
          const detail = asString(chunk.reason?.failure?.message) || '未知错误'
          throw new Error(`${request.label}：模型调用失败（${detail}）`)
        }
        if (kind === 'aborted') throw new Error(`${request.label}：已取消`)
      }
    }
    if (text.trim() === '') throw new Error(`${request.label}：模型返回空内容`)
    return { text, usage: { inputTokens, outputTokens }, finish }
  }

  /**
   * 要求模型输出 JSON 对象；容忍 ```json 围栏与前后解释，解析失败时把错误
   * 回喂一次，最多两次。仍然失败就抛出带原文截断的错误。
   */
  async chatJson<T>(request: ChatRequest): Promise<{ value: T, usage: ChatReply['usage'] }> {
    let lastText = ''
    let lastError = ''
    let usage = { inputTokens: 0, outputTokens: 0 }
    const baseTokens = request.maxTokens ?? 4000
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const user = attempt === 0
        ? request.user
        : `${request.user}\n\n上一次输出无法解析为 JSON：${lastError}\n` +
          '请重新输出一个完整、闭合的 JSON 对象。压缩每个字段的描述，必要时减少条目数量；' +
          '不要 Markdown 围栏、不要解释、不要省略引号或括号。'
      const reply = await this.chat({
        ...request,
        user,
        // 截断时给第二次更大的预算；仍要受上游模型上限约束。
        maxTokens: attempt === 0 ? baseTokens : Math.round(baseTokens * 1.6),
      })
      lastText = reply.text
      usage = reply.usage
      if (reply.finish === 'max-tokens') {
        lastError = '输出达到 maxTokens 上限被截断'
        continue
      }
      const candidate = extractJson(reply.text)
      if (candidate !== undefined) {
        try {
          return { value: JSON.parse(candidate) as T, usage }
        } catch (error) {
          lastError = messageOf(error)
        }
      } else {
        lastError = '未找到 JSON 对象'
      }
    }
    throw new Error(`${request.label}：模型输出不是合法 JSON（${lastError}）。原文：${lastText.slice(0, 400)}`)
  }

  invalidate(): void {
    this.catalogCache = undefined
  }
}

/** 从可能带围栏/说明的文本里提取第一个平衡的 JSON 对象。 */
export function extractJson(input: string): string | undefined {
  const text = input.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced?.[1]?.trim() ?? text
  const start = body.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return body.slice(start, i + 1)
    }
  }
  return undefined
}
