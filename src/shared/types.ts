/**
 * 共享契约：宿主与浏览器半边都从这里取类型和路由常量。
 */

export const PLUGIN_ID = 'dsh-aidrama'
export const API = {
  config: '/api/dsh-aidrama/config',
  models: '/api/dsh-aidrama/models',
  session: '/api/dsh-aidrama/session',
  importPreview: '/api/dsh-aidrama/import',
  importApply: '/api/dsh-aidrama/import/apply',
  analyze: '/api/dsh-aidrama/analyze',
  voiceDesign: '/api/dsh-aidrama/voice-design',
  videoGenerate: '/api/dsh-aidrama/video-generate',
  segmentVideo: '/api/dsh-aidrama/segment-video',
  imageGenerate: '/api/dsh-aidrama/image-generate',
  asset: '/api/dsh-aidrama/asset',
  shotImage: '/api/dsh-aidrama/shot-image',
  applyCanvasImage: '/api/dsh-aidrama/apply-canvas-image',
  moveProjects: '/api/dsh-aidrama/projects/move',
  estimate: '/api/dsh-aidrama/estimate',
  projects: '/api/dsh-aidrama/projects',
  project: '/api/dsh-aidrama/project',
  generate: '/api/dsh-aidrama/generate',
  compile: '/api/dsh-aidrama/compile',
  validate: '/api/dsh-aidrama/validate',
  export: '/api/dsh-aidrama/export',
} as const

export interface ApiEnvelope<T> {
  ok: boolean
  value?: T
  error?: string
}

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

export interface PluginConfig {
  /** 文本模型：DSH 提供商 + 模型；空时回退到 DSH 默认模型。 */
  provider: string
  model: string
  /** 剧本解析专用模型；空时回退到文本模型。 */
  parseProvider: string
  parseModel: string
  /** 默认目标视频模型方言。 */
  dialect: DialectId
  /** MiMo 音色设计：手动接口（密钥只存本机配置）。 */
  ttsBaseUrl: string
  ttsApiKey: string
  ttsModel: string
  /** Seedance 2.0 视频：手动接口。 */
  videoBaseUrl: string
  videoApiKey: string
  videoModel: string
  /** Seedream 图片：手动接口。 */
  imageBaseUrl: string
  imageApiKey: string
  imageModel: string
  /** 是否向 Agent 介绍本插件。 */
  announceToAgent: boolean
  /** 项目根目录；空 = <workspace>/.dsh-aidrama/projects。 */
  dataDir: string
}

export interface ConfigView {
  config: PluginConfig
  defaults: { provider: string, model: string }
  dataRoot: string
  dshAvailable: boolean
}

export interface DshModelOption {
  id: string
  name: string
  modalities: string[]
}

export interface DshProviderOption {
  id: string
  name: string
  models: DshModelOption[]
  routeReady: boolean
  error?: string
}

export interface DshModelCatalog {
  providers: DshProviderOption[]
  default?: { provider: string, model: string }
  errors: string[]
}

/* ------------------------------------------------------------------ */
/* 项目                                                                */
/* ------------------------------------------------------------------ */

export type DialectId = 'generic' | 'seedance-2.0' | 'seedance-2.5' | 'minimax-h3' | 'kling' | 'wan-3.0'

export const DIALECTS: Array<{ id: DialectId, label: string, note: string }> = [
  { id: 'generic', label: '通用中文', note: '五段式自然语言，跨模型保底' },
  { id: 'seedance-2.0', label: 'Seedance 2.0', note: '镜头序号、@图片N、4–15 秒' },
  { id: 'seedance-2.5', label: 'Seedance 2.5', note: '整数秒时间戳、edit/extend、4–30 秒' },
  { id: 'minimax-h3', label: 'MiniMax H3', note: '三段/六段英文结构、<Picture N>、首尾帧与参考互斥' },
  { id: 'kling', label: 'Kling（实验）', note: '仅写法级模板，未做协议级核对' },
  { id: 'wan-3.0', label: 'Wan 3.0（实验）', note: '仅写法级模板，未做协议级核对' },
]

/** 提示词方言跟随视频模型，不再单独让用户选。 */
export function dialectForVideoModel(model: string): DialectId | undefined {
  const value = model.toLowerCase()
  if (/seedance[-_ ]?2[-_.]?5/.test(value)) return 'seedance-2.5'
  if (/seedance[-_ ]?2[-_.]?0/.test(value)) return 'seedance-2.0'
  if (/minimax|(^|[^a-z])h3([^0-9]|$)/.test(value)) return 'minimax-h3'
  if (/kling/.test(value)) return 'kling'
  if (/wan[-_ ]?3/.test(value)) return 'wan-3.0'
  return undefined
}

export const PLATFORMS = ['douyin', 'kuaishou', 'wechat', 'xiaohongshu', 'youtube'] as const
export type Platform = typeof PLATFORMS[number]

export const GENRES = ['urban', 'costume', 'xianxia', 'suspense', 'scifi', 'realism', 'family', 'sweet', 'comedy'] as const
export type Genre = typeof GENRES[number]

export type StageId = 'concept' | 'bible' | 'assets' | 'episodes' | 'canvas' | 'director' | 'storyboard' | 'prompts' | 'production' | 'qc'

export const STAGES: Array<{ id: StageId, label: string, hint: string }> = [
  { id: 'concept', label: '构想', hint: '一句话、平台、时长、题材、受众、禁区' },
  { id: 'bible', label: '总纲', hint: '主题、世界观、三幕、集数规划、钩子节奏' },
  { id: 'assets', label: '资产', hint: '角色 8+1、LOOK、状态链；场景；道具；风格锚' },
  { id: 'episodes', label: '分集', hint: '节拍表与剧本；台词短句化；资产变更' },
  { id: 'canvas', label: '画布', hint: '把角色、场景、道具、分镜和 3D 导演台节点连成创作链路' },
  { id: 'director', label: '3D导演台', hint: '灰盒站位、机位、镜头预览；导出构图参考' },
  { id: 'storyboard', label: '分镜', hint: '一镜一主动作；景别/运镜/站位；参考四态' },
  { id: 'prompts', label: '提示词', hint: '选方言 → 编译 → 硬校验' },
  { id: 'production', label: '生产', hint: '任务单、确认、台账、成本' },
  { id: 'qc', label: '质检', hint: '生成前/后检查、失败分类、导出' },
]

export interface Meta {
  platform: Platform
  orientation: 'portrait' | 'landscape'
  genre: Genre
  targetEpisodes: number
  episodeSeconds: number
  /** fixed = 用单集时长卡；auto = 按对白/动作回填每集实际时长。 */
  durationMode: 'fixed' | 'auto'
  audience: string
  logline: string
  theme: string
  hook: string
  forbidden: string[]
  dialect: DialectId
}

export interface CharacterSlots {
  ageGender: string
  face: string
  hair: string
  body: string
  outfit: string
  accessories: string
  temperament: string
  forbidden: string
  lightBaseline: string
}

export interface Look {
  id: string
  text: string
  episodes: string[]
  refs: { front: string, side: string, back: string, main: string }
  refPrompts: { front: string, side: string, back: string, sheet: string }
}

export interface StateVariant {
  id: string
  change: string
  fromShot: string
  affects: string[]
}

export interface Character {
  id: string
  name: string
  role: string
  /** 角色定位的剧本原句证据（通用校验，不写死具体称谓）。 */
  roleEvidence?: string[]
  status: 'draft' | 'locked'
  /** 共享资产：出现在哪些集；空表示尚未建立集引用。 */
  appearsIn: string[]
  slots: CharacterSlots
  lockText: string
  /** 身份锁（脸/发型/体型/气质），不含服装；造型由 LOOK 提供。 */
  identityLock: string
  looks: Look[]
  stateVariants: StateVariant[]
  refs: { front: string, side: string, back: string, expression: string, main: string }
  refPrompts: { front: string, side: string, back: string, sheet: string }
  voiceCard: {
    voiceId: string
    ageRange: string
    rate: string
    baseline: string
    forbidden: string
    /** MiMo voicedesign 生成的角色样音（项目相对路径）。 */
    voiceSample: string
    /** 音色设计描述；同一角色重设计时复用。 */
    designPrompt: string
    /** 试音文本。 */
    sampleText: string
    designedAt: number
  }
}

export interface Scene {
  id: string
  name: string
  /** 共享资产：出现在哪些集；空表示尚未建立集引用。 */
  appearsIn: string[]
  space: string
  props: string
  palette: string
  keyLight: string
  /** Seedream 生成/上传的场景参考图（项目相对路径）。 */
  refImage: string
  variants: Array<{ id: string, change: string }>
}

export interface Prop {
  id: string
  name: string
  /** 共享资产：出现在哪些集；空表示尚未建立集引用。 */
  appearsIn: string[]
  function: 'evidence' | 'identity' | 'countdown' | 'keepsake' | 'obstacle'
  appearance: string
  owner: string
  endPosition: string
  /** Seedream 生成/上传的道具参考图（项目相对路径）。 */
  refImage: string
}

export interface StyleAnchor {
  id: string
  name: string
  /** 自由描述：画风、材质、镜头语言。 */
  prompt: string
  avoid: string[]
  /** proposed 只供预览；媒体生成只认 accepted。 */
  status?: 'proposed' | 'accepted'
  /** L1 媒介/渲染：写实/3D/2D、质感、清晰度。 */
  medium?: string
  /** L5 全片色彩基调；具体场景色由 Scene.palette 覆盖。 */
  palette?: string
  /** 光线基调。 */
  lighting?: string
  /** 镜头语言偏好。 */
  lens?: string
  /** 材质/颗粒/皮肤/布料。 */
  texture?: string
  /** 风格参考图（项目相对路径），用于锁定和后续参考。 */
  referenceImage?: string
}

export interface Beat {
  id: string
  function: 'hook' | 'goal' | 'obstacle' | 'twist' | 'choice' | 'cliff'
  seconds: number
  text: string
}

export type RefState = 'ref' | 'plan' | 'missing' | 't2v'
export type RefRole = 'identity' | 'look' | 'geo' | 'composition' | 'scale' | 'effect' | 'first' | 'last' | 'style'

export interface ShotRef {
  slot: string
  state: RefState
  role: RefRole
  path: string
  note: string
}

export interface DialogueLine {
  speaker: string
  text: string
  offScreen: boolean
  voiceOver: boolean
}

export interface ShotSound {
  ambience: string
  sfx: string
  music: string
}

export interface ShotPrompt {
  dialect: DialectId | ''
  text: string
  compiledAt: number
  /** 编译器版本；旧版本在生成视频前会自动重编译。 */
  version: number
  /** 编译时输入的指纹；与当前数据不一致说明提示词已过期。 */
  inputHash: string
  warnings: string[]
}

export interface Shot {
  id: string
  sceneId: string
  duration: number
  size: string
  camera: string
  blocking: string
  action: string
  endState: string
  emotion: { start: string, trigger: string, end: string }
  dialogue: DialogueLine[]
  sound: ShotSound
  refs: ShotRef[]
  locks: string[]
  /** 角色 ID → LOOK ID；按镜头绑定服装，不绑定则用默认 LOOK。 */
  wardrobe: Record<string, string>
  status: 'draft' | 'ready' | 'compiled' | 'approved' | 'generated'
  /** Seedance 生成的对白视频（项目相对路径）。 */
  videoPath: string
  prompt: ShotPrompt
}

/** 一个片段 = 一次视频生成任务，内部含 2–4 个子镜头，总时长 ≤15s。 */
export interface Segment {
  id: string
  title: string
  shotIds: string[]
  duration: number
  sceneId: string
  /** 本片段引用的共享 LOOK ID。 */
  cast: string[]
  status: 'draft' | 'ready' | 'prompted' | 'generated'
  videoPath: string
  prompt: ShotPrompt
}

export interface Episode {
  id: string
  title: string
  logline: string
  status: 'draft' | 'scripted' | 'boarded' | 'prompted'
  /** 0 = 用 project.meta.episodeSeconds；auto 模式估算后写实际目标秒数。 */
  targetSeconds: number
  beats: Beat[]
  script: string
  /** 资产拆解后锁定剧本；解锁需显式操作并标记下游过期。 */
  scriptLocked: boolean
  scriptHash: string
  shots: Shot[]
  segments: Segment[]
}

export interface Decision {
  id: string
  field: string
  status: 'proposed' | 'accepted'
  value: string
  at: number
}

export interface Job {
  id: string
  kind: 'image' | 'video' | 'tts' | 'music'
  shotId: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  providerTaskId: string
  costCny: number
  startedAt: number
  endedAt: number
  note: string
}

export interface LedgerEntry {
  at: number
  shotId: string
  event: string
  detail: string
  costCny: number
}

export interface ScriptCastMember {
  name: string
  gender: '男' | '女' | '未知'
  role: string
  roleEvidence: string[]
  evidence: string
  costume: string
  costumeEvidence: string
}

export interface ScriptLocation {
  name: string
  evidence: string
}

export interface ScriptEpisodeAnalysis {
  episodeId: string
  cast: ScriptCastMember[]
  locations: ScriptLocation[]
}

export interface ScriptAnalysis {
  episodes: ScriptEpisodeAnalysis[]
  accepted: boolean
  generatedAt: number
}

export interface Project {
  schema: 'dsh-aidrama/v1'
  id: string
  title: string
  createdAt: number
  updatedAt: number
  revision: number
  meta: Meta
  bible: {
    premise: string
    world: string
    arc: string
    episodePlan: string
    visualDirection: string
  }
  characters: Character[]
  scenes: Scene[]
  props: Prop[]
  styles: StyleAnchor[]
  episodes: Episode[]
  scriptAnalysis: ScriptAnalysis
  decisions: Decision[]
  jobs: Job[]
  ledger: LedgerEntry[]
  /** 画布节点位置/连线；随 project.json 持久化，旧项目缺失时从 localStorage 迁移。 */
  canvas?: unknown
  /** 3D 导演台对象/机位/时间轴；随 project.json 持久化。 */
  director?: unknown
}

export interface ProjectSummary {
  id: string
  title: string
  cwd: string
  revision: number
  updatedAt: number
  episodes: number
  shots: number
  genre: Genre
  platform: Platform
  stage: StageId
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

export type RuleLevel = 'error' | 'warn' | 'info'

export interface Finding {
  ruleId: string
  level: RuleLevel
  message: string
  episodeId?: string
  shotId?: string
  field?: string
}

export interface ValidationResult {
  findings: Finding[]
  errors: number
  warns: number
  checkedAt: number
}

/* ------------------------------------------------------------------ */
/* 生成                                                                */
/* ------------------------------------------------------------------ */

export type GenerateStage = 'bible' | 'characters' | 'scenes' | 'props' | 'episode' | 'shots'

export interface GenerateRequest {
  projectId: string
  stage: GenerateStage
  episodeId?: string
  instruction?: string
}

export interface GenerateResult {
  project: Project
  notes: string
  usage?: { inputTokens: number, outputTokens: number }
}

export interface CompileRequest {
  projectId: string
  episodeId: string
  shotId?: string
  dialect: DialectId
}

export interface CompileResult {
  project: Project
  compiled: number
  findings: Finding[]
}
