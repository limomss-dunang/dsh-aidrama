/**
 * 项目存储：每个项目一个目录，`project.json` 是机器可校验的唯一真相。
 *
 *   <workspace>/.dsh-aidrama/
 *     projects/<projectId>/project.json
 *     projects/<projectId>/exports/EP001/*.md
 *
 * 写入策略：原子写（temp → rename）+ revision 乐观锁；冲突时抛出 ConflictError，
 * 由路由返回 409，浏览器保留本地草稿并提示重新载入。
 */

import { realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Episode, Project, ProjectSummary, Shot, StageId } from '../shared/types.ts'
import { groupShotsIntoSegments } from '../shared/segments.ts'
import { fillStyleDefaults } from '../shared/style-presets.ts'
import { asString, messageOf, newId, projectSlug, safeProjectId } from './util.ts'

function scriptHash(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export class ConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super(`项目已在别处更新（当前 revision ${currentRevision}），请重新载入后再保存`)
    this.name = 'ConflictError'
  }
}

export function projectRoot(cwd: string, dataDir = ''): string {
  return dataDir.trim() !== '' ? dataDir.trim() : join(cwd, '.dsh-aidrama')
}

export function projectsDir(cwd: string, dataDir = ''): string {
  return dataDir.trim() !== '' ? dataDir.trim() : join(projectRoot(cwd), 'projects')
}

export function projectDir(cwd: string, id: string, dataDir = ''): string {
  return join(projectsDir(cwd, dataDir), id)
}

export function projectFile(cwd: string, id: string, dataDir = ''): string {
  return join(projectDir(cwd, id, dataDir), 'project.json')
}

export function emptyProject(cwd: string, title = '未命名短剧'): Project {
  const now = Date.now()
  return {
    schema: 'dsh-aidrama/v1',
    id: projectSlug(),
    title: title.trim() || '未命名短剧',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    meta: {
      platform: 'douyin',
      orientation: 'portrait',
      genre: 'urban',
      targetEpisodes: 1,
      episodeSeconds: 90,
      durationMode: 'fixed',
      audience: '',
      logline: '',
      theme: '',
      hook: '',
      forbidden: [],
      dialect: 'seedance-2.5',
    },
    bible: { premise: '', world: '', arc: '', episodePlan: '', visualDirection: '' },
    characters: [],
    scenes: [],
    props: [],
    styles: [],
    episodes: [],
    scriptAnalysis: { episodes: [], accepted: false, generatedAt: 0 },
    decisions: [],
    jobs: [],
    ledger: [],
  }
}

/* ------------------------------------------------------------------ */
/* 规范化：磁盘/模型返回的数据一律走这里，避免 UI 因缺字段崩            */
/* ------------------------------------------------------------------ */

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function arr<T>(value: unknown, map: (item: Record<string, unknown>, index: number) => T): T[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map(map)
}

function normalizeShot(raw: Record<string, unknown>, index: number, episodeId: string): Shot {
  const id = str(raw.id) || `SHOT-${episodeId}-${String(index + 1).padStart(3, '0')}`
  const dialogue = arr(raw.dialogue, line => ({
    speaker: str(line.speaker),
    text: str(line.text),
    offScreen: line.offScreen === true,
    voiceOver: line.voiceOver === true,
  }))
  const soundRecord = (raw.sound !== null && typeof raw.sound === 'object') ? raw.sound as Record<string, unknown> : {}
  return {
    id,
    sceneId: str(raw.sceneId),
    duration: Math.max(4, Math.min(15, Math.round(num(raw.duration, 4)))),
    size: str(raw.size, 'medium'),
    camera: str(raw.camera),
    blocking: str(raw.blocking),
    action: str(raw.action),
    endState: str(raw.endState),
    emotion: {
      start: str((raw.emotion as Record<string, unknown> | undefined)?.start),
      trigger: str((raw.emotion as Record<string, unknown> | undefined)?.trigger),
      end: str((raw.emotion as Record<string, unknown> | undefined)?.end),
    },
    dialogue,
    sound: { ambience: str(soundRecord.ambience), sfx: str(soundRecord.sfx), music: str(soundRecord.music) },
    refs: arr(raw.refs, ref => ({
      slot: str(ref.slot),
      state: (['ref', 'plan', 'missing', 't2v'].includes(str(ref.state)) ? str(ref.state) : 'missing') as Shot['refs'][number]['state'],
      role: (['identity', 'look', 'geo', 'composition', 'scale', 'effect', 'first', 'last', 'style'].includes(str(ref.role)) ? str(ref.role) : 'identity') as Shot['refs'][number]['role'],
      path: str(ref.path),
      note: str(ref.note),
    })),
    locks: Array.isArray(raw.locks) ? raw.locks.filter((item): item is string => typeof item === 'string') : [],
    status: (['draft', 'ready', 'compiled', 'approved', 'generated'].includes(str(raw.status)) ? str(raw.status) : 'draft') as Shot['status'],
    videoPath: str(raw.videoPath),
    wardrobe: Object.fromEntries(
      Object.entries((raw.wardrobe !== null && typeof raw.wardrobe === 'object' ? raw.wardrobe : {}) as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    prompt: {
      dialect: (str((raw.prompt as Record<string, unknown> | undefined)?.dialect) || '') as Shot['prompt']['dialect'],
      text: str((raw.prompt as Record<string, unknown> | undefined)?.text),
      compiledAt: num((raw.prompt as Record<string, unknown> | undefined)?.compiledAt),
      version: Math.max(0, Math.round(num((raw.prompt as Record<string, unknown> | undefined)?.version))),
      inputHash: str((raw.prompt as Record<string, unknown> | undefined)?.inputHash),
      warnings: Array.isArray((raw.prompt as Record<string, unknown> | undefined)?.warnings)
        ? ((raw.prompt as Record<string, unknown>).warnings as unknown[]).filter((item): item is string => typeof item === 'string')
        : [],
    },
  }
}

function normalizeEpisode(raw: Record<string, unknown>, index: number): Episode {
  const id = str(raw.id) || `EP${String(index + 1).padStart(3, '0')}`
  const script = str(raw.script)
  const shots = arr(raw.shots, (shot, i) => normalizeShot(shot, i, id))
  const groupedSegments = groupShotsIntoSegments(shots, id)
  const savedSegments = arr(raw.segments, segment => ({
    id: str(segment.id),
    videoPath: str(segment.videoPath),
    status: (['draft', 'ready', 'prompted', 'generated'].includes(str(segment.status)) ? str(segment.status) : 'ready') as 'draft' | 'ready' | 'prompted' | 'generated',
  }))
  const segments = groupedSegments.map(segment => {
    const saved = savedSegments.find(item => item.id === segment.id)
    return saved === undefined ? segment : { ...segment, videoPath: saved.videoPath, status: saved.status }
  })
  return {
    id,
    title: str(raw.title, `第 ${index + 1} 集`),
    logline: str(raw.logline),
    status: (['draft', 'scripted', 'boarded', 'prompted'].includes(str(raw.status)) ? str(raw.status) : 'draft') as Episode['status'],
    targetSeconds: Math.max(0, Math.round(num(raw.targetSeconds))),
    beats: arr(raw.beats, (beat, i) => ({
      id: str(beat.id) || `B${i + 1}`,
      function: (['hook', 'goal', 'obstacle', 'twist', 'choice', 'cliff'].includes(str(beat.function)) ? str(beat.function) : 'goal') as Episode['beats'][number]['function'],
      seconds: Math.max(0, Math.round(num(beat.seconds))),
      text: str(beat.text),
    })),
    script,
    scriptLocked: raw.scriptLocked === true,
    scriptHash: str(raw.scriptHash) || scriptHash(script),
    shots,
    segments,
  }
}

export function normalizeProject(raw: unknown, fallbackId = ''): Project {
  const record = (raw !== null && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const base = emptyProject('', '未命名短剧')
  const meta = (record.meta !== null && typeof record.meta === 'object') ? record.meta as Record<string, unknown> : {}
  const bible = (record.bible !== null && typeof record.bible === 'object') ? record.bible as Record<string, unknown> : {}
  const id = str(record.id) || fallbackId || base.id
  const project: Project = {
    schema: 'dsh-aidrama/v1',
    id,
    title: str(record.title, base.title),
    createdAt: num(record.createdAt, Date.now()),
    updatedAt: num(record.updatedAt, Date.now()),
    revision: Math.max(0, Math.round(num(record.revision, 0))),
    meta: {
      platform: (['douyin', 'kuaishou', 'wechat', 'xiaohongshu', 'youtube'].includes(str(meta.platform)) ? str(meta.platform) : 'douyin') as Project['meta']['platform'],
      orientation: (str(meta.orientation) === 'landscape' ? 'landscape' : 'portrait'),
      genre: (['urban', 'costume', 'xianxia', 'suspense', 'scifi', 'realism', 'family', 'sweet', 'comedy'].includes(str(meta.genre)) ? str(meta.genre) : 'urban') as Project['meta']['genre'],
      targetEpisodes: Math.max(1, Math.min(200, Math.round(num(meta.targetEpisodes, 1)))),
      episodeSeconds: Math.max(15, Math.min(1800, Math.round(num(meta.episodeSeconds, 90)))),
      durationMode: str(meta.durationMode) === 'auto' ? 'auto' : 'fixed',
      audience: str(meta.audience),
      logline: str(meta.logline),
      theme: str(meta.theme),
      hook: str(meta.hook),
      forbidden: Array.isArray(meta.forbidden) ? meta.forbidden.filter((item): item is string => typeof item === 'string') : [],
      dialect: (['generic', 'seedance-2.0', 'seedance-2.5', 'minimax-h3', 'kling', 'wan-3.0'].includes(str(meta.dialect)) ? str(meta.dialect) : 'seedance-2.5') as Project['meta']['dialect'],
    },
    bible: {
      premise: str(bible.premise),
      world: str(bible.world),
      arc: str(bible.arc),
      episodePlan: str(bible.episodePlan),
      visualDirection: str(bible.visualDirection),
    },
    characters: arr(record.characters, character => ({
      id: str(character.id) || `C${String(Math.random()).slice(2, 4)}`,
      name: str(character.name),
      role: str(character.role),
      roleEvidence: Array.isArray(character.roleEvidence) ? character.roleEvidence.filter((item): item is string => typeof item === 'string') : [],
      status: str(character.status) === 'locked' ? 'locked' : 'draft',
      appearsIn: Array.isArray(character.appearsIn) ? character.appearsIn.filter((item): item is string => typeof item === 'string') : [],
      slots: {
        ageGender: str((character.slots as Record<string, unknown> | undefined)?.ageGender),
        face: str((character.slots as Record<string, unknown> | undefined)?.face),
        hair: str((character.slots as Record<string, unknown> | undefined)?.hair),
        body: str((character.slots as Record<string, unknown> | undefined)?.body),
        outfit: str((character.slots as Record<string, unknown> | undefined)?.outfit),
        accessories: str((character.slots as Record<string, unknown> | undefined)?.accessories),
        temperament: str((character.slots as Record<string, unknown> | undefined)?.temperament),
        forbidden: str((character.slots as Record<string, unknown> | undefined)?.forbidden),
        lightBaseline: str((character.slots as Record<string, unknown> | undefined)?.lightBaseline),
      },
      lockText: str(character.lockText),
      identityLock: str(character.identityLock),
      looks: arr(character.looks, (look, i) => ({
        id: str(look.id) || `LOOK-${String(i + 1).padStart(2, '0')}`,
        text: str(look.text),
        episodes: Array.isArray(look.episodes) ? look.episodes.filter((item): item is string => typeof item === 'string') : [],
        refs: {
          front: str((look.refs as Record<string, unknown> | undefined)?.front),
          side: str((look.refs as Record<string, unknown> | undefined)?.side),
          back: str((look.refs as Record<string, unknown> | undefined)?.back),
          main: str((look.refs as Record<string, unknown> | undefined)?.main),
        },
        refPrompts: {
          front: str((look.refPrompts as Record<string, unknown> | undefined)?.front),
          side: str((look.refPrompts as Record<string, unknown> | undefined)?.side),
          back: str((look.refPrompts as Record<string, unknown> | undefined)?.back),
          sheet: str((look.refPrompts as Record<string, unknown> | undefined)?.sheet),
        },
      })),
      stateVariants: arr(character.stateVariants, variant => ({
        id: str(variant.id),
        change: str(variant.change),
        fromShot: str(variant.fromShot),
        affects: Array.isArray(variant.affects) ? variant.affects.filter((item): item is string => typeof item === 'string') : [],
      })),
      refs: {
        front: str((character.refs as Record<string, unknown> | undefined)?.front),
        side: str((character.refs as Record<string, unknown> | undefined)?.side),
        back: str((character.refs as Record<string, unknown> | undefined)?.back),
        expression: str((character.refs as Record<string, unknown> | undefined)?.expression),
        main: str((character.refs as Record<string, unknown> | undefined)?.main),
      },
      refPrompts: {
        front: str((character.refPrompts as Record<string, unknown> | undefined)?.front),
        side: str((character.refPrompts as Record<string, unknown> | undefined)?.side),
        back: str((character.refPrompts as Record<string, unknown> | undefined)?.back),
        sheet: str((character.refPrompts as Record<string, unknown> | undefined)?.sheet),
      },
      voiceCard: {
        voiceId: str((character.voiceCard as Record<string, unknown> | undefined)?.voiceId),
        ageRange: str((character.voiceCard as Record<string, unknown> | undefined)?.ageRange),
        rate: str((character.voiceCard as Record<string, unknown> | undefined)?.rate),
        baseline: str((character.voiceCard as Record<string, unknown> | undefined)?.baseline),
        forbidden: str((character.voiceCard as Record<string, unknown> | undefined)?.forbidden),
        voiceSample: str((character.voiceCard as Record<string, unknown> | undefined)?.voiceSample),
        designPrompt: str((character.voiceCard as Record<string, unknown> | undefined)?.designPrompt),
        sampleText: str((character.voiceCard as Record<string, unknown> | undefined)?.sampleText),
        designedAt: Number((character.voiceCard as Record<string, unknown> | undefined)?.designedAt) || 0,
      },
    })),
    scenes: arr(record.scenes, scene => ({
      id: str(scene.id),
      name: str(scene.name),
      appearsIn: Array.isArray(scene.appearsIn) ? scene.appearsIn.filter((item): item is string => typeof item === 'string') : [],
      space: str(scene.space),
      props: str(scene.props),
      palette: str(scene.palette),
      keyLight: str(scene.keyLight),
      refImage: str(scene.refImage),
      variants: arr(scene.variants, variant => ({ id: str(variant.id), change: str(variant.change) })),
    })),
    props: arr(record.props, prop => ({
      id: str(prop.id),
      name: str(prop.name),
      appearsIn: Array.isArray(prop.appearsIn) ? prop.appearsIn.filter((item): item is string => typeof item === 'string') : [],
      function: (['evidence', 'identity', 'countdown', 'keepsake', 'obstacle'].includes(str(prop.function)) ? str(prop.function) : 'evidence') as Project['props'][number]['function'],
      appearance: str(prop.appearance),
      owner: str(prop.owner),
      endPosition: str(prop.endPosition),
      refImage: str(prop.refImage),
    })),
    styles: arr(record.styles, style => ({
      id: str(style.id),
      name: str(style.name),
      prompt: str(style.prompt),
      avoid: Array.isArray(style.avoid) ? style.avoid.filter((item): item is string => typeof item === 'string') : [],
      status: str(style.status) === 'accepted' ? 'accepted' : 'proposed',
      medium: str(style.medium),
      palette: str(style.palette),
      lighting: str(style.lighting),
      lens: str(style.lens),
      texture: str(style.texture),
      referenceImage: str(style.referenceImage),
    })),
    episodes: arr(record.episodes, (episode, i) => normalizeEpisode(episode, i)),
    scriptAnalysis: {
      accepted: (record.scriptAnalysis as Record<string, unknown> | undefined)?.accepted === true,
      generatedAt: num((record.scriptAnalysis as Record<string, unknown> | undefined)?.generatedAt),
      episodes: arr((record.scriptAnalysis as Record<string, unknown> | undefined)?.episodes, episode => ({
        episodeId: str(episode.episodeId),
        cast: arr(episode.cast, member => ({
          name: str(member.name),
          gender: (['男', '女'].includes(str(member.gender)) ? str(member.gender) : '未知') as '男' | '女' | '未知',
          role: str(member.role),
          roleEvidence: Array.isArray(member.roleEvidence) ? member.roleEvidence.filter((item): item is string => typeof item === 'string') : [],
          evidence: str(member.evidence),
          costume: str(member.costume),
          costumeEvidence: str(member.costumeEvidence),
        })),
        locations: arr(episode.locations, location => ({
          name: str(location.name),
          evidence: str(location.evidence),
        })),
      })),
    },
    decisions: arr(record.decisions, decision => ({
      id: str(decision.id),
      field: str(decision.field),
      status: str(decision.status) === 'accepted' ? 'accepted' : 'proposed',
      value: str(decision.value),
      at: num(decision.at),
    })),
    jobs: arr(record.jobs, job => ({
      id: str(job.id),
      kind: (['image', 'video', 'tts', 'music'].includes(str(job.kind)) ? str(job.kind) : 'image') as Project['jobs'][number]['kind'],
      shotId: str(job.shotId),
      status: (['pending', 'running', 'done', 'failed', 'cancelled'].includes(str(job.status)) ? str(job.status) : 'pending') as Project['jobs'][number]['status'],
      providerTaskId: str(job.providerTaskId),
      costCny: Math.max(0, num(job.costCny)),
      startedAt: num(job.startedAt),
      endedAt: num(job.endedAt),
      note: str(job.note),
    })),
    ledger: arr(record.ledger, entry => ({
      at: num(entry.at),
      shotId: str(entry.shotId),
      event: str(entry.event),
      detail: str(entry.detail),
      costCny: Math.max(0, num(entry.costCny)),
    })),
    ...(record.canvas !== null && typeof record.canvas === 'object' ? { canvas: record.canvas } : {}),
    ...(record.director !== null && typeof record.director === 'object' ? { director: record.director } : {}),
  }
  // 共享资产只保留一份；集引用由剧本出现位置推导，缺失时才补，不覆盖人工关系。
  const episodes = project.episodes
  const derive = (name: string): string[] => name.trim() === ''
    ? []
    : episodes.filter(episode => episode.script.includes(name)).map(episode => episode.id)
  const deriveProp = (name: string): string[] => {
    const exact = derive(name)
    if (exact.length > 0 || name.trim().length < 3) return exact
    for (let size = Math.min(4, name.length); size >= 2; size -= 1) {
      const found = episodes.filter(episode => episode.script.includes(name.slice(-size))).map(episode => episode.id)
      if (found.length > 0) return found
    }
    return []
  }
  for (const character of project.characters) {
    if (character.appearsIn.length === 0) character.appearsIn = derive(character.name)
  }
  for (const scene of project.scenes) {
    if (scene.appearsIn.length === 0) scene.appearsIn = derive(scene.name)
  }
  for (const prop of project.props) {
    if (prop.appearsIn.length === 0) prop.appearsIn = deriveProp(prop.name)
  }
  fillStyleDefaults(project)
  return project
}

/* ------------------------------------------------------------------ */
/* 读写                                                                */
/* ------------------------------------------------------------------ */

const saveLocks = new Map<string, Promise<unknown>>()

function canonicalKey(dir: string): string {
  try {
    return join(realpathSync.native(dir), 'project.json').toLowerCase()
  } catch {
    return join(dir, 'project.json').toLowerCase()
  }
}

function withSaveLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = saveLocks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  saveLocks.set(key, next)
  void next.finally(() => {
    if (saveLocks.get(key) === next) saveLocks.delete(key)
  }).catch(() => undefined)
  return next
}

export class ProjectStore {
  constructor(
    private readonly cwdProvider: () => string,
    private readonly dataDirProvider: () => string = () => '',
  ) {}

  get cwd(): string {
    return this.cwdProvider()
  }

  private get dataDir(): string {
    return this.dataDirProvider()
  }

  get projectsRoot(): string {
    return projectsDir(this.cwd, this.dataDir)
  }

  private projectDir(id: string): string {
    return projectDir(this.cwd, id, this.dataDir)
  }

  /** 供媒体路由/生成器解析项目内的 audio、videos、refs 路径。 */
  directoryOf(id: string): string {
    if (!safeProjectId(id)) throw new Error('非法项目 ID')
    return this.projectDir(id)
  }

  private projectFile(id: string): string {
    return projectFile(this.cwd, id, this.dataDir)
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.projectsRoot, { recursive: true })
  }

  async create(input: { title?: string, meta?: Partial<Project['meta']> }): Promise<Project> {
    const project = emptyProject(this.cwd, input.title)
    if (input.meta !== undefined) project.meta = { ...project.meta, ...input.meta }
    await this.ensureRoot()
    await mkdir(this.projectDir(project.id), { recursive: true })
    await this.write(project)
    return project
  }

  /** 写入一份已完整构造的项目（导入预览确认后使用），不经过 create 的空模板。 */
  async importProject(project: Project): Promise<Project> {
    await this.ensureRoot()
    const next: Project = { ...project, revision: 0, updatedAt: Date.now() }
    await this.write(next)
    return next
  }

  async list(): Promise<ProjectSummary[]> {
    let entries: string[] = []
    try {
      const dirents = await readdir(this.projectsRoot, { withFileTypes: true })
      entries = dirents.filter(item => item.isDirectory()).map(item => item.name).filter(safeProjectId)
    } catch {
      return []
    }
    const summaries: ProjectSummary[] = []
    for (const id of entries) {
      const project = await this.read(id).catch(() => undefined)
      if (project === undefined) continue
      summaries.push(summarize(project, this.cwd))
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async read(id: string): Promise<Project> {
    if (!safeProjectId(id)) throw new Error('非法项目 ID')
    const raw = await readFile(this.projectFile(id), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeProject(parsed, id)
  }

  async readOptional(id: string): Promise<Project | undefined> {
    try {
      return await this.read(id)
    } catch {
      return undefined
    }
  }

  async write(project: Project): Promise<Project> {
    if (!safeProjectId(project.id)) throw new Error('非法项目 ID')
    const dir = this.projectDir(project.id)
    await mkdir(dir, { recursive: true })
    const target = this.projectFile(project.id)
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    const body = JSON.stringify(project, null, 2)
    await writeFile(temp, body, 'utf8')
    await rename(temp, target).catch(async (error) => {
      const code = (error as { code?: string }).code
      if (code !== 'EPERM' && code !== 'EBUSY') throw error
      await writeFile(target, body, 'utf8')
      await rm(temp, { force: true }).catch(() => undefined)
    })
    return project
  }

  /** 保存并递增 revision；在项目级锁内读磁盘 revision 做 CAS。 */
  async save(project: Project, expected?: number): Promise<Project> {
    if (!safeProjectId(project.id)) throw new Error('非法项目 ID')
    const key = canonicalKey(this.projectDir(project.id))
    return await withSaveLock(key, async () => {
      let diskRevision = 0
      try {
        const raw = JSON.parse(await readFile(this.projectFile(project.id), 'utf8')) as { revision?: unknown }
        diskRevision = Math.max(0, Math.round(Number(raw.revision) || 0))
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error
      }
      if (expected !== undefined && expected !== diskRevision) {
        throw new ConflictError(diskRevision)
      }
      const next: Project = { ...project, revision: diskRevision + 1, updatedAt: Date.now() }
      await this.write(next)
      return next
    })
  }

  async remove(id: string): Promise<void> {
    if (!safeProjectId(id)) return
    await rm(this.projectDir(id), { recursive: true, force: true })
  }

  async exists(id: string): Promise<boolean> {
    try {
      const info = await stat(this.projectFile(id))
      return info.isFile()
    } catch {
      return false
    }
  }

  async exportDir(id: string): Promise<string> {
    const dir = join(this.projectDir(id), 'exports')
    await mkdir(dir, { recursive: true })
    return dir
  }
}

export function summarize(project: Project, cwd: string): ProjectSummary {
  const shots = project.episodes.reduce((sum, episode) => sum + episode.shots.length, 0)
  return {
    id: project.id,
    title: project.title,
    cwd,
    revision: project.revision,
    updatedAt: project.updatedAt,
    episodes: project.episodes.length,
    shots,
    genre: project.meta.genre,
    platform: project.meta.platform,
    stage: inferStage(project),
  }
}

export function inferStage(project: Project): StageId {
  if (project.meta.logline.trim() === '') return 'concept'
  if (project.bible.premise.trim() === '') return 'bible'
  if (project.characters.length === 0) return 'assets'
  if (project.episodes.length === 0) return 'episodes'
  const episode = project.episodes[0]
  if (episode === undefined || episode.shots.length === 0) return 'storyboard'
  const compiled = project.episodes.some(ep => ep.shots.some(shot => shot.prompt.text.trim() !== ''))
  if (!compiled) return 'prompts'
  const hasJob = project.jobs.length > 0
  return hasJob ? 'qc' : 'production'
}

/** 新项目/新集 id。 */
export function nextEpisodeId(project: Project): string {
  const used = new Set(project.episodes.map(episode => episode.id))
  for (let i = 1; i < 1000; i += 1) {
    const id = `EP${String(i).padStart(3, '0')}`
    if (!used.has(id)) return id
  }
  return newId('EP')
}

export function newShotId(episodeId: string, shotCount: number): string {
  return `SHOT-${episodeId}-${String(shotCount + 1).padStart(3, '0')}`
}

export function errorText(error: unknown): string {
  if (error instanceof ConflictError) return error.message
  return messageOf(error)
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

export function text(value: unknown): string {
  return asString(value)
}
