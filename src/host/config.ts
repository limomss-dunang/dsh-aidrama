/**
 * 插件配置与会话绑定。
 *
 * 位置：`~/.dsh/storages/dsh-aidrama/config.json`（与 dsh-video-replica 一致），
 * 不写 profile，不写 workspace。用户手填的模型凭据不存在这里——文本生成走
 * DSH 已配置的 llm 服务，本文件只存「选哪个 provider/model」。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DialectId, PluginConfig } from '../shared/types.ts'
import { asString, messageOf } from './util.ts'

export interface SessionBinding {
  projectId: string
  cwd: string
  boundAt: number
}

interface ConfigDocument {
  config: PluginConfig
  projectSessions: Record<string, SessionBinding>
}

export function defaultDataRoot(): string {
  return join(homedir(), '.dsh', 'storages', 'dsh-aidrama')
}

export function defaultConfig(provider = '', model = ''): PluginConfig {
  return {
    provider,
    model,
    parseProvider: '',
    parseModel: '',
    dialect: 'seedance-2.5',
    ttsBaseUrl: '',
    ttsApiKey: '',
    ttsModel: 'mimo-v2.5-tts-voicedesign',
    videoBaseUrl: '',
    videoApiKey: '',
    videoModel: '',
    imageBaseUrl: '',
    imageApiKey: '',
    imageModel: '',
    announceToAgent: true,
    dataDir: '',
  }
}

export class ConfigStore {
  private cache: ConfigDocument | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly rootProvider: () => string) {}

  get file(): string {
    return join(this.rootProvider(), 'config.json')
  }

  async read(): Promise<ConfigDocument> {
    if (this.cache !== undefined) return this.cache
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ConfigDocument>
      this.cache = {
        config: { ...defaultConfig(), ...(parsed.config ?? {}) },
        projectSessions: parsed.projectSessions ?? {},
      }
    } catch {
      this.cache = { config: defaultConfig(), projectSessions: {} }
    }
    return this.cache
  }

  async save(config: Partial<PluginConfig>): Promise<ConfigDocument> {
    const doc = await this.read()
    const next: PluginConfig = { ...doc.config, ...config }
    if (!['generic', 'seedance-2.0', 'seedance-2.5', 'minimax-h3', 'kling', 'wan-3.0'].includes(next.dialect)) {
      next.dialect = 'seedance-2.5'
    }
    const nextDoc: ConfigDocument = { config: next, projectSessions: { ...doc.projectSessions } }
    await this.persist(nextDoc)
    return nextDoc
  }

  async bind(sessionId: string, projectId: string, cwd: string): Promise<void> {
    if (sessionId.trim() === '') return
    const doc = await this.read()
    const nextDoc: ConfigDocument = {
      config: doc.config,
      projectSessions: { ...doc.projectSessions, [sessionId]: { projectId, cwd, boundAt: Date.now() } },
    }
    await this.persist(nextDoc)
  }

  async unbind(sessionId: string): Promise<void> {
    const doc = await this.read()
    const projectSessions = { ...doc.projectSessions }
    delete projectSessions[sessionId]
    await this.persist({ config: doc.config, projectSessions })
  }

  async binding(sessionId: string): Promise<SessionBinding | undefined> {
    if (sessionId.trim() === '') return undefined
    const doc = await this.read()
    return doc.projectSessions[sessionId]
  }

  /** 重启后客户端还没读到 session 时的兜底：用最近一次绑定恢复工作区。 */
  async latestBinding(): Promise<SessionBinding | undefined> {
    const doc = await this.read()
    return Object.values(doc.projectSessions).sort((a, b) => b.boundAt - a.boundAt)[0]
  }

  async persist(doc: ConfigDocument): Promise<void> {
    const body = JSON.stringify(doc, null, 2)
    const previous = this.writing.catch(() => undefined)
    const write = previous.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temp, body, 'utf8')
      await rename(temp, this.file).catch(async (error) => {
        const code = (error as { code?: string }).code
        if (code !== 'EPERM' && code !== 'EBUSY') throw error
        await writeFile(this.file, body, 'utf8')
      })
    })
    this.writing = write.catch(() => undefined)
    await write
    this.cache = doc
  }
}

export function normalizeDialect(value: unknown, fallback: DialectId): DialectId {
  const id = asString(value) as DialectId
  return (['generic', 'seedance-2.0', 'seedance-2.5', 'minimax-h3', 'kling', 'wan-3.0'].includes(id) ? id : fallback)
}
