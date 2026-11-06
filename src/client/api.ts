/** 浏览器侧桥接客户端：所有请求都打到本机同源路由。 */

import type {
  ApiEnvelope,
  CompileRequest,
  CompileResult,
  ConfigView,
  DshModelCatalog,
  GenerateRequest,
  GenerateResult,
  PluginConfig,
  Project,
  ProjectSummary,
  StageId,
  ValidationResult,
} from '../shared/types.ts'
import { API } from '../shared/types.ts'

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`桥接接口 HTTP ${response.status}`)
  const envelope = await response.json() as ApiEnvelope<T> & { value?: { currentRevision?: number } }
  if (envelope.ok !== true) {
    const conflict = (envelope.value as { currentRevision?: number } | undefined)?.currentRevision
    const error = new Error(envelope.error ?? '宿主返回失败') as Error & { conflictRevision?: number }
    if (typeof conflict === 'number') error.conflictRevision = conflict
    throw error
  }
  return envelope.value as T
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`桥接接口 HTTP ${response.status}`)
  const envelope = await response.json() as ApiEnvelope<T>
  if (envelope.ok !== true) throw new Error(envelope.error ?? '宿主返回失败')
  return envelope.value as T
}

export interface SessionInfo {
  sessionId: string
  cwd: string
  home?: boolean
  binding?: { projectId: string, cwd: string, boundAt: number }
}

export interface ProjectsPayload {
  cwd: string
  projectsRoot: string
  dataDir: string
  projects: ProjectSummary[]
  sessionId: string
  boundProjectId?: string
  stages: StageId[]
}

export interface ProjectPayload {
  project: Project
  summary?: ProjectSummary
  stage: StageId
  validation: ValidationResult
  projectDir?: string
}

export interface ImportPreviewPayload {
  project: Project
  notes: string
  warnings: string[]
  usage: { inputTokens: number, outputTokens: number }
  validation: ValidationResult
  newProject: boolean
}

export interface ImportRequest {
  cwd: string
  sessionId: string
  projectId?: string
  title?: string
  text?: string
  fileBase64?: string
  fileName?: string
  instruction?: string
}

export class DramaApi {
  session(sessionId: string): Promise<SessionInfo> {
    return postJson<SessionInfo>(API.session, { sessionId })
  }

  config(): Promise<ConfigView> {
    return getJson<ConfigView>(API.config)
  }

  saveConfig(config: Partial<PluginConfig>): Promise<ConfigView> {
    return postJson<ConfigView>(API.config, { config })
  }

  models(force = false): Promise<DshModelCatalog> {
    return getJson<DshModelCatalog>(`${API.models}${force ? '?refresh=1' : ''}`)
  }

  projects(cwd: string, sessionId: string): Promise<ProjectsPayload> {
    const search = new URLSearchParams({ cwd, sessionId })
    return getJson<ProjectsPayload>(`${API.projects}?${search.toString()}`)
  }

  createProject(cwd: string, sessionId: string, title: string): Promise<{ project: Project }> {
    return postJson<{ project: Project }>(API.projects, { cwd, sessionId, title })
  }

  getProject(cwd: string, projectId: string, sessionId: string): Promise<ProjectPayload> {
    const search = new URLSearchParams({ cwd, projectId, sessionId })
    return getJson<ProjectPayload>(`${API.project}?${search.toString()}`)
  }

  saveProject(cwd: string, project: Project, expectedRevision: number): Promise<{ project: Project }> {
    return postJson<{ project: Project }>(API.project, { cwd, action: 'save', project, expectedRevision })
  }

  deleteProject(cwd: string, projectId: string): Promise<{ deleted: boolean }> {
    return postJson<{ deleted: boolean }>(API.project, { cwd, action: 'delete', projectId })
  }

  bind(cwd: string, projectId: string, sessionId: string): Promise<{ bound: boolean }> {
    return postJson<{ bound: boolean }>(API.project, { cwd, action: 'bind', projectId, sessionId })
  }

  moveProjects(cwd: string, targetDir: string): Promise<{ moved: number, projectsRoot: string, dataDir: string }> {
    return postJson<{ moved: number, projectsRoot: string, dataDir: string }>(API.moveProjects, { cwd, targetDir })
  }

  estimate(cwd: string, projectId: string, episodeId?: string): Promise<{ project: Project, estimates: Array<{ episodeId: string, targetSeconds: number }>, validation: ValidationResult }> {
    return postJson<{ project: Project, estimates: Array<{ episodeId: string, targetSeconds: number }>, validation: ValidationResult }>(API.estimate, { cwd, projectId, episodeId })
  }

  createEpisode(cwd: string, projectId: string, expectedRevision: number): Promise<{ project: Project, episodeId: string }> {
    return postJson<{ project: Project, episodeId: string }>(API.project, { cwd, action: 'create-episode', projectId, expectedRevision })
  }

  importPreview(request: ImportRequest): Promise<ImportPreviewPayload> {
    return postJson<ImportPreviewPayload>(API.importPreview, request)
  }

  importApply(input: {
    cwd: string
    sessionId: string
    projectId?: string
    parent?: string
    project: Project
    expectedRevision?: number
  }): Promise<{ project: Project, validation: ValidationResult }> {
    return postJson<{ project: Project, validation: ValidationResult }>(API.importApply, input)
  }

  designVoice(input: {
    cwd: string
    projectId: string
    characterId: string
    description?: string
    sampleText?: string
    expectedRevision?: number
  }): Promise<{ project: Project, characterId: string, audioPath: string, bytes: number, validation: ValidationResult }> {
    return postJson<{ project: Project, characterId: string, audioPath: string, bytes: number, validation: ValidationResult }>(API.voiceDesign, input)
  }

  generateVideo(input: {
    cwd: string
    projectId: string
    shotId: string
    expectedRevision?: number
  }): Promise<{ project: Project, shotId: string, videoPath: string, taskId: string, validation: ValidationResult }> {
    return postJson<{ project: Project, shotId: string, videoPath: string, taskId: string, validation: ValidationResult }>(API.videoGenerate, input)
  }

  generateSegmentVideo(input: {
    cwd: string
    projectId: string
    segmentId: string
    expectedRevision?: number
  }): Promise<{ project: Project, segmentId: string, videoPath: string, taskId: string, validation: ValidationResult }> {
    return postJson<{ project: Project, segmentId: string, videoPath: string, taskId: string, validation: ValidationResult }>(API.segmentVideo, input)
  }

  analyze(input: { cwd: string, projectId: string, expectedRevision?: number }): Promise<{ project: Project, validation: ValidationResult }> {
    return postJson<{ project: Project, validation: ValidationResult }>(API.analyze, input)
  }

  generateImage(input: {
    cwd: string
    projectId: string
    target: 'character' | 'scene' | 'prop' | 'shot'
    id: string
    view?: 'front' | 'side' | 'back' | 'sheet'
    lookId?: string
    prompt?: string
    expectedRevision?: number
  }): Promise<{ project: Project, target: string, id: string, imagePath: string, bytes: number, episodeId: string, validation: ValidationResult }> {
    return postJson<{ project: Project, target: string, id: string, imagePath: string, bytes: number, episodeId: string, validation: ValidationResult }>(API.imageGenerate, input)
  }

  uploadShotImage(input: {
    cwd: string
    projectId: string
    shotId: string
    dataBase64: string
    mime: string
    expectedRevision?: number
  }): Promise<{ project: Project, shotId: string, imagePath: string, validation: ValidationResult }> {
    return postJson<{ project: Project, shotId: string, imagePath: string, validation: ValidationResult }>(API.shotImage, input)
  }

  applyCanvasImage(input: {
    cwd: string
    projectId: string
    target: 'character' | 'scene'
    id: string
    dataUrl: string
    expectedRevision?: number
  }): Promise<{ project: Project, imagePath: string }> {
    return postJson<{ project: Project, imagePath: string }>(API.applyCanvasImage, input)
  }

  assetUrl(cwd: string, projectId: string, path: string): string {
    const search = new URLSearchParams({ cwd, projectId, path })
    return `${API.asset}?${search.toString()}`
  }

  generate(request: Omit<GenerateRequest, 'projectId'> & { cwd: string, projectId: string }): Promise<GenerateResult & { validation: ValidationResult }> {
    return postJson<GenerateResult & { validation: ValidationResult }>(API.generate, request)
  }

  compile(request: Omit<CompileRequest, 'projectId'> & { cwd: string, projectId: string, expectedRevision: number }): Promise<CompileResult> {
    return postJson<CompileResult>(API.compile, request)
  }

  validate(cwd: string, projectId: string, episodeId?: string): Promise<{ validation: ValidationResult, project: Project }> {
    return postJson<{ validation: ValidationResult, project: Project }>(API.validate, { cwd, projectId, episodeId })
  }

  export(cwd: string, projectId: string): Promise<{ dir: string, files: string[] }> {
    return postJson<{ dir: string, files: string[] }>(API.export, { cwd, projectId })
  }
}
