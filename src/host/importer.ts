/**
 * 剧本导入：TXT / Markdown / DOCX / 粘贴文本 → 预览用 draft project。
 *
 * 流程：
 * 1. 文档转纯文本（DOCX 解 zip / word/document.xml）；
 * 2. 按「第X集 / EP01 / Episode N」标题确定性拆集（正文原样保留，不让模型改写）；
 * 3. 一次 LLM 调用提取项目信息、角色、场景、道具、每集节拍与一句话；
 * 4. 合并进 base project（已有项目只补空字段，不覆盖手改）；
 * 5. 仅第一集生成分镜并编译提示词；
 * 6. 返回 draft，客户端预览确认后再落盘。
 */

import { inflateRawSync } from 'node:zlib'
import type { Beat, Character, Episode, Project, Scene, Shot, Prop } from '../shared/types.ts'
import type { DshLlm } from './dsh.ts'
import type { Generator } from './generator.ts'
import { compileShotInto } from './compiler.ts'
import { emptyProject, normalizeProject } from './store.ts'
import { renderLockText } from './generator.ts'
import { asString, messageOf } from './util.ts'
import { castNamesFromText, locationNamesFromText } from '../shared/script.ts'

export interface ImportInput {
  text?: string
  fileBase64?: string
  fileName?: string
  instruction?: string
}

export interface ImportSettings {
  parseProvider: string
  parseModel: string
  generationProvider: string
  generationModel: string
}

export interface ImportOutcome {
  project: Project
  notes: string
  warnings: string[]
  usage: { inputTokens: number, outputTokens: number }
  newProject: boolean
}

const MAX_PARSE_CHARS = 80_000

/* ------------------------------------------------------------------ */
/* 文件 → 纯文本                                                       */
/* ------------------------------------------------------------------ */

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** 读 ZIP 中的 word/document.xml；只依赖 node:zlib，不引第三方包。 */
export function docxToText(base64: string): string {
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > 40 * 1024 * 1024) throw new Error('DOCX 超过 40MB，拒绝解压')
  const wanted = 'word/document.xml'
  const readEntry = (method: number, data: Buffer): string => {
    if (method !== 0 && method !== 8) throw new Error(`不支持的 DOCX 压缩方式：${method}`)
    const raw = method === 0 ? data : inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 })
    return raw.toString('utf8')
  }
  let xml: string | undefined

  // 优先走 central directory：兼容带 data descriptor（local size=0）的流式 ZIP。
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd >= 0 && eocd + 22 <= buffer.length) {
    const count = buffer.readUInt16LE(eocd + 10)
    let pointer = buffer.readUInt32LE(eocd + 16)
    for (let index = 0; index < count && pointer + 46 <= buffer.length; index += 1) {
      if (buffer.readUInt32LE(pointer) !== 0x02014b50) break
      const method = buffer.readUInt16LE(pointer + 10)
      const compressedSize = buffer.readUInt32LE(pointer + 20)
      const nameLength = buffer.readUInt16LE(pointer + 28)
      const extraLength = buffer.readUInt16LE(pointer + 30)
      const commentLength = buffer.readUInt16LE(pointer + 32)
      const localOffset = buffer.readUInt32LE(pointer + 42)
      const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')
      if (name === wanted && localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === 0x04034b50) {
        const localNameLength = buffer.readUInt16LE(localOffset + 26)
        const localExtraLength = buffer.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + localNameLength + localExtraLength
        xml = readEntry(method, buffer.subarray(dataStart, dataStart + compressedSize))
        break
      }
      pointer += 46 + nameLength + extraLength + commentLength
    }
  }

  // 回退：旧式 local header 顺序扫描。
  if (xml === undefined) {
    let offset = 0
    while (offset + 30 <= buffer.length) {
      const signature = buffer.readUInt32LE(offset)
      if (signature !== 0x04034b50) break
      const method = buffer.readUInt16LE(offset + 8)
      const compressedSize = buffer.readUInt32LE(offset + 18)
      const nameLength = buffer.readUInt16LE(offset + 26)
      const extraLength = buffer.readUInt16LE(offset + 28)
      const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
      const dataStart = offset + 30 + nameLength + extraLength
      const data = buffer.subarray(dataStart, dataStart + compressedSize)
      if (name === wanted) {
        xml = readEntry(method, data)
        break
      }
      offset = dataStart + compressedSize
    }
  }
  if (xml === undefined) throw new Error('DOCX 里没有找到 word/document.xml')
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim()
}

export function extractText(input: ImportInput): { text: string, fileName: string } {
  const fileName = asString(input.fileName).trim()
  const direct = asString(input.text).trim()
  if (direct !== '') return { text: direct, fileName }
  const base64 = asString(input.fileBase64).trim()
  if (base64 === '') throw new Error('没有收到剧本文本或文件')
  if (fileName.toLowerCase().endsWith('.docx')) return { text: docxToText(base64), fileName }
  return { text: Buffer.from(base64, 'base64').toString('utf8').trim(), fileName }
}

/* ------------------------------------------------------------------ */
/* 拆集                                                                */
/* ------------------------------------------------------------------ */

export interface ScriptSegment {
  id: string
  heading: string
  body: string
}

function chineseNumber(text: string): number | undefined {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  const ten = text.indexOf('十')
  if (ten >= 0) {
    const left = ten === 0 ? 1 : digits[text.slice(0, ten)]
    const right = text.slice(ten + 1) === '' ? 0 : digits[text.slice(ten + 1)]
    if (left === undefined || right === undefined) return undefined
    return left * 10 + right
  }
  if (text.length === 1 && digits[text] !== undefined) return digits[text]
  return undefined
}

function episodeNumberFromHeading(heading: string): number | undefined {
  const chinese = /第\s*([0-9一二三四五六七八九十百零两]+)\s*集/.exec(heading)
  if (chinese !== null) return chineseNumber(chinese[1]!)
  const latin = /(?:EP|Episode)\s*(\d{1,4})/i.exec(heading)
  if (latin !== null) return Number(latin[1])
  return undefined
}



const HEADING = /^(?:\s*#{0,6}\s*)(?:第\s*[0-9一二三四五六七八九十百零两]+\s*集|EP\s*\d{1,4}|Episode\s*\d{1,4})(?=\s|[：:、.、—-]|$).*$/gim

export function splitEpisodes(text: string): ScriptSegment[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const matches = [...trimmed.matchAll(HEADING)]
  if (matches.length === 0) {
    return [{ id: 'EP001', heading: '第一集', body: trimmed }]
  }
  const segments: ScriptSegment[] = []
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const start = current.index ?? 0
    const bodyStart = start + current[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? trimmed.length) : trimmed.length
    const heading = current[0].trim()
    let body = trimmed.slice(bodyStart, end).trim()
    if (i === 0 && start > 0) {
      const preface = trimmed.slice(0, start).trim()
      if (preface !== '') body = `${preface}\n\n${body}`.trim()
    }
    segments.push({ id: `EP${String(i + 1).padStart(3, '0')}`, heading, body })
  }
  return segments
}

/* ------------------------------------------------------------------ */
/* LLM 提取                                                            */
/* ------------------------------------------------------------------ */

interface ParsedEpisode {
  id?: string
  title?: string
  logline?: string
  beats?: Array<Record<string, unknown>>
}

interface ParsedScript {
  title?: string
  logline?: string
  theme?: string
  hook?: string
  platform?: string
  genre?: string
  episodeSeconds?: number
  targetEpisodes?: number
  bible?: Record<string, unknown>
  characters?: Array<Record<string, unknown>>
  scenes?: Array<Record<string, unknown>>
  props?: Array<Record<string, unknown>>
  episodes?: ParsedEpisode[]
}

const SYSTEM = `你是 AI 短剧/漫剧的剧本统筹与资产拆解员。你只做信息提取，不改写剧情，不新增原著没有的设定。
输出必须是单个 JSON 对象，不要 Markdown 围栏、不要解释。
规则：
1. 剧本正文由程序按集标题切分，你不需要输出正文；只输出每集的一句话与节拍。
2. 能确定的信息才填；不确定的字符串留空、数字填 0，不要编造平台、时长、集数。
3. 角色/场景/道具必须有稳定 ID；角色 id 从 C01 递增，场景 S01，道具 P01。
4. 节拍 seconds 合计尽量等于该集时长；不知道时长就按剧情比例估算，但不要编造精确总时长。
5. 只输出 JSON。`

function parsePrompt(base: Project, segments: ScriptSegment[], text: string, instruction: string, compact = false): string {
  const episodesSchema = compact
    ? '"episodes": [{"id":"EP001","title":"","logline":""}]'
    : '"episodes": [{"id":"EP001","title":"","logline":"","beats":[{"id":"B1","function":"hook|goal|obstacle|twist|choice|cliff 之一","seconds":0,"text":""}]}]'
  return `请拆解以下剧本，输出 JSON：
{
  "title": "剧名（能确定才填）",
  "logline": "一句话（主角+目标+阻碍+代价）",
  "theme": "", "hook": "",
  "platform": "douyin|kuaishou|wechat|xiaohongshu|youtube 之一，能确定才填",
  "genre": "urban|costume|xianxia|suspense|scifi|realism|family|sweet|comedy 之一，能确定才填",
  "episodeSeconds": 0,
  "targetEpisodes": ${segments.length},
  "bible": {"premise":"","world":"","arc":"","episodePlan":"","visualDirection":""},
  "characters": [{"id":"C01","name":"","role":"","slots":{"ageGender":"","face":"","hair":"","body":"","outfit":"","accessories":"","temperament":"","forbidden":"","lightBaseline":""}}],
  "scenes": [{"id":"S01","name":"","space":"","props":"","palette":"","keyLight":""}],
  "props": [{"id":"P01","name":"","function":"evidence|identity|countdown|keepsake|obstacle 之一","appearance":"","owner":"","endPosition":""}],
  ${episodesSchema}
}
已有项目：${base.title}；现有角色 ${base.characters.map(c => c.id).join('、') || '无'}。
本剧本按标题切成 ${segments.length} 集：${segments.map(s => `${s.id}「${s.heading}」`).join('；')}。
${instruction.trim() === '' ? '' : `用户补充要求：${instruction.trim()}\n`}
${compact ? '这是精简解析：只输出元信息、角色、场景、道具和每集标题/一句话；不要输出 beats，不要输出分镜。每集只保留最关键信息，确保 JSON 完整闭合。\n' : ''}剧本全文：
"""
${text.slice(0, MAX_PARSE_CHARS)}
"""`
}

/* ------------------------------------------------------------------ */
/* 合并                                                                */
/* ------------------------------------------------------------------ */

function mergeCharacters(base: Project, raw: unknown): { added: number, merged: Character[] } {
  const incoming = normalizeProject({ ...base, characters: raw }).characters
  const byId = new Map(base.characters.map(character => [character.id, character]))
  let added = 0
  for (const character of incoming) {
    character.lockText = character.lockText.trim() === '' ? renderLockText(character) : character.lockText
    if (!byId.has(character.id)) {
      byId.set(character.id, character)
      added += 1
    }
  }
  return { added, merged: [...byId.values()] }
}

function mergeScenes(base: Project, raw: unknown): Scene[] {
  const incoming = normalizeProject({ ...base, scenes: raw }).scenes
  const byId = new Map(base.scenes.map(scene => [scene.id, scene]))
  for (const scene of incoming) if (!byId.has(scene.id)) byId.set(scene.id, scene)
  return [...byId.values()]
}

function mergeProps(base: Project, raw: unknown): Prop[] {
  const incoming = normalizeProject({ ...base, props: raw }).props
  const byId = new Map(base.props.map(prop => [prop.id, prop]))
  for (const prop of incoming) if (!byId.has(prop.id)) byId.set(prop.id, prop)
  return [...byId.values()]
}

function asBeats(raw: unknown): Beat[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item, index) => ({
      id: asString(item.id) || `B${index + 1}`,
      function: (['hook', 'goal', 'obstacle', 'twist', 'choice', 'cliff'].includes(asString(item.function))
        ? asString(item.function) : 'goal') as Beat['function'],
      seconds: Math.max(0, Math.round(Number(item.seconds) || 0)),
      text: asString(item.text),
    }))
}

/** 解析模型有时把 seconds 全给 0；按集目标均分，避免导入后直接 11 个 GEN-005。 */
function balanceZeroBeats(beats: Beat[], totalSeconds: number): Beat[] {
  if (beats.length === 0 || beats.some(beat => beat.seconds > 0)) return beats
  const total = Math.max(1, Math.round(totalSeconds))
  const base = Math.max(1, Math.floor(total / beats.length))
  const rest = Math.max(0, total - base * beats.length)
  return beats.map((beat, index) => ({
    ...beat,
    seconds: base + (index === beats.length - 1 ? rest : 0),
  }))
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

export class Importer {
  constructor(private readonly llm: DshLlm, private readonly generator: Generator) {}

  async preview(base: Project, input: ImportInput, settings: ImportSettings, signal?: AbortSignal): Promise<ImportOutcome> {
    const { text } = extractText(input)
    if (text.trim() === '') throw new Error('剧本内容为空')
    const warnings: string[] = []
    if (text.length > MAX_PARSE_CHARS) warnings.push(`剧本 ${text.length} 字，解析只发送前 ${MAX_PARSE_CHARS} 字`)
    const segments = splitEpisodes(text)
    if (segments.length === 0) throw new Error('没有识别到可用剧本内容')

    const provider = settings.parseProvider.trim() || settings.generationProvider.trim()
    const model = settings.parseModel.trim() || settings.generationModel.trim()
    if (provider === '' || model === '') throw new Error('还没有配置解析模型或文本模型（设置 → AI 短剧工坊）')
    let reply
    try {
      reply = await this.llm.chatJson<ParsedScript>({
        provider,
        model,
        label: 'AI 短剧·导入解析',
        system: SYSTEM,
        user: parsePrompt(base, segments, text, asString(input.instruction)),
        maxTokens: 6000,
        temperature: 0.4,
        signal,
      })
    } catch (error) {
      warnings.push(`整包解析失败（${messageOf(error)}），已改用精简解析：只提取资产和分集标题/一句话，节拍稍后逐集生成`)
      try {
        reply = await this.llm.chatJson<ParsedScript>({
          provider,
          model,
          label: 'AI 短剧·导入解析（精简）',
          system: SYSTEM,
          user: parsePrompt(base, segments, text, asString(input.instruction), true),
          maxTokens: 8000,
          temperature: 0.4,
          signal,
        })
      } catch (compactError) {
        warnings.push(`精简解析仍失败（${messageOf(compactError)}），已按标题确定性切集导入正文；人物与场景名已从剧本提取，资产/节拍请在分集页继续生成`)
        const cast = castNamesFromText(text)
        const locations = locationNamesFromText(text)
        reply = {
          value: {
            title: base.title === '' || base.title === '未命名短剧' ? segments[0]?.heading ?? '' : base.title,
            characters: cast.map((name, index) => ({
              id: `C${String(index + 1).padStart(2, '0')}`,
              name,
              role: '待定',
              slots: {},
            })),
            scenes: locations.slice(0, 8).map((name, index) => ({
              id: `S${String(index + 1).padStart(2, '0')}`,
              name,
              space: name,
            })),
            episodes: segments.map(segment => ({ id: segment.id, title: segment.heading, logline: '', beats: [] })),
          } as ParsedScript,
          usage: { inputTokens: 0, outputTokens: 0 },
        }
      }
    }

    const parsed = reply.value
    const project = structuredClone(base)
    const notes: string[] = []

    if (project.title.trim() === '' || project.title === '未命名短剧') {
      project.title = asString(parsed.title).trim() || project.title || segments[0]?.heading || '未命名短剧'
    }
    if (project.meta.logline.trim() === '') project.meta.logline = asString(parsed.logline).trim()
    if (project.meta.theme.trim() === '') project.meta.theme = asString(parsed.theme).trim()
    if (project.meta.hook.trim() === '') project.meta.hook = asString(parsed.hook).trim()
    if (asString(parsed.platform) !== '' && ['douyin', 'kuaishou', 'wechat', 'xiaohongshu', 'youtube'].includes(asString(parsed.platform))) {
      if (project.meta.logline.trim() === '' || project.characters.length === 0) project.meta.platform = asString(parsed.platform) as Project['meta']['platform']
    }
    if (asString(parsed.genre) !== '' && ['urban', 'costume', 'xianxia', 'suspense', 'scifi', 'realism', 'family', 'sweet', 'comedy'].includes(asString(parsed.genre))) {
      if (project.characters.length === 0) project.meta.genre = asString(parsed.genre) as Project['meta']['genre']
    }
    if (Number(parsed.episodeSeconds) > 0) project.meta.episodeSeconds = Math.max(15, Math.round(Number(parsed.episodeSeconds)))
    if (Number(parsed.targetEpisodes) > 0) project.meta.targetEpisodes = Math.max(1, Math.round(Number(parsed.targetEpisodes)))

    const bible = parsed.bible ?? {}
    for (const key of ['premise', 'world', 'arc', 'episodePlan', 'visualDirection'] as const) {
      if (project.bible[key].trim() === '') project.bible[key] = asString(bible[key]).trim()
    }

    const characters = mergeCharacters(project, parsed.characters)
    project.characters = characters.merged
    project.scenes = mergeScenes(project, parsed.scenes)
    project.props = mergeProps(project, parsed.props)
    notes.push(`角色新增 ${characters.added}，场景 ${project.scenes.length}，道具 ${project.props.length}`)

    const parsedEpisodes = Array.isArray(parsed.episodes) ? parsed.episodes : []
    const usedIds = new Set(project.episodes.map(episode => episode.id))
    let nextIndex = 1
    for (const segment of segments) {
      const desiredNumber = episodeNumberFromHeading(segment.heading)
      const desired = desiredNumber === undefined ? undefined : `EP${String(desiredNumber).padStart(3, '0')}`
      if (desired !== undefined && !usedIds.has(desired)) {
        segment.id = desired
        usedIds.add(desired)
        continue
      }
      while (usedIds.has(`EP${String(nextIndex).padStart(3, '0')}`)) nextIndex += 1
      segment.id = `EP${String(nextIndex).padStart(3, '0')}`
      usedIds.add(segment.id)
      nextIndex += 1
    }
    const existing = new Map(project.episodes.map(episode => [episode.id, episode]))
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]
      const meta = parsedEpisodes[i] ?? {}
      const previous = existing.get(segment.id)
      const parsedBeats = balanceZeroBeats(asBeats(meta.beats), project.meta.episodeSeconds)
      const episode: Episode = {
        id: segment.id,
        title: asString(meta.title).trim() || previous?.title || segment.heading,
        logline: asString(meta.logline).trim() || previous?.logline || '',
        status: previous?.status ?? 'scripted',
        targetSeconds: 0,
        beats: parsedBeats.length > 0 ? parsedBeats : previous?.beats ?? [],
        script: segment.body,
        scriptLocked: previous?.scriptLocked ?? false,
        scriptHash: previous?.scriptHash ?? '',
        shots: previous?.shots ?? [],
        segments: previous?.segments ?? [],
      }
      existing.set(segment.id, episode)
    }
    project.episodes = [...existing.values()].sort((a, b) => a.id.localeCompare(b.id))
    notes.push(`导入 ${segments.length} 集剧本`)

    // 只第一集跑到分镜 + 提示词。
    const first = project.episodes[0]
    let inputTokens = reply.usage.inputTokens
    let outputTokens = reply.usage.outputTokens
    if (first !== undefined) {
      if (first.shots.length === 0) {
        try {
          const shots = await this.generator.generate({
            project,
            stage: 'shots',
            episodeId: first.id,
            instruction: '按已导入剧本拆分镜，不要改写剧情。',
            provider: settings.generationProvider.trim() || provider,
            model: settings.generationModel.trim() || model,
          }, signal)
          project.episodes[0] = shots.project.episodes[0] ?? first
          inputTokens += shots.usage.inputTokens
          outputTokens += shots.usage.outputTokens
          notes.push(`已生成 ${first.id} 分镜 ${project.episodes[0]?.shots.length ?? 0} 镜`)
        } catch (error) {
          warnings.push(`分镜生成失败：${messageOf(error)}；可稍后手动生成`)
        }
      }
      const episode = project.episodes[0]
      if (episode !== undefined) {
        for (const shot of episode.shots) {
          if (shot.prompt.text.trim() === '') compileShotInto(project, episode, shot, project.meta.dialect)
        }
        notes.push(`已编译 ${episode.shots.filter((shot: Shot) => shot.prompt.text.trim() !== '').length} 镜提示词`)
      }
    }

    project.updatedAt = Date.now()
    return {
      project,
      notes: notes.join('；'),
      warnings,
      usage: { inputTokens, outputTokens },
      newProject: base.episodes.length === 0 && base.characters.length === 0,
    }
  }
}
