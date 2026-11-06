/**
 * dsh-aidrama — 宿主半边。
 *
 * 注册：
 * 1. 环回桥接路由（配置、项目、生成、编译、校验、导出）；
 * 2. 系统提示能力说明（可关）；
 * 3. 两个 Agent 工具：aidrama_status / aidrama_generate。
 *
 * 关键边界：宿主不替 Agent 做创作判断；它只维护项目状态、调用 DSH 已配置
 * 的 llm 服务、跑确定性校验、落盘。浏览器半边只做界面。
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ConfigStore, defaultDataRoot } from './config.ts'
import { DshLlm } from './dsh.ts'
import { Generator } from './generator.ts'
import { validateProject } from './validator.ts'
import { ProjectStore } from './store.ts'
import { makeRoutes } from './routes.ts'
import { API } from '../shared/types.ts'
import { missingPrerequisites } from '../shared/precheck.ts'
import { asString, messageOf } from './util.ts'

export const name = 'dsh-aidrama'
export const inject = ['webServer']

export interface Config {
  enabled?: boolean
  announceToAgent?: boolean
}

export const PLUGIN_GUIDANCE = `本机已安装 dsh-aidrama 插件（AI 短剧工坊）：在侧边栏点「短剧」进入工作台（与「生图」「视频复刻」同一形态，中栏接管，不占用会话 View 标签）。
它把「构想 → 总纲 → 资产 → 分集 → 分镜 → 提示词 → 生产台账 → 质检」做成结构化制片台：
- 项目状态默认存在当前 workspace 的 .dsh-aidrama/projects/<id>/project.json；新建项目时可选择任意文件夹作为保存目录，可导出五份 Markdown；
- 新建项目可导入 TXT/Markdown/DOCX 或粘贴剧本，按「第X集 / EP01」自动拆集，解析出角色/场景/道具/分集，并把第一集跑到分镜与提示词；预览可改剧名/一句话/角色名/分集标题后确认写入；
- 解析可用专用模型（设置 → AI 短剧工坊 → 剧本解析专用模型），留空则用文本模型；
- 角色可用 MiMo「mimo-v2.5-tts-voicedesign」生成音色样音；分镜可把样音作为「reference_audio」交给 Seedance 2.0 生成带对白的视频（需手动填 MiMo 与方舟接口）；
- 图片走豆包 Seedream：角色正/侧/背三视图、场景/道具参考图、分镜首帧都可生成；提示词可改、可重抽；
- 提示词方言自动跟随视频模型（Seedance 2.0/2.5、MiniMax H3、Kling、Wan），并在提交前跑硬校验；
- 文本生成走 DSH 已配置模型（设置 → AI 短剧工坊），不需要单独填 Key；
- Agent 工具 aidrama_status / aidrama_generate 可读写当前会话绑定的项目。
用户提到「短剧 / 漫剧 / 分镜 / 提示词 / 制片台 / 剧本拆解」时可用。`

interface HostContext {
  effect: (run: () => () => void, label?: string) => unknown
  get?: (name: string) => unknown
  webServer?: { register: (route: unknown) => () => void }
  systemPrompt?: { section: (section: { name: string, order?: number, text: string }) => () => void }
  tools?: { register: (definition: Record<string, unknown>) => () => void }
  on?: (event: string, listener: () => void) => () => void
}

export function apply(ctx: HostContext, config?: Config): (() => void) | void {
  try {
    return activate(ctx, config)
  } catch (error) {
    // 插件激活失败会让宿主 startup audit 判 failed 并中断应用启动；宁可少功能不冒泡。
    console.warn('[dsh-aidrama] 激活失败（已忽略以避免阻断启动）：', messageOf(error))
  }
}

function activate(ctx: HostContext, config?: Config): (() => void) | void {
  if (config?.enabled === false) return

  const configs = new ConfigStore(() => defaultDataRoot())
  const dsh = new DshLlm((service: string) => ctx.get?.(service))
  const stores = new Map<string, ProjectStore>()
  const storeFor = (cwd: string, dataDir = ''): ProjectStore => {
    const key = `${cwd.toLowerCase()}|${dataDir.toLowerCase()}`
    let store = stores.get(key)
    if (store === undefined) {
      store = new ProjectStore(() => cwd, () => dataDir)
      stores.set(key, store)
    }
    return store
  }
  const generator = new Generator(dsh)

  ctx.effect(() => {
    let disposed = false
    const disposers: Array<() => void> = []
    void (async () => {
      try {
        const routes = makeRoutes({
          configs,
          dsh,
          storeFor,
          dataRoot: () => defaultDataRoot(),
          sessionCwd: (sessionId: string) => {
            try {
              const sessions = ctx.get?.('sessions') as { get?: (id: string) => { header?: { cwd?: string } } | undefined } | undefined
              const cwd = sessions?.get?.(sessionId)?.header?.cwd
              return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
            } catch {
              return undefined
            }
          },
          homeCwd: () => join(defaultDataRoot(), 'workspace'),
        })
        if (ctx.webServer === undefined) {
          console.warn('[dsh-aidrama] webServer 服务不可用：会话视图将无法连接宿主')
          return
        }
        for (const route of routes) {
          const dispose = ctx.webServer.register(route)
          if (disposed) dispose()
          else disposers.push(dispose)
        }
        console.log(`[dsh-aidrama] 已挂载 ${disposers.length} 条桥接路由`)
      } catch (error) {
        console.warn('[dsh-aidrama] 路由挂载失败：', messageOf(error))
      }
    })()
    return () => {
      disposed = true
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // 卸载期间路由可能已随 webServer 销毁
        }
      }
    }
  }, 'dsh-aidrama: bridge routes')

  const registerAnnounce = (): void => {
    try {
      const systemPrompt = ctx.get?.('systemPrompt') as {
        section: (section: { name: string, order?: number, text: string }) => () => void
      } | undefined
      const dispose = systemPrompt?.section({
        name: 'plugin:dsh-aidrama',
        order: 62,
        text: PLUGIN_GUIDANCE,
      })
      if (typeof dispose === 'function') ctx.effect(() => dispose, 'dsh-aidrama: system prompt section')
    } catch (error) {
      console.warn('[dsh-aidrama] 系统提示注册失败（不影响功能）：', messageOf(error))
    }
  }
  // 以持久化配置为准（设置页写入 config.json）；修改后需重载插件/重启生效。
  void configs.read().then(doc => {
    if (doc.config.announceToAgent) registerAnnounce()
  }).catch(error => {
    console.warn('[dsh-aidrama] 读取宣告配置失败：', messageOf(error))
  })

  registerTools(ctx, configs, generator)

  return () => {
    stores.clear()
  }
}

/* ------------------------------------------------------------------ */
/* Agent 工具                                                          */
/* ------------------------------------------------------------------ */

interface ToolContext {
  agent?: { id: string }
  signal?: AbortSignal
}

function textResult(text: string): Array<{ type: 'text', text: string }> {
  return [{ type: 'text', text }]
}

function registerTools(ctx: HostContext, configs: ConfigStore, generator: Generator): void {
  let tools: { register: (definition: Record<string, unknown>) => () => void } | undefined
  try {
    tools = ctx.get?.('tools') as typeof tools
  } catch {
    tools = undefined
  }
  if (tools === undefined || typeof tools.register !== 'function') return

  const resolve = async (sessionId: string) => {
    const binding = await configs.binding(sessionId)
    if (binding === undefined) {
      throw new Error('当前会话还没有绑定短剧项目。请先在侧边栏「短剧」工作台里新建或打开一个项目。')
    }
    const doc = await configs.read()
    const store = new ProjectStore(() => binding.cwd, () => doc.config.dataDir)
    const project = await store.read(binding.projectId)
    return { binding, store, project }
  }

  const disposers: Array<() => void> = []
  try {
    disposers.push(tools.register({
      name: 'aidrama_status',
      description: '读取当前会话绑定的 AI 短剧项目摘要：标题、阶段、集数、分镜数、校验错误与下一步建议。不修改任何文件。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        render: (_args: unknown, value: Record<string, unknown>) => textResult(asString(value?.text)),
      },
      execute: async (_args: unknown, exec: ToolContext) => {
        const sessionId = asString(exec.agent?.id)
        if (sessionId === '') throw new Error('缺少会话上下文')
        const { project } = await resolve(sessionId)
        const validation = validateProject(project)
        const shots = project.episodes.reduce((sum, episode) => sum + episode.shots.length, 0)
        const compiled = project.episodes.reduce((sum, episode) => sum + episode.shots.filter(shot => shot.prompt.text.trim() !== '').length, 0)
        const errorList = validation.findings.filter(item => item.level === 'error').slice(0, 8)
        const text = [
          `项目《${project.title}》（${project.id}）`,
          `一句话：${project.meta.logline || '待补'}`,
          `集数：${project.episodes.length}｜分镜：${shots}｜已编译：${compiled}`,
          `题材/平台：${project.meta.genre} / ${project.meta.platform}；单集 ${project.meta.episodeSeconds}s`,
          `校验：${validation.errors} error / ${validation.warns} warn`,
          ...(errorList.length === 0 ? [] : ['', '必须先修的 error：', ...errorList.map(item => `- [${item.ruleId}] ${item.message}${item.shotId === undefined ? '' : `（${item.shotId}）`}`)]),
          '',
          '下一步建议：',
          project.meta.logline.trim() === '' ? '- 先在「构想」补一句话（主角+目标+阻碍+代价）' : '',
          project.bible.premise.trim() === '' ? '- 生成总纲' : '',
          project.characters.length === 0 ? '- 生成角色资产并锁定锁面' : '',
          project.episodes.length === 0 ? '- 生成第一集' : '',
          project.episodes[0] !== undefined && project.episodes[0].shots.length === 0 ? '- 拆分第一集分镜' : '',
          compiled < shots ? '- 选择方言并编译提示词，再处理校验 error' : '',
        ].filter((line): line is string => typeof line === 'string' && line !== '').join('\n')
        return { text }
      },
    }))

    disposers.push(tools.register({
      name: 'aidrama_generate',
      description: '为当前会话绑定的短剧项目生成某个阶段（总纲/角色/场景/道具/一集/分镜），写入 project.json 并返回摘要。生成走 DSH 已配置模型，会消耗 token。',
      parameters: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            enum: ['bible', 'characters', 'scenes', 'props', 'episode', 'shots'],
            description: '要生成的阶段',
          },
          episodeId: { type: 'string', description: '分集阶段/分镜阶段的目标集，如 EP001；省略时用第一集或新建一集' },
          instruction: { type: 'string', description: '本轮额外要求，如「节奏更快」「主角改成女性」' },
        },
        required: ['stage'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        render: (_args: unknown, value: Record<string, unknown>) => textResult(asString(value?.text)),
      },
      execute: async (args: unknown, exec: ToolContext) => {
        const input = (args !== null && typeof args === 'object') ? args as Record<string, unknown> : {}
        const stage = asString(input.stage) as 'bible' | 'characters' | 'scenes' | 'props' | 'episode' | 'shots'
        if (!['bible', 'characters', 'scenes', 'props', 'episode', 'shots'].includes(stage)) throw new Error('未知阶段')
        const sessionId = asString(exec.agent?.id)
        if (sessionId === '') throw new Error('缺少会话上下文')
        const { binding, store, project } = await resolve(sessionId)
        const episodeId = asString(input.episodeId).trim()
        const missing = missingPrerequisites(project, stage, episodeId)
        if (missing.length > 0) throw new Error(`前置条件未满足：${missing.join('、')}`)
        const doc = await configs.read()
        const defaultSelection = (ctx.get?.('agentDefaultModel') as { currentSelection?: () => { provider?: string, model?: string } } | undefined)?.currentSelection?.() ?? {}
        const provider = doc.config.provider.trim() || asString(defaultSelection.provider)
        const model = doc.config.model.trim() || asString(defaultSelection.model)
        const outcome = await generator.generate({
          project,
          stage,
          episodeId: episodeId || undefined,
          instruction: asString(input.instruction).trim() || undefined,
          provider,
          model,
        }, exec.signal)
        const saved = await store.save(outcome.project, project.revision)
        const validation = validateProject(saved)
        await configs.bind(sessionId, saved.id, binding.cwd)
        const text = [
          `已生成「${stage}」并保存。`,
          outcome.notes,
          `token：in ${outcome.usage.inputTokens} / out ${outcome.usage.outputTokens}`,
          `校验：${validation.errors} error / ${validation.warns} warn`,
        ].filter(Boolean).join('\n')
        return { text }
      },
    }))
  } catch (error) {
    console.warn('[dsh-aidrama] Agent 工具注册失败（不影响界面）：', messageOf(error))
  }

  if (disposers.length > 0) {
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // 卸载期间忽略
        }
      }
    }, 'dsh-aidrama: agent tools')
  }
}

// 保持 shared API 常量被引用，避免构建器把仅类型依赖摇掉（同时导出给测试）。
export const ROUTES = API

// 供宿主日志/诊断使用。
export const __internals = { defaultDataRoot, mkdir }
