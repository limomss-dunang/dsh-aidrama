/**
 * 浏览器桥接路由（loopback-only）。
 *
 * 一个路径只注册一条 WebRoute，GET/POST 在同一个 handler 里分派——宿主把
 * (kind, path) 当唯一键，重复注册会抛错。
 *
 * 客户端所有写操作都带 `cwd`（当前会话的工作目录）与 `projectId`；服务端只
 * 接受项目目录内的路径，不接受任意文件读写。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, cp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type {
  CompileRequest,
  ConfigView,
  GenerateRequest,
  GenerateStage,
  PluginConfig,
  Project,
  ValidationResult,
} from '../shared/types.ts'
import { API, DIALECTS, PLATFORMS, GENRES, dialectForVideoModel } from '../shared/types.ts'
import { missingPrerequisites } from '../shared/precheck.ts'
import { ConfigStore, defaultConfig } from './config.ts'
import type { DshLlm } from './dsh.ts'
import { Generator } from './generator.ts'
import { Importer } from './importer.ts'
import { designVoice } from './tts.ts'
import { generateSeedreamImage } from './image.ts'
import { generateSeedanceVideo } from './video.ts'
import { balanceBeats, estimateEpisodeSeconds } from './estimator.ts'
import { compileShotInto, effectiveCharacterText, shotInputHash } from './compiler.ts'
import { analyzeScript } from '../shared/script.ts'
import { validateProject } from './validator.ts'
import { exportProject } from './export.ts'
import type { ProjectStore } from './store.ts'
import { ConflictError, emptyProject, errorText, inferStage, projectsDir } from './store.ts'
import { asString, messageOf, safeProjectId } from './util.ts'

export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface RoutesDeps {
  configs: ConfigStore
  dsh: DshLlm
  dataRoot: () => string
  refreshDataRoot?: () => Promise<void>
  /** 项目存储：根目录可由设置里的 dataDir 覆盖。 */
  storeFor: (cwd: string, dataDir?: string) => ProjectStore
  /** 宿主侧用 sessionId 解析会话工作目录（SessionHeader.cwd）。 */
  sessionCwd: (sessionId: string) => string | undefined
  /** 没有会话时的兜底工作目录（插件自己的 workspace）。 */
  homeCwd: () => string
}

const MAX_JSON_BYTES = 32 * 1024 * 1024

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_') || 'item'
}

function assertFresh(project: Project, body: Record<string, unknown>): void {
  if (typeof body.expectedRevision === 'number' && body.expectedRevision !== project.revision) {
    throw new ConflictError(project.revision)
  }
}

function styleForMedia(project: Project): string {
  const style = project.styles[0]
  if (style === undefined) return project.bible.visualDirection.trim()
  return [
    style.medium, style.prompt, style.palette, style.lighting, style.lens, style.texture,
  ].map(item => (item ?? '').trim()).filter(item => item !== '').join('；')
    || project.bible.visualDirection.trim()
}

function assertStyleAccepted(project: Project): void {
  const style = project.styles[0]
  if (style === undefined || style.status !== 'accepted') {
    throw new Error('风格锚还没锁定（accepted）：先在「资产 → 全局风格锚」确认风格规格并锁定，再生成图片/视频')
  }
}

function imageExtOf(bytes: Buffer): 'png' | 'jpg' | 'webp' | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return undefined
}

async function wavDurationSec(file: string): Promise<number | undefined> {  if (extname(file).toLowerCase() !== '.wav') return undefined
  const buffer = await readFile(file)
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return undefined
  let offset = 12
  let byteRate = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ' && offset + 16 <= buffer.length) byteRate = buffer.readUInt32LE(offset + 16)
    if (id === 'data' && byteRate > 0) return size / byteRate
    offset += 8 + size + (size % 2)
  }
  return undefined
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

/** 是否本机回环请求（浏览器桥接只对本机开放）。 */
export function isLoopbackRequest(request: {
  socket?: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
}): boolean {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  const hostValue = Array.isArray(host) ? host[0] : host
  if (typeof hostValue !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${hostValue}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const originHeader = request.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function requireCwd(value: unknown): string {
  const cwd = asString(value).trim()
  if (cwd === '' || !isAbsolute(cwd) || cwd.includes('\u0000')) throw new Error('缺少合法的会话工作目录 cwd')
  if (!existsSync(cwd)) throw new Error(`工作目录不存在：${cwd}`)
  return normalize(cwd)
}

function requireString(value: unknown, label: string): string {
  const text = asString(value).trim()
  if (text === '') throw new Error(`缺少 ${label}`)
  return text
}

function asConfig(value: unknown): Partial<PluginConfig> {
  const record = (value !== null && typeof value === 'object') ? value as Record<string, unknown> : {}
  const patch: Partial<PluginConfig> = {}
  if (typeof record.provider === 'string') patch.provider = record.provider.trim()
  if (typeof record.model === 'string') patch.model = record.model.trim()
  if (typeof record.parseProvider === 'string') patch.parseProvider = record.parseProvider.trim()
  if (typeof record.parseModel === 'string') patch.parseModel = record.parseModel.trim()
  if (typeof record.ttsBaseUrl === 'string') patch.ttsBaseUrl = record.ttsBaseUrl.trim()
  if (typeof record.ttsApiKey === 'string') patch.ttsApiKey = record.ttsApiKey.trim()
  if (typeof record.ttsModel === 'string') patch.ttsModel = record.ttsModel.trim()
  if (typeof record.videoBaseUrl === 'string') patch.videoBaseUrl = record.videoBaseUrl.trim()
  if (typeof record.videoApiKey === 'string') patch.videoApiKey = record.videoApiKey.trim()
  if (typeof record.videoModel === 'string') patch.videoModel = record.videoModel.trim()
  if (typeof record.imageBaseUrl === 'string') patch.imageBaseUrl = record.imageBaseUrl.trim()
  if (typeof record.imageApiKey === 'string') patch.imageApiKey = record.imageApiKey.trim()
  if (typeof record.imageModel === 'string') patch.imageModel = record.imageModel.trim()
  if (typeof record.dialect === 'string' && DIALECTS.some(item => item.id === record.dialect)) {
    patch.dialect = record.dialect as PluginConfig['dialect']
  }
  if (typeof record.announceToAgent === 'boolean') patch.announceToAgent = record.announceToAgent
  if (typeof record.dataDir === 'string') patch.dataDir = record.dataDir.trim()
  return patch
}

function configView(config: PluginConfig, defaults: { provider: string, model: string }, dataRoot: string, dshAvailable: boolean): ConfigView {
  return { config, defaults, dataRoot, dshAvailable }
}

export function makeRoutes(deps: RoutesDeps): WebRoute[] {
  const { configs, dsh } = deps

  const route = (
    path: string,
    handlers: {
      get?: (url: URL, req: IncomingMessage, res: ServerResponse) => Promise<void> | void
      post?: (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) => Promise<unknown>
    },
  ): WebRoute => ({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req as never)) {
        writeJson(res, 403, { ok: false, error: '只允许本机同源访问' })
        return
      }
      const method = (req.method ?? 'GET').toUpperCase()
      try {
        if (method === 'GET' || method === 'HEAD') {
          if (handlers.get === undefined) {
            writeJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
          await handlers.get(url, req, res)
          return
        }
        if (method === 'POST') {
          if (handlers.post === undefined) {
            writeJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const body = await readJsonBody(req)
          const value = await handlers.post(body, req, res)
          if (value !== undefined) writeJson(res, 200, { ok: true, value })
          return
        }
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        writeJson(res, 200, { ok: false, error: messageOf(error) })
      }
    },
  })

  const generator = new Generator(dsh)
  const importer = new Importer(dsh, generator)
  const storeForCwd = async (cwd: string): Promise<{ store: ProjectStore, dataDir: string }> => {
    const doc = await configs.read()
    return { store: deps.storeFor(cwd, doc.config.dataDir), dataDir: doc.config.dataDir }
  }

  return [
    route(API.session, {
      post: async (body) => {
        const sessionId = asString(body.sessionId).trim()
        const explicit = sessionId !== ''
        const binding = explicit ? await configs.binding(sessionId) : await configs.latestBinding()
        const cwd = explicit ? deps.sessionCwd(sessionId) : (binding?.cwd ?? deps.homeCwd())
        if (cwd === undefined) throw new Error('无法解析当前会话的工作目录；请先打开一个带工作目录的会话')
        if (!explicit && binding === undefined) await mkdir(cwd, { recursive: true }).catch(() => {})
        return { sessionId, cwd, ...(binding === undefined ? {} : { binding }), home: !explicit && binding === undefined }
      },
    }),

    route(API.importPreview, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = asString(body.projectId).trim()
        const { store } = await storeForCwd(cwd)
        const base = projectId === ''
          ? emptyProject('', asString(body.title).trim() || '未命名短剧')
          : await store.read(projectId)
        const doc = await configs.read()
        const derivedDialect = dialectForVideoModel(doc.config.videoModel)
        if (derivedDialect !== undefined) base.meta.dialect = derivedDialect
        const defaults = dsh.defaultSelection() ?? { provider: '', model: '' }
        const outcome = await importer.preview(base, {
          text: asString(body.text),
          fileBase64: asString(body.fileBase64),
          fileName: asString(body.fileName),
          instruction: asString(body.instruction),
        }, {
          parseProvider: doc.config.parseProvider,
          parseModel: doc.config.parseModel,
          generationProvider: doc.config.provider || defaults.provider,
          generationModel: doc.config.model || defaults.model,
        })
        return { ...outcome, newProject: projectId === '', validation: validateProject(outcome.project) }
      },
    }),

    route(API.importApply, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = asString(body.projectId).trim()
        const sessionId = asString(body.sessionId).trim()
        const project = body.project as Project
        if (project === undefined || project === null || typeof project !== 'object') throw new Error('缺少 project')
        if (projectId === '') {
          const parent = asString(body.parent).trim()
          if (parent !== '' && !isAbsolute(parent)) throw new Error('项目保存目录必须是绝对路径')
          const current = await configs.read()
          const currentRoot = resolve(projectsDir(cwd, current.config.dataDir))
          const requested = parent === '' ? resolve(projectsDir(cwd, '')) : resolve(parent)
          if (requested !== currentRoot) {
            throw new Error('导入到新目录前，请先在「设置 → 项目」里迁移项目根目录，避免旧项目失联')
          }
          const store = deps.storeFor(cwd, current.config.dataDir)
          const saved = await store.importProject(project)
          if (sessionId !== '') await configs.bind(sessionId, saved.id, cwd)
          return { project: saved, validation: validateProject(saved) }
        }
        const { store } = await storeForCwd(cwd)
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined)
        if (sessionId !== '') await configs.bind(sessionId, saved.id, cwd)
        return { project: saved, validation: validateProject(saved) }
      },
    }),

    route(API.analyze, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const { store } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        project.scriptAnalysis = analyzeScript(project.episodes.map(episode => ({ id: episode.id, script: episode.script })))
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        return { project: saved, validation: validateProject(saved) }
      },
    }),

    route(API.voiceDesign, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const characterId = requireString(body.characterId, 'characterId')
        const { store } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        assertFresh(project, body)
        assertStyleAccepted(project)
        const index = project.characters.findIndex(character => character.id === characterId)
        if (index < 0) throw new Error(`角色不存在：${characterId}`)
        const character = project.characters[index]!
        const cfg = (await configs.read()).config
        const fallback = [
          character.voiceCard.ageRange,
          character.voiceCard.rate,
          character.voiceCard.baseline,
          character.voiceCard.forbidden === '' ? '' : `不要${character.voiceCard.forbidden}`,
        ].filter(item => item.trim() !== '').join('；')
        const description = asString(body.description).trim() || character.voiceCard.designPrompt || fallback || `${character.role || '角色'} ${character.name}`
        const sampleText = asString(body.sampleText).trim() || character.voiceCard.sampleText || `我是${character.name}。这句话用来确认我的音色。`
        const safeId = character.id.replace(/[^A-Za-z0-9_-]/g, '_')
        const relative = `audio/voice-${safeId}.wav`
        const absolute = join(store.directoryOf(projectId), relative)
        const design = await designVoice({
          baseUrl: cfg.ttsBaseUrl,
          apiKey: cfg.ttsApiKey,
          model: cfg.ttsModel,
          description,
          sampleText,
          outFile: absolute,
        })
        project.characters[index] = {
          ...character,
          voiceCard: {
            ...character.voiceCard,
            voiceSample: relative,
            designPrompt: description,
            sampleText,
            designedAt: Date.now(),
          },
        }
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        return { project: saved, characterId, audioPath: relative, bytes: design.bytes, validation: validateProject(saved) }
      },
    }),

    route(API.videoGenerate, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const shotId = requireString(body.shotId, 'shotId')
        const { store } = await storeForCwd(cwd)
        let project = await store.read(projectId)
        assertFresh(project, body)
        assertStyleAccepted(project)
        const episode = project.episodes.find(item => item.shots.some(shot => shot.id === shotId))
        if (episode === undefined) throw new Error(`分镜不存在：${shotId}`)
        let shot = episode.shots.find(item => item.id === shotId)!
        const cfg = (await configs.read()).config
        const derived = dialectForVideoModel(cfg.videoModel)
        if (shot.prompt.text.trim() === '' || shot.prompt.version < 1 || shot.prompt.inputHash !== shotInputHash(project, episode, shot) || (derived !== undefined && shot.prompt.dialect !== derived)) {
          compileShotInto(project, episode, shot, derived ?? project.meta.dialect)
        }
        if (shot.prompt.text.trim() === '') throw new Error('提示词为空：先编译这个分镜的提示词')
        if (derived !== undefined) project.meta.dialect = derived
        const speakers = [...new Set(shot.dialogue.map(line => line.speaker))]
          .map(id => project.characters.find(character => character.id === id))
          .filter((character): character is NonNullable<typeof character> => character !== undefined)
        const missingVoices = speakers.filter(character => character.voiceCard.voiceSample.trim() === '')
        if (missingVoices.length > 0) {
          throw new Error(`这些说话角色还没有音色样音：${missingVoices.map(item => `${item.id} ${item.name}`).join('、')}`)
        }
        const voiceBySample = new Map<string, string>()
        for (const character of speakers) {
          const sample = character.voiceCard.voiceSample.trim()
          if (sample !== '' && !voiceBySample.has(sample)) voiceBySample.set(sample, `${character.name}（${character.id}）`)
        }
        const audios = [...voiceBySample.keys()]
        for (const audio of audios) {
          const duration = await wavDurationSec(join(store.directoryOf(projectId), audio)).catch(() => undefined)
          if (duration !== undefined && duration > 15.2) {
            throw new Error(`音色样音 ${audio} 时长 ${duration.toFixed(1)}s，Seedance 参考音频必须 ≤15.2s；请重抽更短样音或先裁剪`)
          }
        }
        const voiceNote = audios.map((path, index) => `参考音频${index + 1}=${voiceBySample.get(path) ?? path}`).join('；')
        const visual = styleForMedia(project)
        const prompt = [
          shot.prompt.text.trim(),
          visual === '' ? '' : `【视觉方向】${visual}`,
          voiceNote === '' ? '' : `【音色参考】${voiceNote}；对白按台词说话人使用对应参考音频的音色。`,
        ].filter(Boolean).join('\n\n')
        const shotImages = [...new Set(shot.refs
          .filter(ref => ref.state === 'ref' && ref.path.trim() !== '')
          .map(ref => ref.path))]
        const characterImages = speakers
          .map(character => {
            const looks = character.looks
            const bound = shot.wardrobe[character.id]
            const look = (bound === undefined ? undefined : looks.find(item => item.id === bound))
              ?? looks.find(item => item.episodes.includes(episode.id))
              ?? looks[0]
            return look?.refs.main || look?.refs.front || character.refs.main || character.refs.front
          })
          .filter((path): path is string => typeof path === 'string' && path.trim() !== '')
        const images = [...new Set([...shotImages, ...characterImages])]
        if (images.length === 0) throw new Error('Seedance 2.0 需要参考图：先给这个分镜上传首帧，或在角色/参考图槽里填图片路径')
        if (images.length > 9) throw new Error(`Seedance 2.0 最多 9 张参考图；当前 ${images.length} 张，请先合并/删减`)
        if (audios.length > 3) throw new Error(`Seedance 2.0 最多 3 份参考音频；当前 ${audios.length} 份，请先拆分镜头`)
        if (shot.duration < 4 || shot.duration > 15) throw new Error(`Seedance 2.0 只支持 4–15 秒；当前分镜 ${shot.duration} 秒，请先拆分或调整时长`)
        const relative = `videos/${safeFilePart(shot.id)}.mp4`
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        let job: Project['jobs'][number] = {
          id: jobId,
          kind: 'video',
          shotId,
          status: 'pending',
          providerTaskId: '',
          costCny: 0,
          startedAt: Date.now(),
          endedAt: 0,
          note: relative,
        }
        project.jobs.push(job)
        const pendingSave = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        project.revision = pendingSave.revision
        let result
        try {
          result = await generateSeedanceVideo({
            baseUrl: cfg.videoBaseUrl,
            apiKey: cfg.videoApiKey,
            model: cfg.videoModel,
            prompt,
            duration: shot.duration,
            ratio: project.meta.orientation === 'landscape' ? '16:9' : '9:16',
            images,
            audios,
            projectDir: store.directoryOf(projectId),
            outFile: join(store.directoryOf(projectId), relative),
            onSubmitted: async taskId => {
              job.providerTaskId = taskId
              job.status = 'running'
              try {
                const submitted = await store.save(project, project.revision)
                project.revision = submitted.revision
              } catch (error) {
                if (!(error instanceof ConflictError)) throw error
                // 任务已被上游接受，不能因为并发保存丢掉 taskId：读最新项目只合并 job 字段。
                const latest = await store.read(projectId)
                const latestJob = latest.jobs.find(item => item.id === job.id)
                if (latestJob === undefined) {
                  latest.jobs.push({ ...job, providerTaskId: taskId, status: 'running' })
                  job = latest.jobs[latest.jobs.length - 1]!
                } else {
                  latestJob.providerTaskId = taskId
                  latestJob.status = 'running'
                  job = latestJob
                }
                const submitted = await store.save(latest, latest.revision)
                project = submitted
                const refreshed = project.episodes.find(item => item.shots.some(candidate => candidate.id === shotId))
                shot = refreshed?.shots.find(candidate => candidate.id === shotId) ?? shot
              }
            },
          })
        } catch (error) {
          job.status = 'failed'
          job.endedAt = Date.now()
          await store.save(project, project.revision).catch(() => undefined)
          throw error
        }
        const complete = (target: Project): void => {
          const targetEpisode = target.episodes.find(item => item.shots.some(candidate => candidate.id === shotId))
          const targetShot = targetEpisode?.shots.find(candidate => candidate.id === shotId)
          if (targetShot === undefined) throw new Error(`完成回写时找不到分镜：${shotId}`)
          targetShot.status = 'generated'
          targetShot.videoPath = relative
          const targetJob = target.jobs.find(item => item.id === job.id || (result?.taskId !== undefined && item.providerTaskId === result.taskId))
          if (targetJob === undefined) {
            target.jobs.push({ ...job, status: 'done', providerTaskId: result?.taskId || job.providerTaskId, endedAt: Date.now() })
          } else {
            targetJob.status = 'done'
            targetJob.providerTaskId = result?.taskId || targetJob.providerTaskId
            targetJob.endedAt = Date.now()
          }
          const existed = target.ledger.some(item => item.shotId === shotId && item.event === 'video.generated' && item.detail === `Seedance 2.0 生成 ${relative}`)
          if (!existed) {
            target.ledger.push({
              at: Date.now(),
              shotId,
              event: 'video.generated',
              detail: `Seedance 2.0 生成 ${relative}`,
              costCny: 0,
            })
          }
        }
        complete(project)
        let saved: Project | undefined
        for (let attempt = 0; attempt < 3 && saved === undefined; attempt += 1) {
          try {
            saved = await store.save(project, project.revision)
          } catch (error) {
            if (!(error instanceof ConflictError)) throw error
            project = await store.read(projectId)
            complete(project)
          }
        }
        if (saved === undefined) throw new ConflictError(project.revision)
        return { project: saved, shotId, videoPath: relative, taskId: result.taskId, validation: validateProject(saved) }
      },
    }),

    route(API.segmentVideo, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const segmentId = requireString(body.segmentId, 'segmentId')
        const { store } = await storeForCwd(cwd)
        let project = await store.read(projectId)
        assertFresh(project, body)
        assertStyleAccepted(project)
        const episode = project.episodes.find(item => item.segments.some(segment => segment.id === segmentId))
        if (episode === undefined) throw new Error(`片段不存在：${segmentId}`)
        let segment = episode.segments.find(item => item.id === segmentId)!
        let shots = segment.shotIds.map(id => episode.shots.find(shot => shot.id === id)).filter((shot): shot is NonNullable<typeof shot> => shot !== undefined)
        if (shots.length === 0) throw new Error(`片段没有子镜头：${segmentId}`)
        const cfg = (await configs.read()).config
        const derived = dialectForVideoModel(cfg.videoModel)
        for (const shot of shots) {
          if (shot.prompt.text.trim() === '' || shot.prompt.version < 1 || shot.prompt.inputHash !== shotInputHash(project, episode, shot) || (derived !== undefined && shot.prompt.dialect !== derived)) {
            compileShotInto(project, episode, shot, derived ?? project.meta.dialect)
          }
          if (shot.prompt.text.trim() === '') throw new Error(`片段内分镜 ${shot.id} 提示词为空`)
        }
        if (derived !== undefined) project.meta.dialect = derived
        const requestShots = shots.map(shot => shot.id)
        const speakers = [...new Set(shots.flatMap(shot => shot.dialogue.map(line => line.speaker)))]
          .map(id => project.characters.find(character => character.id === id))
          .filter((character): character is NonNullable<typeof character> => character !== undefined)
        const missingVoices = speakers.filter(character => character.voiceCard.voiceSample.trim() === '')
        if (missingVoices.length > 0) throw new Error(`这些说话角色还没有音色样音：${missingVoices.map(item => `${item.id} ${item.name}`).join('、')}`)
        const voiceBySample = new Map<string, string>()
        for (const character of speakers) {
          const sample = character.voiceCard.voiceSample.trim()
          if (sample !== '' && !voiceBySample.has(sample)) voiceBySample.set(sample, `${character.name}（${character.id}）`)
        }
        const audios = [...voiceBySample.keys()]
        for (const audio of audios) {
          const duration = await wavDurationSec(join(store.directoryOf(projectId), audio)).catch(() => undefined)
          if (duration !== undefined && duration > 15.2) throw new Error(`音色样音 ${audio} 时长 ${duration.toFixed(1)}s，Seedance 参考音频必须 ≤15.2s`)
        }
        const voiceNote = audios.map((path, index) => `参考音频${index + 1}=${voiceBySample.get(path) ?? path}`).join('；')
        const visual = styleForMedia(project)
        const shotPrompt = shots.map((shot, index) => `分镜${index + 1}（${shot.duration}s）：${shot.prompt.text.trim()}`).join('\n\n')
        const prompt = [
          `本片段场景：${episode.shots.find(shot => shot.id === segment.shotIds[0])?.sceneId ?? segment.sceneId}`,
          shotPrompt,
          visual === '' ? '' : `【视觉方向】${visual}`,
          voiceNote === '' ? '' : `【音色参考】${voiceNote}；对白按台词说话人使用对应参考音频的音色。`,
        ].filter(Boolean).join('\n\n')
        const shotImages = [...new Set(shots.flatMap(shot => shot.refs.filter(ref => ref.state === 'ref' && ref.path.trim() !== '').map(ref => ref.path)))]
        const characterImages = speakers.map(character => {
          const look = character.looks.find(item => item.episodes.includes(episode.id)) ?? character.looks[0]
          return look?.refs.main || look?.refs.front || character.refs.main || character.refs.front
        }).filter((path): path is string => typeof path === 'string' && path.trim() !== '')
        const images = [...new Set([...shotImages, ...characterImages])]
        if (images.length === 0) throw new Error('Seedance 2.0 需要参考图：先给片段内分镜上传首帧，或给角色上传参考图')
        if (images.length > 9) throw new Error(`Seedance 2.0 最多 9 张参考图；当前 ${images.length} 张`)
        if (audios.length > 3) throw new Error(`Seedance 2.0 最多 3 份参考音频；当前 ${audios.length} 份`)
        if (segment.duration < 4 || segment.duration > 15) throw new Error(`Seedance 2.0 只支持 4–15 秒；当前片段 ${segment.duration} 秒`)
        const relative = `videos/${safeFilePart(segment.id)}.mp4`
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        let job: Project['jobs'][number] = {
          id: jobId, kind: 'video', shotId: segment.id, status: 'pending', providerTaskId: '',
          costCny: 0, startedAt: Date.now(), endedAt: 0, note: relative,
        }
        project.jobs.push(job)
        const pendingSave = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        project.revision = pendingSave.revision
        let result
        try {
          result = await generateSeedanceVideo({
            baseUrl: cfg.videoBaseUrl, apiKey: cfg.videoApiKey, model: cfg.videoModel,
            prompt, duration: segment.duration,
            ratio: project.meta.orientation === 'landscape' ? '16:9' : '9:16',
            images, audios, projectDir: store.directoryOf(projectId),
            outFile: join(store.directoryOf(projectId), relative),
            onSubmitted: async taskId => {
              job.providerTaskId = taskId
              job.status = 'running'
              try {
                const submitted = await store.save(project, project.revision)
                project.revision = submitted.revision
              } catch (error) {
                if (!(error instanceof ConflictError)) throw error
                const latest = await store.read(projectId)
                const latestJob = latest.jobs.find(item => item.id === job.id)
                if (latestJob === undefined) {
                  latest.jobs.push({ ...job, providerTaskId: taskId, status: 'running' })
                  job = latest.jobs[latest.jobs.length - 1]!
                } else {
                  latestJob.providerTaskId = taskId
                  latestJob.status = 'running'
                  job = latestJob
                }
                const submitted = await store.save(latest, latest.revision)
                project = submitted
                const refreshed = project.episodes.find(item => item.segments.some(candidate => candidate.id === segmentId))
                segment = refreshed?.segments.find(candidate => candidate.id === segmentId) ?? segment
                shots = segment.shotIds.map(id => refreshed?.shots.find(shot => shot.id === id)).filter((shot): shot is NonNullable<typeof shot> => shot !== undefined)
              }
            },
          })
        } catch (error) {
          job.status = 'failed'
          job.endedAt = Date.now()
          await store.save(project, project.revision).catch(() => undefined)
          throw error
        }
        const complete = (target: Project): void => {
          const targetEpisode = target.episodes.find(item => item.segments.some(candidate => candidate.id === segmentId))
          const targetSegment = targetEpisode?.segments.find(candidate => candidate.id === segmentId)
          if (targetSegment === undefined) throw new Error(`完成回写时找不到片段：${segmentId}`)
          targetSegment.status = 'generated'
          targetSegment.videoPath = relative
          for (const shotId of targetSegment.shotIds) {
            const targetShot = targetEpisode?.shots.find(shot => shot.id === shotId)
            if (targetShot !== undefined) targetShot.status = 'generated'
          }
          const targetJob = target.jobs.find(item => item.id === job.id || (result?.taskId !== undefined && item.providerTaskId === result.taskId))
          if (targetJob === undefined) {
            target.jobs.push({ ...job, status: 'done', providerTaskId: result?.taskId || job.providerTaskId, endedAt: Date.now() })
          } else {
            targetJob.status = 'done'
            targetJob.providerTaskId = result?.taskId || targetJob.providerTaskId
            targetJob.endedAt = Date.now()
          }
          const existed = target.ledger.some(item => item.shotId === segmentId && item.event === 'video.generated' && item.detail === `Seedance 2.0 生成 ${relative}`)
          if (!existed) target.ledger.push({ at: Date.now(), shotId: segmentId, event: 'video.generated', detail: `Seedance 2.0 生成 ${relative}`, costCny: 0 })
        }
        complete(project)
        let saved: Project | undefined
        for (let attempt = 0; attempt < 3 && saved === undefined; attempt += 1) {
          try {
            saved = await store.save(project, project.revision)
          } catch (error) {
            if (!(error instanceof ConflictError)) throw error
            project = await store.read(projectId)
            complete(project)
          }
        }
        if (saved === undefined) throw new ConflictError(project.revision)
        return { project: saved, segmentId, shotId: requestShots[0] ?? '', videoPath: relative, taskId: result.taskId, validation: validateProject(saved) }
      },
    }),

    route(API.applyCanvasImage, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const target = asString(body.target)
        if (target !== 'character' && target !== 'scene') throw new Error('目标只能是 character 或 scene')
        const id = requireString(body.id, 'id')
        const dataUrl = asString(body.dataUrl)
        const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl)
        if (match === null) throw new Error('图片数据必须是 png/jpeg/webp 的 data URL')
        const { store } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        assertFresh(project, body)
        const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/webp' ? 'webp' : 'jpg'
        const relative = `refs/canvas-${safeFilePart(target)}-${safeFilePart(id)}-${Date.now()}.${ext}`
        const absolute = join(store.directoryOf(projectId), relative)
        await mkdir(join(store.directoryOf(projectId), 'refs'), { recursive: true })
        await writeFile(absolute, Buffer.from(match[2]!, 'base64'))
        if (target === 'character') {
          const character = project.characters.find(item => item.id === id)
          if (character === undefined) throw new Error(`角色不存在：${id}`)
          character.refs.main = relative
          if (character.refs.front === '') character.refs.front = relative
        } else {
          const scene = project.scenes.find(item => item.id === id)
          if (scene === undefined) throw new Error(`场景不存在：${id}`)
          scene.refImage = relative
        }
        const saved = await store.save(project)
        return { project: saved, imagePath: relative }
      },
    }),

    route(API.shotImage, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const shotId = requireString(body.shotId, 'shotId')
        const data = asString(body.dataBase64).replace(/^data:[^;]+;base64,/, '')
        if (data === '') throw new Error('没有收到图片数据')
        const mime = asString(body.mime).toLowerCase()
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
        const { store } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        assertFresh(project, body)
        assertStyleAccepted(project)
        const episode = project.episodes.find(item => item.shots.some(shot => shot.id === shotId))
        if (episode === undefined) throw new Error(`分镜不存在：${shotId}`)
        const shot = episode.shots.find(item => item.id === shotId)!
        const relative = `refs/${safeFilePart(shot.id)}.${ext}`
        const absolute = join(store.directoryOf(projectId), relative)
        await mkdir(join(store.directoryOf(projectId), 'refs'), { recursive: true })
        await writeFile(absolute, Buffer.from(data, 'base64'))
        const existing = shot.refs.find(ref => ref.role === 'first')
        if (existing !== undefined) {
          existing.state = 'ref'
          existing.path = relative
          existing.note = existing.note || '上传的首帧'
        } else {
          shot.refs.push({ slot: 'REF-FIRST', state: 'ref', role: 'first', path: relative, note: '上传的首帧' })
        }
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        return { project: saved, shotId, imagePath: relative, validation: validateProject(saved) }
      },
    }),

    route(API.imageGenerate, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const target = asString(body.target)
        const id = requireString(body.id, 'id')
        const view = asString(body.view).trim()
        const lookId = asString(body.lookId).trim()
        const overridePrompt = asString(body.prompt).trim()
        if (!['character', 'scene', 'prop', 'shot'].includes(target)) throw new Error(`不支持的图片目标：${target}`)
        if (view !== '' && !['front', 'side', 'back', 'sheet'].includes(view)) throw new Error(`不支持的三视图：${view}`)
        const { store } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        assertFresh(project, body)
        assertStyleAccepted(project)
        const cfg = (await configs.read()).config
        assertStyleAccepted(project)
        const style = styleForMedia(project)
        let prompt = ''
        let relative = ''
        let aspect: '1:1' | '3:4' | '9:16' | '16:9' = '1:1'
        let episodeId = ''
        if (target === 'character') {
          const character = project.characters.find(item => item.id === id)
          if (character === undefined) throw new Error(`角色不存在：${id}`)
          const look = lookId === '' ? undefined : character.looks.find(item => item.id === lookId)
          if (lookId !== '' && look === undefined) throw new Error(`角色 ${id} 没有造型 ${lookId}`)
          // 未指定 LOOK 的“基础参考图”也优先用默认 LOOK 描述，避免把字面量 LOOK-01 发给模型。
          const promptLook = look ?? (lookId === '' ? character.looks[0] : undefined)
          const lookText = promptLook?.text ?? ''
          const slots = [character.slots.ageGender, character.slots.face, character.slots.hair, character.slots.body, lookText || character.slots.outfit, promptLook === undefined ? character.slots.accessories : '', character.slots.temperament]
            .filter(item => item.trim() !== '').join('；')
          const lock = character.identityLock.trim() || character.lockText.trim() || slots
          if (view !== '') {
            const viewLabel = view === 'front' ? '正视图' : view === 'side' ? '侧视图' : view === 'back' ? '背视图' : '正面/侧面/背面三视图并排'
            const promptSource = look?.refPrompts[view as 'front' | 'side' | 'back' | 'sheet'] ?? (lookId === '' ? character.refPrompts[view as 'front' | 'side' | 'back' | 'sheet'] : undefined)
            const sourceWithLook = promptSource === undefined || promptSource.trim() === '' || lookText === '' || promptSource.includes(lookText)
              ? promptSource
              : `${promptSource}；造型：${lookText}`
            prompt = overridePrompt || sourceWithLook || (view === 'sheet'
              ? `角色三视图设定图，同一角色，正面/侧面/背面三个全身视角并排，干净浅灰背景，无文字。${lock}${lookText === '' ? '' : `；造型：${lookText}`}${style === '' ? '' : `；整体风格：${style}`}`
              : `角色三视图参考，${viewLabel}，单人全身，干净浅灰背景，无文字。${lock}${lookText === '' ? '' : `；造型：${lookText}`}${style === '' ? '' : `；整体风格：${style}`}`)
            relative = look === undefined
              ? (view === 'sheet' ? `refs/character-${safeFilePart(id)}-sheet.png` : `refs/character-${safeFilePart(id)}-${view}.png`)
              : `refs/character-${safeFilePart(id)}-${safeFilePart(look.id)}-${view}.png`
            aspect = view === 'sheet' ? '16:9' : '3:4'
          } else {
            prompt = overridePrompt || `角色设定参考图，单人，正面全身，干净浅灰背景，无文字。${lock}${lookText === '' ? '' : `；造型：${lookText}`}${style === '' ? '' : `；整体风格：${style}`}`
            relative = look === undefined ? `refs/character-${safeFilePart(id)}.png` : `refs/character-${safeFilePart(id)}-${safeFilePart(look.id)}.png`
          }
        } else if (target === 'scene') {
          const scene = project.scenes.find(item => item.id === id)
          if (scene === undefined) throw new Error(`场景不存在：${id}`)
          prompt = overridePrompt || `场景概念图，无人物、无文字、无牌匾、无标识，${scene.space}；陈设/道具：${scene.props}；色调：${scene.palette}；主光：${scene.keyLight}${style === '' ? '' : `；整体风格：${style}`}`
          aspect = project.meta.orientation === 'portrait' ? '9:16' : '16:9'
          relative = `refs/scene-${safeFilePart(id)}.png`
        } else if (target === 'prop') {
          const prop = project.props.find(item => item.id === id)
          if (prop === undefined) throw new Error(`道具不存在：${id}`)
          prompt = overridePrompt || `道具设定图，主体居中，干净背景，${prop.appearance}；叙事用途：${prop.function}${style === '' ? '' : `；整体风格：${style}`}`
          relative = `refs/prop-${safeFilePart(id)}.png`
        } else {
          const episode = project.episodes.find(item => item.shots.some(shot => shot.id === id))
          if (episode === undefined) throw new Error(`分镜不存在：${id}`)
          const shot = episode.shots.find(item => item.id === id)!
          const scene = project.scenes.find(item => item.id === shot.sceneId)
          const locks = [...new Set(shot.dialogue.map(line => line.speaker))]
            .map(speaker => effectiveCharacterText(project, episode, shot, speaker))
            .filter(text => text.trim() !== '')
          prompt = overridePrompt || `分镜首帧，${project.meta.orientation === 'portrait' ? '竖屏 9:16' : '横屏 16:9'}，${shot.size}，${shot.camera}；场景：${scene?.name ?? shot.sceneId} ${scene?.space ?? ''}；${scene?.palette === undefined ? '' : `色调：${scene.palette}；`}${scene?.keyLight === undefined ? '' : `主光：${scene.keyLight}；`}${locks.length === 0 ? '' : `人物身份与造型：${locks.join(' / ')}；`}动作：${shot.action}；站位：${shot.blocking}；情绪：${shot.emotion.start}${style === '' ? '' : `；整体风格：${style}`}`
          relative = `refs/${safeFilePart(shot.id)}.png`
          aspect = project.meta.orientation === 'portrait' ? '9:16' : '16:9'
          episodeId = episode.id
        }
        const avoid = project.styles.flatMap(item => item.avoid).map(item => item.trim()).filter(item => item !== '')
        if (prompt !== '' && avoid.length > 0) prompt += `；不要出现：${[...new Set(avoid)].join('、')}`
        const absolute = join(store.directoryOf(projectId), relative)
        const generated = await generateSeedreamImage({
          baseUrl: cfg.imageBaseUrl,
          apiKey: cfg.imageApiKey,
          model: cfg.imageModel,
          prompt,
          aspect,
          outFile: absolute,
        })
        // Seedream 可能返回 JPEG 但请求路径写的是 .png；按真实字节修正扩展名，避免 MIME 与内容不一致。
        const generatedBytes = await readFile(absolute)
        const actualExt = imageExtOf(generatedBytes)
        const declaredExt = extname(relative).slice(1).toLowerCase()
        if (actualExt !== undefined && actualExt !== declaredExt) {
          const corrected = `${relative.slice(0, -declaredExt.length - 1)}.${actualExt}`
          await rename(absolute, join(store.directoryOf(projectId), corrected))
          relative = corrected
        }
        if (target === 'character') {
          const character = project.characters.find(item => item.id === id)!
          const look = lookId === '' ? undefined : character.looks.find(item => item.id === lookId)
          if (look !== undefined) {
            if (view === 'sheet') {
              look.refs.main = relative
            } else if (view !== '') {
              look.refs[view as 'front' | 'side' | 'back'] = relative
              if (look.refs.main === '') look.refs.main = relative
            } else {
              look.refs.main = relative
              look.refs.front = relative
            }
            if (view !== '') look.refPrompts[view as 'front' | 'side' | 'back' | 'sheet'] = prompt
          } else if (view !== '') {
            if (view === 'sheet') {
              character.refs.main = relative
            } else {
              character.refs[view as 'front' | 'side' | 'back'] = relative
              if (character.refs.main === '') character.refs.main = relative
            }
            character.refPrompts[view as 'front' | 'side' | 'back' | 'sheet'] = prompt
          } else {
            character.refs.main = relative
            character.refs.front = relative
          }
        } else if (target === 'scene') {
          const scene = project.scenes.find(item => item.id === id)!
          scene.refImage = relative
        } else if (target === 'prop') {
          const prop = project.props.find(item => item.id === id)!
          prop.refImage = relative
        } else {
          const episode = project.episodes.find(item => item.shots.some(shot => shot.id === id))!
          const shot = episode.shots.find(item => item.id === id)!
          const existing = shot.refs.find(ref => ref.role === 'first')
          if (existing !== undefined) {
            existing.state = 'ref'
            existing.path = relative
            existing.note = existing.note || 'Seedream 首帧'
          } else {
            shot.refs.push({ slot: 'REF-FIRST', state: 'ref', role: 'first', path: relative, note: 'Seedream 首帧' })
          }
        }
        project.jobs.push({
          id: `job-${Date.now()}`,
          kind: 'image',
          shotId: target === 'shot' ? id : '',
          status: 'done',
          providerTaskId: '',
          costCny: 0,
          startedAt: Date.now(),
          endedAt: Date.now(),
          note: relative,
        })
        project.ledger.push({
          at: Date.now(),
          shotId: target === 'shot' ? id : '',
          event: 'image.generated',
          detail: `Seedream 生成 ${relative}`,
          costCny: 0,
        })
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        return { project: saved, target, id, imagePath: relative, bytes: generated.bytes, episodeId, validation: validateProject(saved) }
      },
    }),

    route(API.asset, {
      get: async (url, req, res) => {
        const cwd = requireCwd(url.searchParams.get('cwd'))
        const projectId = requireString(url.searchParams.get('projectId'), 'projectId')
        const relative = requireString(url.searchParams.get('path'), 'path')
        const { store } = await storeForCwd(cwd)
        const root = resolve(store.directoryOf(projectId))
        const absolute = resolve(root, relative)
        if (!absolute.startsWith(root + sep)) throw new Error('素材路径越界')
        const info = await stat(absolute)
        if (!info.isFile()) throw new Error('素材不是文件')
        const realRoot = await realpath(root).catch(() => root)
        const realFile = await realpath(absolute).catch(() => absolute)
        if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) throw new Error('素材路径越界')
        const ext = extname(absolute).toLowerCase()
        const type = ext === '.wav' ? 'audio/wav'
          : ext === '.mp3' ? 'audio/mpeg'
            : ext === '.mp4' ? 'video/mp4'
              : ext === '.png' ? 'image/png'
                : ext === '.webp' ? 'image/webp'
                  : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                    : 'application/octet-stream'
        const range = req.headers.range
        if (range !== undefined) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
          if (match !== null) {
            const start = match[1] === '' ? 0 : Number(match[1])
            const end = match[2] === '' ? info.size - 1 : Math.min(Number(match[2]), info.size - 1)
            if (start <= end && start < info.size) {
              res.writeHead(206, {
                'content-type': type,
                'content-length': end - start + 1,
                'content-range': `bytes ${start}-${end}/${info.size}`,
                'accept-ranges': 'bytes',
                'cache-control': 'no-store',
              })
              createReadStream(absolute, { start, end }).pipe(res)
              return
            }
          }
        }
        res.writeHead(200, {
          'content-type': type,
          'content-length': info.size,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        })
        createReadStream(absolute).pipe(res)
      },
    }),

    route(API.config, {
      get: async (_url, _req, res) => {
        const doc = await configs.read()
        const defaults = dsh.defaultSelection() ?? { provider: '', model: '' }
        const dataRoot = doc.config.dataDir !== '' ? doc.config.dataDir : deps.dataRoot()
        writeJson(res, 200, { ok: true, value: configView(doc.config, defaults, dataRoot, dsh.available) })
      },
      post: async (body, _req, res) => {
        const doc = await configs.save(asConfig(body.config))
        await deps.refreshDataRoot?.()
        const defaults = dsh.defaultSelection() ?? { provider: '', model: '' }
        const dataRoot = doc.config.dataDir !== '' ? doc.config.dataDir : deps.dataRoot()
        writeJson(res, 200, { ok: true, value: configView(doc.config, defaults, dataRoot, dsh.available) })
      },
    }),

    route(API.models, {
      get: async (url, _req, res) => {
        const force = url.searchParams.get('refresh') === '1'
        writeJson(res, 200, { ok: true, value: await dsh.catalog(force) })
      },
    }),

    route(API.projects, {
      get: async (url, _req, res) => {
        const cwd = requireCwd(url.searchParams.get('cwd'))
        const sessionId = asString(url.searchParams.get('sessionId')).trim()
        const { store, dataDir } = await storeForCwd(cwd)
        const projects = await store.list()
        const binding = sessionId === '' ? await configs.latestBinding() : await configs.binding(sessionId)
        const bound = binding?.projectId ?? projects[0]?.id
        writeJson(res, 200, {
          ok: true,
          value: {
            cwd,
            projectsRoot: projectsDir(cwd, dataDir),
            dataDir,
            projects,
            sessionId,
            boundProjectId: projects.some(project => project.id === bound) ? bound : undefined,
            stages: ['concept', 'bible', 'assets', 'episodes', 'storyboard', 'prompts', 'production', 'qc'],
          },
        })
      },
      post: async (body, _req, res) => {
        const cwd = requireCwd(body.cwd)
        const sessionId = asString(body.sessionId).trim()
        const { store, dataDir } = await storeForCwd(cwd)
        const doc = await configs.read()
        const derived = dialectForVideoModel(doc.config.videoModel)
        const project = await store.create({
          title: asString(body.title).trim() || '未命名短剧',
          ...(derived === undefined ? {} : { meta: { dialect: derived } }),
        })
        if (sessionId !== '') await configs.bind(sessionId, project.id, cwd)
        writeJson(res, 200, { ok: true, value: { project } })
      },
    }),

    route(API.moveProjects, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const raw = asString(body.targetDir).trim()
        if (raw !== '' && !isAbsolute(raw)) throw new Error('项目目录必须是绝对路径')
        const doc = await configs.read()
        const oldRoot = resolve(projectsDir(cwd, doc.config.dataDir))
        const defaultRoot = resolve(projectsDir(cwd, ''))
        const target = raw === '' ? defaultRoot : resolve(raw)
        if (target === oldRoot) {
          return { moved: 0, projectsRoot: oldRoot, dataDir: doc.config.dataDir }
        }
        if (target.startsWith(oldRoot + sep) || oldRoot.startsWith(target + sep)) {
          throw new Error('新目录不能是当前项目目录的子目录或父目录')
        }
        await mkdir(target, { recursive: true })
        const entries = await readdir(oldRoot, { withFileTypes: true }).catch(() => [])
        const ids = entries.filter(entry => entry.isDirectory() && safeProjectId(entry.name)).map(entry => entry.name)
        for (const id of ids) {
          if (existsSync(join(target, id))) throw new Error(`目标目录里已有同名项目：${id}`)
        }
        let moved = 0
        for (const id of ids) {
          const source = join(oldRoot, id)
          const destination = join(target, id)
          try {
            await rename(source, destination)
          } catch (error) {
            if ((error as { code?: string }).code !== 'EXDEV') throw error
            await cp(source, destination, { recursive: true })
            await rm(source, { recursive: true, force: true })
          }
          moved += 1
        }
        const dataDir = target === defaultRoot ? '' : target
        const saved = await configs.save({ dataDir })
        return { moved, projectsRoot: projectsDir(cwd, saved.config.dataDir), dataDir: saved.config.dataDir }
      },
    }),

    route(API.project, {
      get: async (url, _req, res) => {
        const cwd = requireCwd(url.searchParams.get('cwd'))
        const projectId = requireString(url.searchParams.get('projectId'), 'projectId')
        const sessionId = asString(url.searchParams.get('sessionId')).trim()
        const { store, dataDir } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        if (sessionId !== '') await configs.bind(sessionId, projectId, cwd)
        const validation = validateProject(project)
        writeJson(res, 200, {
          ok: true,
          value: {
            project,
            summary: { ...(await store.list()).find(item => item.id === projectId) },
            stage: inferStage(project),
            projectDir: store.directoryOf(projectId),
            validation,
          },
        })
      },
      post: async (body, _req, res) => {
        const cwd = requireCwd(body.cwd)
        const { store, dataDir } = await storeForCwd(cwd)
        const action = asString(body.action)
        if (action === 'save') {
          const project = body.project as Project
          if (project === undefined || project === null || typeof project !== 'object') throw new Error('缺少 project')
          const expected = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
          try {
            const saved = await store.save(project, expected)
            writeJson(res, 200, { ok: true, value: { project: saved } })
          } catch (error) {
            if (error instanceof ConflictError) {
              writeJson(res, 200, { ok: false, error: error.message, value: { currentRevision: error.currentRevision } })
              return
            }
            throw error
          }
          return
        }
        if (action === 'delete') {
          const projectId = requireString(body.projectId, 'projectId')
          await store.remove(projectId)
          writeJson(res, 200, { ok: true, value: { deleted: true } })
          return
        }
        if (action === 'bind') {
          const projectId = requireString(body.projectId, 'projectId')
          const sessionId = requireString(body.sessionId, 'sessionId')
          await configs.bind(sessionId, projectId, cwd)
          writeJson(res, 200, { ok: true, value: { bound: true, projectId } })
          return
        }
        if (action === 'create-episode') {
          const projectId = requireString(body.projectId, 'projectId')
          const project = await store.read(projectId)
          const used = new Set(project.episodes.map(episode => episode.id))
          let index = 1
          while (used.has(`EP${String(index).padStart(3, '0')}`)) index += 1
          const id = `EP${String(index).padStart(3, '0')}`
          project.episodes.push({
            id,
            title: `第 ${index} 集`,
            logline: '',
            status: 'draft',
            targetSeconds: 0,
            beats: [],
            script: '',
            scriptLocked: false,
            scriptHash: '',
            shots: [],
            segments: [],
          })
          const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined)
          writeJson(res, 200, { ok: true, value: { project: saved, episodeId: id } })
          return
        }
        throw new Error(`未知 action：${action}`)
      },
    }),

    route(API.generate, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const stage = asString(body.stage) as GenerateStage
        if (!['bible', 'characters', 'scenes', 'props', 'episode', 'shots'].includes(stage)) throw new Error('未知生成阶段')
        const { store, dataDir } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        const episodeId = asString(body.episodeId).trim() || undefined
        const missing = missingPrerequisites(project, stage, episodeId ?? '')
        if (missing.length > 0) throw new Error(`前置条件未满足：${missing.join('、')}`)
        const doc = await configs.read()
        const defaultSelection = dsh.defaultSelection() ?? { provider: '', model: '' }
        const provider = doc.config.provider.trim() || defaultSelection.provider
        const model = doc.config.model.trim() || defaultSelection.model
        const instruction = asString(body.instruction).trim() || undefined
        let outcome
        try {
          outcome = await generator.generate({ project, stage, episodeId, instruction, provider, model })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (stage !== 'characters' || !/现代服装|囚服|角色定位/.test(message)) throw error
          outcome = await generator.generate({
            project, stage, episodeId, provider, model,
            instruction: `${instruction ?? ''}\n上一次生成被门禁拒绝：${message}。请严格按剧本称谓/职业/关系写 role，服装必须是剧本时代内的服装，禁止现代卫衣/运动鞋/衬衫/拉链，禁止按身份猜囚服。`.trim(),
          })
        }
        const saved = await store.save(outcome.project, project.revision)
        const validation = validateProject(saved)
        return { project: saved, notes: outcome.notes, usage: outcome.usage, validation }
      },
    }),

    route(API.estimate, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const episodeId = asString(body.episodeId).trim()
        const { store } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        const episodes = episodeId === ''
          ? project.episodes
          : project.episodes.filter(episode => episode.id === episodeId)
        if (episodes.length === 0) throw new Error('没有可估算的分集')
        const estimates: Array<{ episodeId: string, targetSeconds: number }> = []
        for (const episode of episodes) {
          const target = estimateEpisodeSeconds(episode)
          if (target <= 0) continue
          episode.targetSeconds = target
          balanceBeats(episode, target)
          estimates.push({ episodeId: episode.id, targetSeconds: target })
        }
        if (estimates.length === 0) throw new Error('这些分集还没有分镜/剧本/节拍，无法估算时长')
        project.meta.durationMode = 'auto'
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : project.revision)
        return { project: saved, estimates, validation: validateProject(saved) }
      },
    }),

    route(API.compile, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const episodeId = requireString(body.episodeId, 'episodeId')
        const shotId = asString(body.shotId).trim()
        const requested = asString(body.dialect) as CompileRequest['dialect']
        const { store, dataDir } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        const doc = await configs.read()
        const derived = dialectForVideoModel(doc.config.videoModel)
        const dialect = derived
          ?? (DIALECTS.some(item => item.id === requested) ? requested : undefined)
          ?? project.meta.dialect
        if (!DIALECTS.some(item => item.id === dialect)) throw new Error('未知方言')
        const episode = project.episodes.find(item => item.id === episodeId)
        if (episode === undefined) throw new Error(`找不到 ${episodeId}`)
        const targets = shotId === '' ? episode.shots : episode.shots.filter(shot => shot.id === shotId)
        if (targets.length === 0) throw new Error('没有可编译的镜头')
        // 先写回方言，shotInputHash 会读取 meta.dialect；否则编译后 hash 立即不一致。
        project.meta.dialect = dialect
        let compiled = 0
        for (const shot of targets) {
          compileShotInto(project, episode, shot, dialect)
          compiled += 1
        }
        if (episode.shots.length > 0 && episode.shots.every(shot => shot.prompt.text.trim() !== '')) {
          episode.status = 'prompted'
        }
        const saved = await store.save(project, typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined)
        const validation = validateProject(saved)
        return { project: saved, compiled, findings: validation.findings }
      },
    }),

    route(API.validate, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const { store, dataDir } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        const result: ValidationResult = validateProject(project, asString(body.episodeId).trim() || undefined)
        return { validation: result, project }
      },
    }),

    route(API.export, {
      post: async (body) => {
        const cwd = requireCwd(body.cwd)
        const projectId = requireString(body.projectId, 'projectId')
        const { store, dataDir } = await storeForCwd(cwd)
        const project = await store.read(projectId)
        const dir = await store.exportDir(projectId)
        const result = await exportProject(project, dir)
        return result
      },
    }),
  ]
}
