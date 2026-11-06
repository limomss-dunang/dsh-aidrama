/**
 * 短剧工坊主界面：会话视图里的三栏制片台。
 * 左：阶段导航；中：当前阶段；右：检查器 + 校验摘要。
 * 所有写操作先落到本地草稿，点保存/生成/编译时再原子提交；冲突时重新载入。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConfigView, DialectId, DshModelCatalog, Finding, Project, ProjectSummary, StageId, ValidationResult,
} from '../shared/types.ts'
import { DIALECTS, GENRES, PLATFORMS, STAGES, dialectForVideoModel } from '../shared/types.ts'
import { missingPrerequisites } from '../shared/precheck.ts'
import { CanvasPanel } from './CanvasPanel.tsx'
import { DirectorPanel } from './DirectorPanel.tsx'
import { DramaApi, type ImportPreviewPayload, type ProjectsPayload } from './api.ts'
import { shellStyle } from './styles.ts'
import { tt } from './locale.ts'
import { mergeProject } from './merge.ts'
import {
  Badge, Btn, Field, Findings, GENRE_LABEL, Input, PLATFORM_LABEL, Select, clone, errorOf,
  Area,
  type AssetKind, type Mutate, type Selection, type Toast,
} from './ui.tsx'
import {
  AssetsPanel, BiblePanel, ConceptPanel, EpisodePanel, ProductionPanel, PromptsPanel, QcPanel, StoryboardPanel,
} from './panels.tsx'
import { CharacterInspector, PropInspector, SceneInspector, ShotInspector, StyleInspector } from './inspectors.tsx'

function stageCount(project: Project, stage: StageId): string {
  switch (stage) {
    case 'concept': return project.meta.logline.trim() === '' ? '·' : '✓'
    case 'bible': return project.bible.premise.trim() === '' ? '·' : '✓'
    case 'assets': return String(project.characters.length + project.scenes.length + project.props.length)
    case 'episodes': return String(project.episodes.length)
    case 'canvas': return '∞'
    case 'director': return '3D'
    case 'storyboard': return String(project.episodes.reduce((sum, episode) => sum + episode.shots.length, 0))
    case 'prompts': return String(project.episodes.reduce((sum, episode) => sum + episode.shots.filter(shot => shot.prompt.text.trim() !== '').length, 0))
    case 'production': return String(project.jobs.length)
    case 'qc': return String(project.ledger.length)
  }
}

function progressOf(project: Project): number {
  const checks = [
    project.meta.logline.trim() !== '',
    project.bible.premise.trim() !== '',
    project.characters.length > 0,
    project.episodes.length > 0,
    project.episodes.some(episode => episode.shots.length > 0),
    project.episodes.some(episode => episode.shots.some(shot => shot.prompt.text.trim() !== '')),
    project.jobs.length > 0,
  ]
  return Math.round(checks.filter(Boolean).length / checks.length * 100)
}

function NextSteps(props: { project: Project }) {
  const project = props.project
  const items: string[] = []
  if (project.meta.logline.trim() === '') items.push('写一句话（主角目标+阻碍+代价）')
  if (project.bible.premise.trim() === '') items.push('生成总纲')
  if (project.characters.length === 0) items.push('生成角色并锁定锁面')
  if (project.episodes.length === 0) items.push('生成第一集')
  if (project.episodes[0] !== undefined && project.episodes[0].shots.length === 0) items.push('拆分第一集分镜')
  const compiled = project.episodes.reduce((sum, episode) => sum + episode.shots.filter(shot => shot.prompt.text.trim() !== '').length, 0)
  const shots = project.episodes.reduce((sum, episode) => sum + episode.shots.length, 0)
  if (shots > 0 && compiled < shots) items.push('选方言并编译提示词')
  if (items.length === 0) items.push('导出五份 Markdown，进入生产')
  return <div className="ad-col ad-tiny">{items.map((item, index) => <div key={index}>{index + 1}. {item}</div>)}</div>
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function readScriptFile(file: File): Promise<{ text?: string, fileBase64?: string, fileName: string }> {
  if (file.name.toLowerCase().endsWith('.docx')) {
    return { fileBase64: toBase64(await file.arrayBuffer()), fileName: file.name }
  }
  return { text: await file.text(), fileName: file.name }
}

export function Workbench(props: { sessionId?: string, pickDirectory?: () => Promise<string | null> }) {
  const api = useMemo(() => new DramaApi(), [])
  const [cwd, setCwd] = useState<string>()
  const [home, setHome] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsRoot, setProjectsRoot] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [dataDir, setDataDir] = useState('')
  const [rootInput, setRootInput] = useState('')
  const [project, setProject] = useState<Project>()
  const [stage, setStage] = useState<StageId>('concept')
  const [episodeId, setEpisodeId] = useState<string>()
  const [selection, setSelection] = useState<Selection>()
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [validation, setValidation] = useState<ValidationResult>()
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState<Toast>()
  const [dirty, setDirty] = useState(false)
  const [assetTab, setAssetTab] = useState<AssetKind>('character')
  const [dialect, setDialect] = useState<DialectId>('seedance-2.5')
  const [dialog, setDialog] = useState<'new' | 'import' | 'settings' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [importText, setImportText] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importFileBase64, setImportFileBase64] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [preview, setPreview] = useState<ImportPreviewPayload>()
  const [config, setConfig] = useState<ConfigView>()
  const [models, setModels] = useState<DshModelCatalog>()
  const [settingsTab, setSettingsTab] = useState<'text' | 'image' | 'video' | 'voice' | 'project'>('text')
  const [instruction, setInstruction] = useState('')
  const projectRef = useRef<Project>()
  const editSeq = useRef(0)
  const openSeq = useRef(0)

  projectRef.current = project

  const flash = useCallback((next: Toast): void => {
    setToast(next)
    window.setTimeout(() => setToast(current => current === next ? undefined : current), 4200)
  }, [])

  const loadProjects = useCallback(async (targetCwd: string): Promise<ProjectsPayload> => {
    const payload = await api.projects(targetCwd, props.sessionId ?? '')
    setProjects(payload.projects)
    setProjectsRoot(payload.projectsRoot)
    setDataDir(payload.dataDir)
    setRootInput(current => current === '' ? payload.projectsRoot : current)
    return payload
  }, [api, props.sessionId])

  const openProject = useCallback(async (targetCwd: string, projectId: string): Promise<void> => {
    const token = ++openSeq.current
    const payload = await api.getProject(targetCwd, projectId, props.sessionId ?? '')
    if (token !== openSeq.current) return
    setProject(payload.project)
    setProjectDir(payload.projectDir ?? '')
    setValidation(payload.validation)
    setDirty(false)
    setSelection(undefined)
    setEpisodeId(payload.project.episodes[0]?.id)
    setDialect(payload.project.meta.dialect)
    setStage(payload.stage)
  }, [api, props.sessionId])

  useEffect(() => {
    const sessionId = props.sessionId ?? ''
    let cancelled = false
    // 会话变了就先停用旧项目，避免把旧 projectId 发向新 cwd。
    setProject(undefined)
    setProjectDir('')
    setSelection(undefined)
    setEpisodeId(undefined)
    setValidation(undefined)
    setDirty(false)
    void (async () => {
      try {
        const info = await api.session(sessionId)
        if (cancelled) return
        setCwd(info.cwd)
        setHome(info.home === true)
        const payload = await loadProjects(info.cwd)
        if (cancelled) return
        const target = payload.boundProjectId ?? payload.projects[0]?.id
        if (target !== undefined) {
          await openProject(info.cwd, target)
          if (!cancelled && sessionId !== '') await api.bind(info.cwd, target, sessionId)
        }
      } catch (error) {
        if (!cancelled) flash({ kind: 'error', text: errorOf(error) })
      }
    })()
    return () => { cancelled = true }
  }, [api, loadProjects, openProject, props.sessionId, flash])

  const mutate: Mutate = useCallback((fn) => {
    editSeq.current += 1
    setProject(current => {
      if (current === undefined) return current
      const draft = clone(current)
      fn(draft)
      draft.updatedAt = Date.now()
      return draft
    })
    setDirty(true)
  }, [])

  const save = useCallback(async (force?: Project): Promise<Project | undefined> => {
    const target = force ?? projectRef.current
    if (target === undefined || cwd === undefined) return target
    const startSeq = editSeq.current
    setBusy('保存')
    try {
      const payload = await api.saveProject(cwd, target, target.revision)
      if (projectRef.current?.id !== target.id) {
        flash({ kind: 'info', text: '该项目已保存，但你已切到其它项目；未接管当前视图。' })
        return payload.project
      }
      if (editSeq.current !== startSeq) {
        setProject(current => current === undefined ? payload.project : { ...current, revision: payload.project.revision })
        setDirty(true)
        flash({ kind: 'info', text: '保存期间有新编辑；已保留当前草稿，请再次保存。' })
        return payload.project
      }
      setProject(payload.project)
      setDirty(false)
      return payload.project
    } catch (error) {
      const conflict = error as Error & { conflictRevision?: number }
      if (typeof conflict.conflictRevision === 'number') {
        flash({ kind: 'info', text: '项目已在别处更新；本地草稿已保留。请复制需要保留的修改，再重新载入项目。' })
        return undefined
      }
      flash({ kind: 'error', text: errorOf(error) })
      return undefined
    } finally {
      setBusy('')
    }
  }, [api, cwd, flash, openProject])

  const ensureSaved = useCallback(async (): Promise<Project | undefined> => {
    if (!dirty) return projectRef.current
    return await save()
  }, [dirty, save])

  const generate = useCallback(async (target: 'bible' | 'characters' | 'scenes' | 'props' | 'episode' | 'shots'): Promise<void> => {
    if (project !== undefined) {
      const missing = missingPrerequisites(project, target, target === 'shots' ? (episodeId ?? '') : '')
      if (missing.length > 0) {
        flash({ kind: 'error', text: `前置条件未满足：${missing.join('、')}` })
        return
      }
    }
    const saved = await ensureSaved()
    if (saved === undefined || cwd === undefined) return
    const label = target === 'bible' ? '生成总纲' : target === 'episode' ? '生成本集节拍' : target === 'shots' ? '生成分镜' : '生成资产'
    const startSeq = editSeq.current
    setBusy(label)
    try {
      const payload = await api.generate({
        cwd,
        projectId: saved.id,
        stage: target,
        episodeId: target === 'episode' || target === 'shots' ? (episodeId ?? saved.episodes[0]?.id) : undefined,
        instruction: instruction.trim() || undefined,
      })
      if (projectRef.current?.id !== saved.id) {
        flash({ kind: 'info', text: '生成已完成，但期间已切到其它项目；结果已保存，未接管当前视图。' })
        return
      }
      if (editSeq.current !== startSeq) {
        const current = projectRef.current
        const merged = current === undefined ? undefined : mergeProject(saved, payload.project, current)
        setProject(merged === undefined
          ? current ?? payload.project
          : { ...(merged.project as unknown as Project), revision: payload.project.revision })
        setDirty(true)
        setValidation(payload.validation)
        flash({
          kind: 'info',
          text: merged === undefined
            ? '生成期间有新编辑；结果未覆盖当前草稿，请确认后再保存。'
            : merged.conflicts === 0
              ? '生成期间有新编辑；生成结果已合并进当前草稿，本地编辑保留。'
              : `生成期间有新编辑；结果已合并，{merged.conflicts} 个同字段冲突以本地为准。`,
        })
        return
      }
      setProject(payload.project)
      setValidation(payload.validation)
      setDirty(false)
      setEpisodeId(current => current ?? payload.project.episodes[0]?.id)
      flash({ kind: 'ok', text: `${payload.notes}（tokens ${payload.usage?.inputTokens ?? 0}/${payload.usage?.outputTokens ?? 0}）` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, ensureSaved, episodeId, flash, instruction, project])

  const compile = useCallback(async (shotId?: string): Promise<void> => {
    const saved = await ensureSaved()
    if (saved === undefined || cwd === undefined) return
    const target = episodeId ?? saved.episodes[0]?.id
    if (target === undefined) {
      flash({ kind: 'error', text: '还没有分集。' })
      return
    }
    const startSeq = editSeq.current
    setBusy('编译')
    try {
      const payload = await api.compile({ cwd, projectId: saved.id, episodeId: target, shotId, dialect, expectedRevision: saved.revision })
      if (projectRef.current?.id !== saved.id) {
        flash({ kind: 'info', text: '编译已完成，但期间已切到其它项目；结果已保存。' })
        return
      }
      if (editSeq.current !== startSeq) {
        const current = projectRef.current
        const merged = current === undefined ? undefined : mergeProject(saved, payload.project, current)
        setProject(merged === undefined
          ? current ?? payload.project
          : { ...(merged.project as unknown as Project), revision: payload.project.revision })
        setDialect(payload.project.meta.dialect)
        setDirty(true)
        flash({
          kind: 'info',
          text: merged === undefined
            ? '编译期间有新编辑；结果未覆盖当前草稿。'
            : merged.conflicts === 0
              ? '编译期间有新编辑；编译结果已合并，本地编辑保留。'
              : `编译期间有新编辑；结果已合并，{merged.conflicts} 个同字段冲突以本地为准。`,
        })
        return
      }
      setProject(payload.project)
      setDialect(payload.project.meta.dialect)
      const result = await api.validate(cwd, saved.id, target)
      setValidation(result.validation)
      setDirty(false)
      flash({ kind: 'ok', text: `已编译 ${payload.compiled} 镜` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, dialect, ensureSaved, episodeId, flash])

  const validateNow = useCallback(async (): Promise<void> => {
    const saved = await ensureSaved()
    if (saved === undefined || cwd === undefined) return
    setBusy('校验')
    try {
      const payload = await api.validate(cwd, saved.id, episodeId)
      setValidation(payload.validation)
      flash({ kind: 'ok', text: `校验完成：${payload.validation.errors} error / ${payload.validation.warns} warn` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, ensureSaved, episodeId, flash])

  const fixZeroBeats = useCallback(async (): Promise<void> => {
    const saved = await ensureSaved()
    if (saved === undefined || cwd === undefined) return
    const draft = clone(saved)
    let changed = 0
    for (const episode of draft.episodes) {
      if (episode.beats.length === 0) continue
      const sum = episode.beats.reduce((total, beat) => total + beat.seconds, 0)
      if (sum !== 0) continue
      const base = Math.max(1, Math.floor(saved.meta.episodeSeconds / episode.beats.length))
      const rest = Math.max(0, saved.meta.episodeSeconds - base * episode.beats.length)
      episode.beats = episode.beats.map((beat, index) => ({
        ...beat,
        seconds: base + (index === episode.beats.length - 1 ? rest : 0),
      }))
      changed += 1
    }
    if (changed === 0) {
      flash({ kind: 'info', text: '没有全 0 秒的节拍表' })
      return
    }
    setBusy('修复节拍')
    try {
      const payload = await api.saveProject(cwd, draft, saved.revision)
      setProject(payload.project)
      setDirty(false)
      const result = await api.validate(cwd, payload.project.id)
      setValidation(result.validation)
      flash({ kind: 'ok', text: `已按单集时长均分 ${changed} 集的节拍秒数` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, ensureSaved, flash])

  const estimateDuration = useCallback(async (targetEpisodeId?: string): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    setBusy('估算时长')
    try {
      const result = await api.estimate(cwd, current.id, targetEpisodeId)
      setProject(result.project)
      setDirty(false)
      setValidation(result.validation)
      const summary = result.estimates.map(item => `${item.episodeId}=${item.targetSeconds}s`).join('，')
      flash({ kind: 'ok', text: `已按内容回填：${summary}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, ensureSaved, flash, project])

  const createProject = useCallback(async (): Promise<void> => {
    if (cwd === undefined) return
    const sessionId = props.sessionId ?? ''
    const chosenRoot = rootInput.trim()
    setBusy('新建项目')
    try {
      if (chosenRoot !== projectsRoot) {
        await api.moveProjects(cwd, chosenRoot)
      }
      const payload = await api.createProject(cwd, sessionId, newTitle.trim() || '未命名短剧')
      setDialog(null)
      setNewTitle('')
      await loadProjects(cwd)
      await openProject(cwd, payload.project.id)
      if (sessionId !== '') await api.bind(cwd, payload.project.id, sessionId)
      flash({ kind: 'ok', text: `项目已创建：${payload.project.id}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, flash, loadProjects, newTitle, openProject, props.sessionId, projectsRoot, rootInput])

  const parseImport = useCallback(async (existing: boolean): Promise<void> => {
    if (cwd === undefined) return
    if (importText.trim() === '' && importFileBase64 === '') {
      flash({ kind: 'error', text: '先选择剧本文件或粘贴剧本内容' })
      return
    }
    setImportBusy(true)
    try {
      const result = await api.importPreview({
        cwd,
        sessionId: props.sessionId ?? '',
        ...(existing && project !== undefined ? { projectId: project.id } : {}),
        title: newTitle.trim(),
        text: importText.trim() || undefined,
        fileBase64: importFileBase64 || undefined,
        fileName: importFileName || undefined,
      })
      setPreview(result)
      setDialog(null)
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setImportBusy(false)
    }
  }, [api, cwd, flash, importFileBase64, importFileName, importText, newTitle, project, props.sessionId])

  const applyImport = useCallback(async (): Promise<void> => {
    if (preview === undefined || cwd === undefined) return
    setImportBusy(true)
    try {
      const existing = project !== undefined && !preview.newProject
      const result = await api.importApply({
        cwd,
        sessionId: props.sessionId ?? '',
        ...(existing ? { projectId: project.id, expectedRevision: project.revision } : { parent: rootInput }),
        project: preview.project,
      })
      setPreview(undefined)
      setDialog(null)
      setImportText('')
      setImportFileBase64('')
      setImportFileName('')
      await loadProjects(cwd)
      await openProject(cwd, result.project.id)
      flash({ kind: 'ok', text: `剧本已导入：${result.project.title}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setImportBusy(false)
    }
  }, [api, cwd, flash, loadProjects, openProject, preview, project, props.sessionId, rootInput])

  const openImportDialog = useCallback((existing: boolean): void => {
    setImportText('')
    setImportFileName('')
    setImportFileBase64('')
    setPreview(undefined)
    if (existing) setDialog('import')
    else {
      setRootInput(projectsRoot)
      setDialog('new')
    }
  }, [projectsRoot])

  const deleteProject = useCallback(async (): Promise<void> => {
    const target = project
    if (target === undefined || cwd === undefined) return
    if (!window.confirm(tt('confirmDelete'))) return
    try {
      await api.deleteProject(cwd, target.id)
      setProject(undefined)
      setValidation(undefined)
      setDirty(false)
      const payload = await loadProjects(cwd)
      const next = payload.projects[0]
      if (next !== undefined) await openProject(cwd, next.id)
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    }
  }, [api, cwd, flash, loadProjects, openProject, project])

  const newEpisode = useCallback(async (): Promise<void> => {
    const saved = await ensureSaved()
    if (saved === undefined || cwd === undefined) return
    try {
      const payload = await api.createEpisode(cwd, saved.id, saved.revision)
      setProject(payload.project)
      setEpisodeId(payload.episodeId)
      setDirty(false)
      setStage('episodes')
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    }
  }, [api, cwd, ensureSaved, flash])

  const exportNow = useCallback(async (): Promise<void> => {
    const saved = await ensureSaved()
    if (saved === undefined || cwd === undefined) return
    setBusy('导出')
    try {
      const payload = await api.export(cwd, saved.id)
      flash({ kind: 'ok', text: `${tt('exportDone')}：${payload.dir}（${payload.files.length} 个文件）` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, ensureSaved, flash])

  const openSettings = useCallback(async (): Promise<void> => {
    setDialog('settings')
    try {
      const [view, catalog] = await Promise.all([api.config(), api.models()])
      setConfig(view)
      setModels(catalog)
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    }
  }, [api, flash])

  const moveProjects = useCallback(async (targetDir: string): Promise<void> => {
    if (cwd === undefined) return
    const label = targetDir === '' ? '当前工作区的 .dsh-aidrama/projects' : targetDir
    if (!window.confirm(`把所有项目移动到：\n${label}\n\n移动后项目 ID 不变；请先保存未保存的改动。`)) return
    setBusy('移动项目')
    try {
      const result = await api.moveProjects(cwd, targetDir)
      setRootInput(result.projectsRoot)
      const view = await api.config()
      setConfig(view)
      const payload = await loadProjects(cwd)
      if (project !== undefined) {
        if (payload.projects.some(item => item.id === project.id)) await openProject(cwd, project.id)
        else {
          setProject(undefined)
          setProjectDir('')
        }
      }
      flash({ kind: 'ok', text: `已移动 ${result.moved} 个项目到 ${result.projectsRoot}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, cwd, flash, loadProjects, openProject, project])

  const saveSettings = useCallback(async (): Promise<void> => {
    if (config === undefined) return
    try {
      const view = await api.saveConfig(config.config)
      setConfig(view)
      setDialog(null)
      flash({ kind: 'ok', text: '设置已保存' })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    }
  }, [api, config, flash])

  const episode = project === undefined ? undefined : (project.episodes.find(item => item.id === episodeId) ?? project.episodes[0])
  const selectedShot = episode?.shots.find(shot => selection?.kind === 'shot' && shot.id === selection.id)
  const selectedCharacter = project?.characters.find(item => selection?.kind === 'character' && item.id === selection.id)
  const selectedScene = project?.scenes.find(item => selection?.kind === 'scene' && item.id === selection.id)
  const selectedProp = project?.props.find(item => selection?.kind === 'prop' && item.id === selection.id)
  const selectedStyle = project?.styles.find(item => selection?.kind === 'style' && item.id === selection.id)
  const hasInspector = selectedCharacter !== undefined || selectedScene !== undefined || selectedProp !== undefined || selectedStyle !== undefined || selectedShot !== undefined

  useEffect(() => {
    if (stage === 'canvas' || stage === 'director') setInspectorOpen(false)
  }, [stage])
  useEffect(() => {
    if (hasInspector) setInspectorOpen(true)
  }, [hasInspector])

  const applyFinding = (finding: Finding): void => {
    if (finding.episodeId !== undefined) setEpisodeId(finding.episodeId)
    if (finding.shotId !== undefined) {
      setStage('storyboard')
      setSelection({ kind: 'shot', id: finding.shotId })
    }
  }

  const patchPreview = (fn: (draft: Project) => void): void => {
    setPreview(current => {
      if (current === undefined) return current
      const project = clone(current.project)
      fn(project)
      return { ...current, project }
    })
  }

  const importFields = (
    <div className="ad-col">
      <Field label="剧本文件（TXT / Markdown / DOCX）">
        <input className="ad-input" type="file" accept=".txt,.md,.markdown,.docx"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file === undefined) return
            void readScriptFile(file).then(result => {
              setImportText(result.text ?? '')
              setImportFileBase64(result.fileBase64 ?? '')
              setImportFileName(result.fileName)
            }).catch(error => flash({ kind: 'error', text: errorOf(error) }))
          }} />
      </Field>
      {importFileName === '' ? null : <p className="ad-tiny ad-muted">已选择：{importFileName}</p>}
      <Field label="或粘贴剧本文本">
        <Area rows={6} value={importText} placeholder="直接粘贴剧本；会按「第X集 / EP01」标题自动拆集"
          onChange={value => {
            setImportText(value)
            if (value.trim() !== '') {
              setImportFileBase64('')
              setImportFileName('')
            }
          }} />
      </Field>
    </div>
  )

  const applyHostProject = useCallback((next: Project, nextValidation?: ValidationResult, startSeq?: number, base?: Project): void => {
    if (projectRef.current !== undefined && projectRef.current.id !== next.id) {
      flash({ kind: 'info', text: '结果已保存到原项目，但你已切到其它项目；未接管当前视图。' })
      return
    }
    if (startSeq !== undefined && editSeq.current !== startSeq) {
      const current = projectRef.current
      if (base !== undefined && current !== undefined) {
        const merged = mergeProject(base, next, current)
        setProject({ ...(merged.project as unknown as Project), revision: next.revision })
        setDirty(true)
        if (nextValidation !== undefined) setValidation(nextValidation)
        flash({
          kind: 'info',
          text: merged.conflicts === 0
            ? '生成期间有新编辑；已把服务端结果合并进当前草稿，未覆盖本地编辑。'
            : `生成期间有新编辑；服务端结果已合并，${merged.conflicts} 个同字段冲突以本地为准。`,
        })
        return
      }
      setProject(current === undefined ? next : { ...current, revision: next.revision })
      setDirty(true)
      if (nextValidation !== undefined) setValidation(nextValidation)
      flash({ kind: 'info', text: '生成期间有新编辑；结果未覆盖当前草稿。' })
      return
    }
    setProject(next)
    setDirty(false)
    if (nextValidation !== undefined) setValidation(nextValidation)
  }, [flash])

  const designVoice = useCallback(async (characterId: string, description: string, sampleText: string): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    const startSeq = editSeq.current
    setBusy(`voice:${characterId}`)
    try {
      const result = await api.designVoice({
        cwd, projectId: current.id, characterId, description, sampleText, expectedRevision: current.revision,
      })
      applyHostProject(result.project, result.validation, startSeq, current)
      flash({ kind: 'ok', text: `音色样音已生成：${result.audioPath}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, applyHostProject, cwd, ensureSaved, flash, project])

  const generateVideo = useCallback(async (shotId: string): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    const startSeq = editSeq.current
    setBusy(`video:${shotId}`)
    try {
      const result = await api.generateVideo({ cwd, projectId: current.id, shotId, expectedRevision: current.revision })
      applyHostProject(result.project, result.validation, startSeq, current)
      flash({ kind: 'ok', text: `视频已生成：${result.videoPath}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, applyHostProject, cwd, ensureSaved, flash, project])

  const generateSegmentVideo = useCallback(async (segmentId: string): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    const startSeq = editSeq.current
    setBusy(`segment:${segmentId}`)
    try {
      const result = await api.generateSegmentVideo({ cwd, projectId: current.id, segmentId, expectedRevision: current.revision })
      applyHostProject(result.project, result.validation, startSeq, current)
      flash({ kind: 'ok', text: `片段视频已生成：${result.videoPath}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, applyHostProject, cwd, ensureSaved, flash, project])

  const generateImage = useCallback(async (target: 'character' | 'scene' | 'prop' | 'shot', id: string, options?: { view?: 'front' | 'side' | 'back' | 'sheet', lookId?: string, prompt?: string }): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    const startSeq = editSeq.current
    setBusy(`imagegen:${id}`)
    try {
      const result = await api.generateImage({
        cwd, projectId: current.id, target, id, expectedRevision: current.revision,
        ...(options?.view === undefined ? {} : { view: options.view }),
        ...(options?.lookId === undefined ? {} : { lookId: options.lookId }),
        ...(options?.prompt === undefined ? {} : { prompt: options.prompt }),
      })
      applyHostProject(result.project, result.validation, startSeq, current)
      flash({ kind: 'ok', text: `图片已生成：${result.imagePath}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, applyHostProject, cwd, ensureSaved, flash, project])

  const applyCanvasImage = useCallback(async (target: 'character' | 'scene', id: string, dataUrl: string): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    const startSeq = editSeq.current
    setBusy(`apply-image:${id}`)
    try {
      const result = await api.applyCanvasImage({ cwd, projectId: current.id, target, id, dataUrl, expectedRevision: current.revision })
      applyHostProject(result.project, undefined, startSeq, current)
      flash({ kind: 'ok', text: `图片已应用：${result.imagePath}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, applyHostProject, cwd, ensureSaved, flash, project])

  const uploadShotImage = useCallback(async (shotId: string, file: File): Promise<void> => {
    if (project === undefined || cwd === undefined) return
    const current = await ensureSaved()
    if (current === undefined) return
    const startSeq = editSeq.current
    setBusy(`image:${shotId}`)
    try {
      const result = await api.uploadShotImage({
        cwd,
        projectId: current.id,
        shotId,
        dataBase64: toBase64(await file.arrayBuffer()),
        mime: file.type || 'image/png',
        expectedRevision: current.revision,
      })
      applyHostProject(result.project, result.validation, startSeq, current)
      flash({ kind: 'ok', text: `首帧已保存：${result.imagePath}` })
    } catch (error) {
      flash({ kind: 'error', text: errorOf(error) })
    } finally {
      setBusy('')
    }
  }, [api, applyHostProject, cwd, ensureSaved, flash, project])

  const assetUrl = useCallback((path: string): string => {
    if (cwd === undefined || project === undefined || path.trim() === '') return ''
    return api.assetUrl(cwd, project.id, path)
  }, [api, cwd, project])

  const hasZeroBeats = project?.episodes.some(episode =>
    episode.beats.length > 0 && episode.beats.reduce((total, beat) => total + beat.seconds, 0) === 0,
  ) ?? false
  const videoDialect = dialectForVideoModel(config?.config.videoModel ?? '')
  const videoDialectLabel = videoDialect === undefined ? '通用中文（未识别视频模型）' : (DIALECTS.find(item => item.id === videoDialect)?.label ?? videoDialect)
  const dshProviders = models?.providers ?? []
  const providerChoices = [
    { value: '', label: 'DSH 默认' },
    ...dshProviders.map(provider => ({ value: provider.id, label: provider.name || provider.id })),
  ]
  if (config !== undefined && config.config.provider !== '' && !providerChoices.some(item => item.value === config.config.provider)) {
    providerChoices.push({ value: config.config.provider, label: `当前：${config.config.provider}` })
  }
  const currentProvider = dshProviders.find(provider => provider.id === config?.config.provider)
  const modelChoices = [
    { value: '', label: '默认' },
    ...(currentProvider?.models ?? []).map(model => ({ value: model.id, label: model.id })),
  ]
  if (config !== undefined && config.config.model !== '' && !modelChoices.some(item => item.value === config.config.model)) {
    modelChoices.push({ value: config.config.model, label: `当前：${config.config.model}` })
  }

  return (
    <div className="ad-root">
      <style>{shellStyle()}</style>
      <div className="ad-top">
        <div className="ad-brand">
          <span className="ad-brand-mark" aria-hidden="true">剧</span>
          <div className="ad-brand-text">
            <strong>{tt('title')}</strong>
            <span>{tt('subtitle')}</span>
          </div>
          {home ? <span className="ad-tiny ad-muted" title="没有活动会话，项目保存在插件数据目录">未绑定会话</span> : null}
        </div>
        <Select value={project?.id ?? ''} options={[
          { value: '', label: projects.length === 0 ? '（暂无项目）' : '选择项目' },
          ...projects.map(item => ({ value: item.id, label: `${item.title} · ${item.id}` })),
        ]}
          onChange={value => {
            if (value === '' || cwd === undefined) return
            void (async () => {
              if (dirty) {
                const saved = await save()
                if (saved === undefined) return
              }
              await openProject(cwd, value)
            })()
          }} />
        <Btn onClick={() => { if (cwd !== undefined) { setRootInput(projectsRoot); setDialog('new') } }} disabled={cwd === undefined} title={cwd === undefined ? '先打开一个会话' : undefined}>{tt('create')}</Btn>
        {project === undefined ? null : <Btn onClick={() => openImportDialog(true)}>导入剧本</Btn>}
        {project === undefined ? null : <Btn kind="danger" onClick={() => { void deleteProject() }}>{tt('delete')}</Btn>}
        <div className="ad-spacer" />
        {project === undefined ? null : (
          <div className="ad-row">
            <span className="ad-tiny ad-muted">{PLATFORM_LABEL[project.meta.platform] ?? project.meta.platform} · {GENRE_LABEL[project.meta.genre] ?? project.meta.genre} · {project.meta.episodeSeconds}s/集</span>
            <Btn onClick={() => { void validateNow() }} disabled={busy !== ''}>{tt('validate')}</Btn>
            <Btn onClick={() => { void exportNow() }} disabled={busy !== ''}>{tt('export')}</Btn>
            <Btn kind={dirty ? 'primary' : undefined} onClick={() => { void save() }} disabled={busy !== ''}>
              {busy === '保存' ? tt('saving') : dirty ? tt('dirty') : tt('saved')}
            </Btn>
            <Btn onClick={() => { void openSettings() }}>{tt('settings')}</Btn>
          </div>
        )}
      </div>

      {cwd === undefined ? (
        <div className="ad-empty"><h2>{tt('loading')}</h2></div>
      ) : project === undefined ? (
        <div className="ad-empty">
          <h2>{tt('noProject')}</h2>
          <p>{home
            ? '当前没有打开会话，项目会保存在插件数据目录。打开会话后再新建，项目会落到该会话工作区的 .dsh-aidrama/。'
            : tt('noProjectHint')}</p>
          <Btn kind="primary" onClick={() => { setRootInput(projectsRoot); setDialog('new') }}>{tt('create')}</Btn>
          {projectsRoot === '' ? null : <p className="ad-tiny" style={{ marginTop: 14 }}>{projectsRoot}</p>}
        </div>
      ) : (
        <div className="ad-body" data-inspector={inspectorOpen ? 'open' : 'closed'}>
          <nav className="ad-rail">
            <h2 className="ad-rail-title">制片流程</h2>
            {STAGES.map((item, index) => (
              <button key={item.id} type="button" title={item.hint} data-active={stage === item.id} onClick={() => setStage(item.id)}>
                <span className="ad-rail-idx">{index + 1}</span>
                <span>{item.label}</span>
                <span className="ad-rail-meta">{stageCount(project, item.id)}</span>
              </button>
            ))}
            <div className="ad-rail-hint">{STAGES.find(item => item.id === stage)?.hint}</div>
            <div className="ad-rail-hint" style={{ marginTop: 10 }}>
              <div className="ad-progress"><i style={{ width: `${progressOf(project)}%` }} /></div>
              <div style={{ marginTop: 5 }}>制片进度 {progressOf(project)}%</div>
            </div>
          </nav>

          <main className="ad-main">
            {stage === 'concept' ? <ConceptPanel project={project} mutate={mutate} busy={busy} onBible={() => { void generate('bible') }} /> : null}
            {stage === 'bible' ? <BiblePanel project={project} mutate={mutate} busy={busy} onGenerate={() => { void generate('bible') }} /> : null}
            {stage === 'assets' ? <AssetsPanel project={project} mutate={mutate} tab={assetTab} setTab={setAssetTab}
              episodeId={episodeId} setEpisodeId={setEpisodeId} select={setSelection} busy={busy} onGenerate={target => { void generate(target) }} /> : null}
            {stage === 'episodes' ? <EpisodePanel project={project} mutate={mutate} episodeId={episodeId} setEpisodeId={setEpisodeId}
              busy={busy} onNewEpisode={() => { void newEpisode() }} onGenerateEpisode={() => { void generate('episode') }}
              onEstimate={() => { void estimateDuration(episodeId) }} /> : null}
            {stage === 'canvas' ? <CanvasPanel project={project} imageUrl={assetUrl} busy={busy} mutate={mutate}
              onGenerateImage={(target, id) => generateImage(target, id)}
              onApplyImage={(target, id, dataUrl) => applyCanvasImage(target, id, dataUrl)}
              onOpenDirector={() => setStage('director')} /> : null}
            {stage === 'director' ? <DirectorPanel project={project} mutate={mutate} /> : null}
            {stage === 'storyboard' ? <StoryboardPanel project={project} mutate={mutate} episodeId={episodeId} setEpisodeId={setEpisodeId}
              selection={selection} select={setSelection} busy={busy} onGenerateShots={() => { void generate('shots') }} onGenerateSegmentVideo={id => { void generateSegmentVideo(id) }} /> : null}
            {stage === 'prompts' ? <PromptsPanel project={project} episodeId={episodeId} setEpisodeId={setEpisodeId}
              dialect={dialect} busy={busy} findings={validation?.findings ?? []}
              onCompile={shotId => { void compile(shotId) }} /> : null}
            {stage === 'production' ? <ProductionPanel project={project} mutate={mutate} /> : null}
            {stage === 'qc' ? <QcPanel project={project} validation={validation} busy={busy}
              onValidate={() => { void validateNow() }} onExport={() => { void exportNow() }} onSelect={applyFinding} /> : null}
            <div className="ad-row" style={{ marginTop: 18 }}>
              <input className="ad-input" style={{ flex: 1, minWidth: 180 }} value={instruction} placeholder={tt('instruction')}
                onChange={event => setInstruction(event.target.value)} />
            </div>
          </main>

          <aside className={`ad-side${inspectorOpen ? '' : ' ad-side-collapsed'}`}>
            <div className="ad-row" style={{ marginBottom: inspectorOpen ? 8 : 0, justifyContent: 'space-between' }}>
              <strong style={inspectorOpen ? undefined : { writingMode: 'vertical-rl', fontSize: 11, opacity: .7 }}>{tt('inspector')}</strong>
              <span className="ad-spacer" />
              <button type="button" className="ad-btn" title={inspectorOpen ? '收起检查器' : '展开检查器'}
                style={{ height: 24, padding: '0 7px', fontSize: 11 }} onClick={() => setInspectorOpen(value => !value)}>
                {inspectorOpen ? '收起' : '展开'}
              </button>
              {inspectorOpen && (dirty ? <Badge level="warn">{tt('dirty')}</Badge> : <Badge level="ok">{tt('saved')}</Badge>)}
            </div>
            {inspectorOpen ? (<>
            {selectedCharacter !== undefined ? <CharacterInspector character={selectedCharacter} mutate={mutate}
              busy={busy} audioUrl={assetUrl} imageUrl={assetUrl} onDesignVoice={designVoice}
              onGenerateImage={(id, view, prompt) => { void generateImage('character', id, { ...(view === undefined ? {} : { view }), ...(prompt === undefined ? {} : { prompt }) }) }}
              onGenerateLookImage={(id, lookId, view, prompt) => { void generateImage('character', id, { lookId, view, ...(prompt === undefined ? {} : { prompt }) }) }} /> : null}
            {selectedScene !== undefined ? <SceneInspector scene={selectedScene} mutate={mutate} busy={busy}
              imageUrl={assetUrl} onGenerateImage={id => { void generateImage('scene', id) }} /> : null}
            {selectedProp !== undefined ? <PropInspector prop={selectedProp} mutate={mutate} busy={busy}
              imageUrl={assetUrl} onGenerateImage={id => { void generateImage('prop', id) }} /> : null}
            {selectedStyle !== undefined ? <StyleInspector style={selectedStyle} mutate={mutate} /> : null}
            {selectedShot !== undefined && episode !== undefined
              ? <ShotInspector project={project} episode={episode} shot={selectedShot} mutate={mutate} busy={busy}
                assetUrl={assetUrl} onCompile={shotId => { void compile(shotId) }}
                onGenerateImage={id => { void generateImage('shot', id) }}
                onGenerateVideo={shotId => { void generateVideo(shotId) }}
                onUploadImage={(shotId, file) => { void uploadShotImage(shotId, file) }} />
              : null}
            {!hasInspector ? (
              <div className="ad-col">
                <p className="ad-muted ad-tiny">{tt('emptyInspector')}</p>
                <div className="ad-kv">
                  <b>项目</b><span>{project.title}</span>
                  <b>集数</b><span>{project.episodes.length}</span>
                  <b>分镜</b><span>{project.episodes.reduce((sum, item) => sum + item.shots.length, 0)}</span>
                  <b>角色</b><span>{project.characters.length}</span>
                  <b>项目目录</b><span className="ad-tiny">{projectDir || projectsRoot}</span>
                </div>
                <h3 className="ad-h2">下一步</h3>
                <NextSteps project={project} />
              </div>
            ) : null}
            {validation === undefined ? null : (
              <>
                <h3 className="ad-h2">校验
                  <span className="ad-tiny">
                    <Badge level={validation.errors > 0 ? 'error' : 'ok'}>{validation.errors}</Badge>{' '}
                    <Badge level={validation.warns > 0 ? 'warn' : 'info'}>{validation.warns}</Badge>
                  </span>
                  {hasZeroBeats && project?.meta.durationMode !== 'auto' ? <Btn onClick={() => { void fixZeroBeats() }} disabled={busy !== ''}>均分 0 秒节拍</Btn> : null}
                </h3>
                <Findings findings={validation.findings.slice(0, 6)} onSelect={applyFinding} />
              </>
            )}
            </>) : null}
          </aside>
        </div>
      )}

      {toast === undefined ? null : <div className="ad-toast" data-kind={toast.kind}>{toast.text}</div>}

      {dialog === 'new' ? (
        <div className="ad-modal-mask" onClick={() => setDialog(null)}>
          <div className="ad-modal" onClick={event => event.stopPropagation()}>
            <h2>{tt('create')}</h2>
            <Field label={tt('createTitle')}><Input value={newTitle} placeholder="攻略女帝" onChange={setNewTitle} /></Field>
            <Field label="项目保存目录">
              <div className="ad-row">
                <input className="ad-input" style={{ flex: 1, minWidth: 160 }} value={rootInput}
                  placeholder="留空 = 当前工作区/.dsh-aidrama/projects"
                  onChange={event => setRootInput(event.target.value)} />
                <Btn onClick={() => {
                  if (props.pickDirectory === undefined) return
                  void props.pickDirectory().then(dir => { if (typeof dir === 'string' && dir !== '') setRootInput(dir) })
                }} disabled={props.pickDirectory === undefined}>选择文件夹…</Btn>
              </div>
            </Field>
            <p className="ad-note" style={{ marginTop: 10 }}>
              项目会直接建在这个目录下（每个项目一个子目录）；留空则使用当前工作区的 .dsh-aidrama/projects。 更改目录会把现有项目一起移动到新目录，项目 ID 不变。</p>
            <p className="ad-note">{home ? '当前未绑定会话，项目会保存在插件数据目录下的所选位置。' : tt('noProjectHint')}</p>
            {importFields}
            <div className="ad-modal-actions">
              <Btn onClick={() => setDialog(null)}>{tt('cancel')}</Btn>
              {importText.trim() === '' && importFileBase64 === '' ? (
                <Btn kind="primary" onClick={() => { void createProject() }} disabled={busy !== '' || cwd === undefined}>{tt('create')}</Btn>
              ) : (
                <>
                  <Btn onClick={() => { void createProject() }} disabled={busy !== '' || cwd === undefined}>创建空项目</Btn>
                  <Btn kind="primary" onClick={() => { void parseImport(false) }} disabled={importBusy || cwd === undefined}>
                    {importBusy ? '解析中…' : '导入并预览'}
                  </Btn>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {dialog === 'import' ? (
        <div className="ad-modal-mask" onClick={() => setDialog(null)}>
          <div className="ad-modal" onClick={event => event.stopPropagation()}>
            <h2>导入剧本</h2>
            <p className="ad-note" style={{ marginBottom: 10 }}>
              解析会补齐当前项目缺失的角色/场景/道具与分集，保留已有内容；只把第一集跑到提示词。</p>
            {importFields}
            <div className="ad-modal-actions">
              <Btn onClick={() => setDialog(null)}>{tt('cancel')}</Btn>
              <Btn kind="primary" onClick={() => { void parseImport(true) }} disabled={importBusy || cwd === undefined || project === undefined}>
                {importBusy ? '解析中…' : '解析并预览'}
              </Btn>
            </div>
          </div>
        </div>
      ) : null}

      {preview === undefined ? null : (
        <div className="ad-modal-mask" onClick={() => setPreview(undefined)}>
          <div className="ad-modal" style={{ width: 'min(780px, 100%)' }} onClick={event => event.stopPropagation()}>
            <h2>{preview.newProject ? '导入预览 · 将新建项目' : '导入预览 · 将合并到当前项目'}</h2>
            <p className="ad-note">{preview.notes}</p>
            <div className="ad-row" style={{ margin: '8px 0' }}>
              <Badge>{preview.project.characters.length} 角色</Badge>
              <Badge>{preview.project.scenes.length} 场景</Badge>
              <Badge>{preview.project.props.length} 道具</Badge>
              <Badge>{preview.project.episodes.length} 集</Badge>
              <Badge>{preview.project.episodes[0]?.shots.length ?? 0} 分镜</Badge>
              <Badge>{preview.validation.errors} error / {preview.validation.warns} warn</Badge>
              <span className="ad-tiny ad-muted">tokens {preview.usage.inputTokens}/{preview.usage.outputTokens}</span>
            </div>
            <div className="ad-grid2">
              <Field label="剧名"><Input value={preview.project.title} onChange={value => patchPreview(draft => { draft.title = value })} /></Field>
              <Field label="一句话"><Input value={preview.project.meta.logline} onChange={value => patchPreview(draft => { draft.meta.logline = value })} /></Field>
              <Field label="单集时长（秒）"><Input value={String(preview.project.meta.episodeSeconds)}
                onChange={value => patchPreview(draft => { draft.meta.episodeSeconds = Math.max(15, Number(value) || 90) })} /></Field>
              <Field label="题材">
                <Select value={preview.project.meta.genre} options={GENRES.map(id => ({ value: id, label: GENRE_LABEL[id] ?? id }))}
                  onChange={value => patchPreview(draft => { draft.meta.genre = value as Project['meta']['genre'] })} />
              </Field>
              <Field label="平台">
                <Select value={preview.project.meta.platform} options={PLATFORMS.map(id => ({ value: id, label: PLATFORM_LABEL[id] ?? id }))}
                  onChange={value => patchPreview(draft => { draft.meta.platform = value as Project['meta']['platform'] })} />
              </Field>
            </div>
            <h3 className="ad-h2">角色（可改名/定位）</h3>
            <div className="ad-col">
              {preview.project.characters.map((character, index) => (
                <div key={character.id} className="ad-row">
                  <span className="ad-id">{character.id}</span>
                  <Input value={character.name} onChange={value => patchPreview(draft => { const item = draft.characters[index]; if (item !== undefined) item.name = value })} />
                  <Input value={character.role} onChange={value => patchPreview(draft => { const item = draft.characters[index]; if (item !== undefined) item.role = value })} />
                </div>
              ))}
            </div>
            <h3 className="ad-h2">分集（可改标题/一句话；正文按标题切分）</h3>
            <div className="ad-col">
              {preview.project.episodes.map((episode, index) => (
                <div key={episode.id} className="ad-col" style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 6 }}>
                  <div className="ad-row">
                    <span className="ad-id">{episode.id}</span>
                    <Input value={episode.title} onChange={value => patchPreview(draft => { const item = draft.episodes[index]; if (item !== undefined) item.title = value })} />
                    <Input value={episode.logline} onChange={value => patchPreview(draft => { const item = draft.episodes[index]; if (item !== undefined) item.logline = value })} />
                  </div>
                  <p className="ad-tiny ad-muted" style={{ margin: 0 }}>{episode.script.slice(0, 160)}{episode.script.length > 160 ? '…' : ''}</p>
                </div>
              ))}
            </div>
            {preview.warnings.length === 0 ? null : (
              <div className="ad-col" style={{ marginTop: 8 }}>
                {preview.warnings.map((warning, index) => <div key={index} className="ad-finding" data-level="warn"><Badge level="warn">注意</Badge><span>{warning}</span></div>)}
              </div>
            )}
            <div className="ad-modal-actions">
              <Btn onClick={() => setPreview(undefined)}>{tt('cancel')}</Btn>
              <Btn kind="primary" onClick={() => { void applyImport() }} disabled={importBusy}>{importBusy ? '写入中…' : '确认写入'}</Btn>
            </div>
          </div>
        </div>
      )}

      {dialog === 'settings' ? (
        <div className="ad-modal-mask" onClick={() => setDialog(null)}>
          <div className="ad-modal" onClick={event => event.stopPropagation()}>
            <h2>{tt('configTitle')}</h2>
            {config === undefined ? <p className="ad-muted">{tt('loading')}</p> : (
              <div className="ad-col">
                <div className="ad-row" style={{ marginBottom: 12 }}>
                  <Btn kind={settingsTab === 'text' ? 'primary' : undefined} onClick={() => setSettingsTab('text')}>文本</Btn>
                  <Btn kind={settingsTab === 'image' ? 'primary' : undefined} onClick={() => setSettingsTab('image')}>图片</Btn>
                  <Btn kind={settingsTab === 'video' ? 'primary' : undefined} onClick={() => setSettingsTab('video')}>视频</Btn>
                  <Btn kind={settingsTab === 'voice' ? 'primary' : undefined} onClick={() => setSettingsTab('voice')}>配音</Btn>
                  <Btn kind={settingsTab === 'project' ? 'primary' : undefined} onClick={() => setSettingsTab('project')}>项目</Btn>
                </div>

                {settingsTab === 'text' ? (
                  <div className="ad-col">
                    <p className="ad-note">文本模型负责总纲、资产、分镜、提示词；从 DSH 已配置模型里选。</p>
                    <div className="ad-grid2">
                      <Field label="提供商">
                        <Select value={config.config.provider} options={providerChoices}
                          onChange={value => setConfig({ ...config, config: { ...config.config, provider: value, model: '' } })} />
                      </Field>
                      <Field label="模型">
                        <Select value={config.config.model} options={modelChoices}
                          onChange={value => setConfig({ ...config, config: { ...config.config, model: value } })} />
                      </Field>
                    </div>
                    <details>
                      <summary className="ad-tiny ad-muted" style={{ cursor: 'pointer', margin: '6px 0' }}>高级：剧本解析专用模型</summary>
                      <div className="ad-grid2">
                        <Field label="解析提供商（可选）">
                          <Input value={config.config.parseProvider} placeholder="留空 = 用上面的文本模型"
                            onChange={value => setConfig({ ...config, config: { ...config.config, parseProvider: value } })} />
                        </Field>
                        <Field label="解析模型（可选）">
                          <Input value={config.config.parseModel} placeholder="留空 = 用上面的文本模型"
                            onChange={value => setConfig({ ...config, config: { ...config.config, parseModel: value } })} />
                        </Field>
                      </div>
                    </details>
                    <div className="ad-row">
                      <Btn onClick={() => { void api.models(true).then(setModels).catch(error => flash({ kind: 'error', text: errorOf(error) })) }}>刷新模型列表</Btn>
                      <span className="ad-tiny ad-muted">{config.dshAvailable ? 'DSH 模型服务可用' : 'DSH 模型服务不可用'}</span>
                    </div>
                  </div>
                ) : null}

                {settingsTab === 'image' ? (
                  <div className="ad-col">
                    <p className="ad-note">用于角色三视图、场景/道具参考图、分镜首帧。Seedream 尺寸自动按 2K 选。</p>
                    <Field label="接口地址">
                      <Input value={config.config.imageBaseUrl} placeholder="https://ark.cn-beijing.volces.com/api/v3"
                        onChange={value => setConfig({ ...config, config: { ...config.config, imageBaseUrl: value } })} />
                    </Field>
                    <Field label="API Key">
                      <Input value={config.config.imageApiKey} placeholder="只存本机配置"
                        onChange={value => setConfig({ ...config, config: { ...config.config, imageApiKey: value } })} />
                    </Field>
                    <Field label="模型">
                      <Input value={config.config.imageModel} placeholder="doubao-seedream-..."
                        onChange={value => setConfig({ ...config, config: { ...config.config, imageModel: value } })} />
                    </Field>
                    <p className="ad-note">和 Seedance 共用方舟 Key 即可；模型名填你账号开通的 Seedream 版本。</p>
                  </div>
                ) : null}

                {settingsTab === 'video' ? (
                  <div className="ad-col">
                    <p className="ad-note">只用于分镜「生成对白视频」。当前接 Seedance 2.0 多模态参考。</p>
                    <Field label="接口地址">
                      <Input value={config.config.videoBaseUrl} placeholder="https://ark.cn-beijing.volces.com/api/v3"
                        onChange={value => setConfig({ ...config, config: { ...config.config, videoBaseUrl: value } })} />
                    </Field>
                    <Field label="API Key">
                      <Input value={config.config.videoApiKey} placeholder="只存本机配置"
                        onChange={value => setConfig({ ...config, config: { ...config.config, videoApiKey: value } })} />
                    </Field>
                    <Field label="模型">
                      <Input value={config.config.videoModel} placeholder="doubao-seedance-2-0-..."
                        onChange={value => setConfig({ ...config, config: { ...config.config, videoModel: value } })} />
                    </Field>
                    <p className="ad-note">接口地址填到 /api/v3；模型填 doubao-seedance-2-0-*。提示词方言自动跟随模型：{videoDialectLabel}。Key 只存本机配置。</p>
                  </div>
                ) : null}

                {settingsTab === 'voice' ? (
                  <div className="ad-col">
                    <p className="ad-note">MiMo 只负责生成角色样音；对白由 Seedance 2.0 生成。</p>
                    <Field label="接口地址">
                      <Input value={config.config.ttsBaseUrl} placeholder="https://api.xiaomimimo.com/v1"
                        onChange={value => setConfig({ ...config, config: { ...config.config, ttsBaseUrl: value } })} />
                    </Field>
                    <Field label="API Key">
                      <Input value={config.config.ttsApiKey} placeholder="只存本机配置"
                        onChange={value => setConfig({ ...config, config: { ...config.config, ttsApiKey: value } })} />
                    </Field>
                    <Field label="音色设计模型">
                      <Input value={config.config.ttsModel} placeholder="mimo-v2.5-tts-voicedesign"
                        onChange={value => setConfig({ ...config, config: { ...config.config, ttsModel: value } })} />
                    </Field>
                    <p className="ad-note">voicedesign 不返回 voiceId；项目保存生成出来的样音文件。Key 只存本机配置。</p>
                  </div>
                ) : null}

                {settingsTab === 'project' ? (
                  <div className="ad-col">
                    <Field label="当前项目文件目录">
                      <input className="ad-input" value={projectDir} readOnly
                        placeholder={project === undefined ? '当前没有打开项目' : '项目目录未知'} />
                    </Field>
                    <Field label="项目根目录（所有项目）">
                      <input className="ad-input" value={projectsRoot} readOnly
                        placeholder="默认：当前工作区 .dsh-aidrama/projects" />
                    </Field>
                    {projectDir === '' || projectsRoot === '' || projectDir.toLowerCase().startsWith(projectsRoot.toLowerCase()) ? null : (
                      <p className="ad-note" style={{ color: 'var(--dsw-alias-label-warn, #d97706)' }}>
                        当前项目不在这个根目录下；点「使用工作区默认」或选择项目所在目录，项目才会出现在列表里。
                      </p>
                    )}
                    <div className="ad-row">
                      <Btn onClick={() => {
                        if (props.pickDirectory === undefined) return
                        void props.pickDirectory().then(dir => { if (dir !== null) void moveProjects(dir) })
                      }} disabled={props.pickDirectory === undefined || busy !== ''}>选择文件夹并移动</Btn>
                      <Btn onClick={() => { void moveProjects('') }} disabled={busy !== ''}>使用工作区默认</Btn>
                    </div>
                    <label className="ad-row ad-tiny">
                      <input type="checkbox" checked={config.config.announceToAgent}
                        onChange={event => setConfig({ ...config, config: { ...config.config, announceToAgent: event.target.checked } })} />
                      {tt('announce')}
                    </label>
                    <p className="ad-note">「选择文件夹并移动」会把项目根目录下的所有项目移动到新目录，项目 ID 不变；请先保存未保存的改动。</p>
                  </div>
                ) : null}
              </div>
            )}
            <div className="ad-modal-actions">
              <Btn onClick={() => setDialog(null)}>{tt('close')}</Btn>
              <Btn kind="primary" onClick={() => { void saveSettings() }} disabled={config === undefined}>{tt('save')}</Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
