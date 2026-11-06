/**
 * 阶段生成：把结构化项目 + 用户指令交给 DSH 已配置模型，产出严格 JSON。
 *
 * 设计约束：
 * - 每次只生成一个阶段，避免长上下文压垮弱模型；
 * - 模型只负责「创作判断」，ID/锁面/时长等确定性字段由宿主补齐或校验；
 * - 生成结果先 normalize，再与已有项目合并，不整份覆盖用户已改内容
 *   （资产与分镜阶段按 id 合并，其余阶段按字段覆盖）。
 */

import type { Character, Episode, GenerateStage, Project, Shot } from '../shared/types.ts'
import type { DshLlm } from './dsh.ts'
import { balanceBeats } from './estimator.ts'
import { newShotId, nextEpisodeId, normalizeProject } from './store.ts'
import { asString, messageOf } from './util.ts'
import { castNames, locationNames, locationNamesFromText } from '../shared/script.ts'
import { groupShotsIntoSegments } from '../shared/segments.ts'

export interface GenerateContext {
  project: Project
  stage: GenerateStage
  episodeId?: string
  instruction?: string
  provider: string
  model: string
}

export interface GenerateOutcome {
  project: Project
  notes: string
  usage: { inputTokens: number, outputTokens: number }
}

const SYSTEM = `你是 AI 短剧 / 漫剧的制片人、编剧、分镜师与提示词工程师。
你的输出必须是单个 JSON 对象，严格符合用户给出的字段结构；不要 Markdown 围栏，不要解释。
硬规则：
1. 故事先于画质。一句话必须含「主角 + 目标 + 阻碍 + 代价」。
2. 资产先于镜头。角色/场景/道具必须有稳定 ID；后续只引用 ID。
3. 一镜一个主动作；台词短句化（单句尽量 ≤15 个汉字）。
4. 开头 3 秒必须有可视化钩子；每 15–20 秒至少一次新信息/关系变化/小反转。
5. 集末必须留下可视化悬念（动作卡点/身份揭示/证据出现/关系翻转/倒计时/二选一），不能只写「她震惊了」。
6. 信息不足时按最合理的假设补全，但把假设写进 notes；不要擅自改变用户已给的设定。
7. 禁止仿冒现实人物、复制现有影视作品的角色名/独特台词/专属世界观。
8. 只输出 JSON，不输出任何额外文字。`

function describe(project: Project): string {
  const { meta } = project
  return [
    `项目：${project.title}`,
    `平台：${meta.platform}；画幅：${meta.orientation === 'portrait' ? '9:16 竖屏' : '16:9 横屏'}；题材：${meta.genre}`,
    `单集时长：${meta.episodeSeconds} 秒；目标集数：${meta.targetEpisodes}`,
    meta.logline === '' ? '' : `一句话：${meta.logline}`,
    meta.theme === '' ? '' : `主题：${meta.theme}`,
    meta.hook === '' ? '' : `钩子：${meta.hook}`,
    meta.audience === '' ? '' : `受众：${meta.audience}`,
    meta.forbidden.length === 0 ? '' : `禁区：${meta.forbidden.join('、')}`,
    project.bible.premise === '' ? '' : `总纲·前提：${project.bible.premise}`,
    project.bible.world === '' ? '' : `总纲·世界：${project.bible.world}`,
    project.bible.arc === '' ? '' : `总纲·三幕：${project.bible.arc}`,
    project.bible.episodePlan === '' ? '' : `总纲·分集：${project.bible.episodePlan}`,
    `已有资产：角色 ${project.characters.map(c => `${c.id} ${c.name}`).join('、') || '无'}；` +
      `场景 ${project.scenes.map(s => `${s.id} ${s.name}`).join('、') || '无'}；` +
      `道具 ${project.props.map(p => `${p.id} ${p.name}`).join('、') || '无'}`,
  ].filter(Boolean).join('\n')
}

function episodeContext(project: Project, episodeId?: string): string {
  const episode = project.episodes.find(item => item.id === episodeId) ?? project.episodes[0]
  if (episode === undefined) return '当前还没有任何一集。'
  return [
    `当前集：${episode.id}《${episode.title}》`,
    episode.logline === '' ? '' : `本集一句话：${episode.logline}`,
    episode.beats.length === 0 ? '' : `节拍：${episode.beats.map(b => `${b.id}(${b.function},${b.seconds}s) ${b.text}`).join(' | ')}`,
    episode.script === '' ? '' : (episode.script.length <= 2400
      ? `剧本：${episode.script}`
      : `剧本（全长 ${episode.script.length} 字，前 1200 + 后 1200）：${episode.script.slice(0, 1200)}\n……（中略）……\n${episode.script.slice(-1200)}`),
    `已有分镜 ${episode.shots.length} 镜。`,
  ].filter(Boolean).join('\n')
}

function scriptContext(project: Project): string {
  const scripts = project.episodes.map(episode => episode.script).filter(text => text.trim() !== '')
  if (scripts.length === 0) return ''
  const cast = castNames(scripts)
  const locations = locationNames(scripts)
  const excerpt = project.episodes
    .filter(episode => episode.script.trim() !== '')
    .slice(0, 2)
    .map(episode => `${episode.id}《${episode.title}》\n${episode.script}`)
    .join('\n\n')
    .slice(0, 6000)
  return [
    cast.length === 0 ? '' : `【剧本人物（必须使用这些名字，不得改名/合并）】${cast.join('、')}`,
    locations.length === 0 ? '' : `【剧本场景（优先使用这些地点）】${locations.slice(0, 12).join('、')}`,
    `【剧本节选】\n${excerpt}`,
  ].filter(Boolean).join('\n')
}

const GENERIC_ROLE_LABELS = new Set(['', '主角', '配角', '对手', '辅助', '反派', '路人', '角色', '龙套', '群演', '群众'])

function isGenericRole(role: string): boolean {
  return GENERIC_ROLE_LABELS.has(role.trim())
}

function analysisContext(project: Project): string {
  if (!project.scriptAnalysis.accepted) return ''
  const rows = project.scriptAnalysis.episodes.flatMap(episode => episode.cast
    .filter(member => member.name.trim() !== '')
    .map(member => `${member.name}（${member.gender}${member.role === '' ? '' : `，${member.role}`}）${member.costume === '' ? '服装：剧本未明写' : `服装：${member.costume}`}`))
  return rows.length === 0 ? '' : `【剧本事实】${[...new Set(rows)].join('；')}`
}

function fillAppearances(project: Project): void {
  const derive = (name: string): string[] => name.trim() === ''
    ? []
    : project.episodes.filter(episode => episode.script.includes(name)).map(episode => episode.id)
  const deriveProp = (name: string): string[] => {
    const exact = derive(name)
    if (exact.length > 0 || name.trim().length < 3) return exact
    for (let size = Math.min(4, name.length); size >= 2; size -= 1) {
      const alias = name.slice(-size)
      const found = project.episodes.filter(episode => episode.script.includes(alias)).map(episode => episode.id)
      if (found.length > 0) return found
    }
    return []
  }
  for (const character of project.characters) if (character.appearsIn.length === 0) character.appearsIn = derive(character.name)
  for (const scene of project.scenes) if (scene.appearsIn.length === 0) scene.appearsIn = derive(scene.name)
  for (const prop of project.props) if (prop.appearsIn.length === 0) prop.appearsIn = deriveProp(prop.name)
}

function hashScript(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function dialogueKey(text: string): string {
  return text.replace(/[“”「」『』：:，,。！？!?、\s]/g, '')
}

function lockScripts(project: Project): void {
  for (const episode of project.episodes) {
    if (episode.script.trim() === '') continue
    episode.scriptLocked = true
    episode.scriptHash = hashScript(episode.script)
  }
}

function userPrompt(context: GenerateContext): { user: string, maxTokens: number, temperature: number } {
  const { project, stage, instruction } = context
  const extra = instruction === undefined || instruction.trim() === '' ? '' : `\n用户补充要求：${instruction.trim()}`
  switch (stage) {
    case 'bible':
      return {
        maxTokens: 4000,
        temperature: 0.8,
        user: `${describe(project)}${extra}

请产出总纲，JSON 结构：
{
  "title": "剧名（≤12 字，可直接用）",
  "premise": "一句话卖点：主角+目标+阻碍+代价（≤60 字）",
  "world": "世界观/时代/空间规则（≤200 字）",
  "arc": "三幕或起承转合（每幕一句，≤160 字）",
  "episodePlan": "分集规划：每集一句钩子与结尾悬念（按目标集数，≤${project.meta.targetEpisodes * 40} 字）",
  "visualDirection": "视觉方向：画风、色调、光线、镜头语言、禁用项（≤160 字）",
  "theme": "主题命题（≤30 字）",
  "hook": "开场 3 秒钩子（可视觉化，≤40 字）"
}`,
      }
    case 'characters':
      return {
        maxTokens: 7000,
        temperature: 0.7,
        user: `${describe(project)}
${scriptContext(project)}${analysisContext(project)}${extra}

请产出主要角色（3–6 个），JSON 结构：
{
  "characters": [{
    "id": "C01",
    "name": "角色名",
    "role": "身份/职业/关系（不能只写主角/对手/辅助）",
    "slots": {
      "ageGender": "年龄性别",
      "face": "脸型五官",
      "hair": "发型发色",
      "body": "体型身高",
      "outfit": "本剧默认服装完整描述（不要只写 LOOK-01）",
      "accessories": "配饰",
      "temperament": "气质",
      "forbidden": "禁改项（如：不许换发色、不许加眼镜）",
      "lightBaseline": "光线基准（如 3200K 暖光/5600K 日光）"
    }
  }]
}
要求：id 从 C01 递增；角色名必须使用【剧本人物】里的原名，不得改名、合并或发明新角色；同一角色的九个槽位必须逐字稳定，后续镜头只引用 id，不改写。只输出 characters 数组，不要输出 looks/stateVariants/voiceCard。
硬约束：role 必须写身份/职业/关系，不能只写主角/对手/辅助；服装不得按身份猜，剧本没有“囚服/狱服”就不能写囚服，钦犯/罪臣不等于囚服；古装/仙侠题材不得出现卫衣、连帽、运动鞋、牛仔裤、T恤、拉链、西装、衬衫等现代服装。`,
      }
    case 'scenes':
      return {
        maxTokens: 4000,
        temperature: 0.7,
        user: `${describe(project)}
${scriptContext(project)}${analysisContext(project)}${extra}

请产出主要场景（2–8 个），JSON 结构：
{
  "scenes": [{
    "id": "S01",
    "name": "场景名",
    "space": "空间结构：门窗/家具/动线/出入口（≤120 字）",
    "props": "固定道具与位置（≤80 字）",
    "palette": "主色与色调（≤40 字）",
    "keyLight": "主光源方向与色温（≤40 字）",
    "variants": [{"id":"S01_day","change":"只改时间/光线/氛围，不改空间结构"}]
  }]
}
要求：id 从 S01 递增；场景名优先使用【剧本场景】里的地点，不得把不同地点合并成一个；场景变体只改时间、光线、氛围，空间结构与固定道具位置不变。`,
      }
    case 'props':
      return {
        maxTokens: 3000,
        temperature: 0.7,
        user: `${describe(project)}
${scriptContext(project)}${analysisContext(project)}${extra}

请产出关键道具（1–5 个），JSON 结构：
{
  "props": [{
    "id": "P01",
    "name": "道具名",
    "function": "evidence|identity|countdown|keepsake|obstacle 之一",
    "appearance": "形状/材质/颜色/尺寸/磨损/标记（≤80 字）",
    "owner": "归属角色 id",
    "endPosition": "本集结束时在哪"
  }]
}
要求：id 从 P01 递增；每个道具必须有唯一持有者与结束位置；画面文字一律后期叠，不交给模型生成。剧本中反复出现、推动剧情或承载“回家/身份/证据”的物件必须保留，不能只生成装饰性道具。`,
      }
    case 'episode': {
      const target = context.episodeId ?? ''
      const existing = project.episodes.find(item => item.id === target)
      const targetSeconds = existing !== undefined && existing.targetSeconds > 0 ? existing.targetSeconds : project.meta.episodeSeconds
      const existingContext = existing === undefined ? '' : `

本集现有内容（只补/改节拍，不要改写已有正文）：
一句话：${existing.logline || '（空）'}
现有正文（${existing.script.length} 字）：
"""
${existing.script.slice(0, 6000)}
"""`
      return {
        maxTokens: 3200,
        temperature: 0.8,
        user: `${describe(project)}${extra}${existingContext}

请写一集（${existing === undefined ? '新建' : `改写 ${existing.id} 的节拍`}），JSON 结构：
{
  "episode": {
    "id": "${existing?.id ?? nextEpisodeId(project)}",
    "title": "集名",
    "logline": "本集一句话冲突（≤50 字）",
    "beats": [
      {"id":"B1","function":"hook","seconds":0,"text":"从剧本第一个动作开始，不新增剧本外动作/台词"},
      {"id":"B2","function":"goal","seconds":0,"text":"目标与阻碍"},
      {"id":"B3","function":"obstacle","seconds":0,"text":"误导/升级"},
      {"id":"B4","function":"choice","seconds":0,"text":"主动选择"},
      {"id":"B5","function":"cliff","seconds":0,"text":"反转/悬念"}
    ],
    "script": "可拍剧本：场景标题、动作、对白；用【VO】【OS】【SFX】【画面文字】标记"
  }
}
硬约束：beats 必须按现有正文顺序拆，不得新增剧本没有的冷开场、前情、动作或台词；第 1 拍从剧本第一句开始。beats 的 seconds 合计必须等于 ${targetSeconds}；每 15–20 秒至少一次新信息；集末悬念必须有可视化载体（手机/门/证件/戒指/录音/监控/伤痕/倒计时），不能只写「她震惊了」；台词单句 ≤15 字。${existing === undefined ? '' : '已有正文必须原样返回 script 字段，不要重写；只为现有正文补/调节拍。'}`,
      }
    }
    case 'shots': {
      const episodeId = context.episodeId ?? project.episodes[0]?.id ?? 'EP001'
      const targetEpisode = project.episodes.find(item => item.id === episodeId)
      const targetSeconds = targetEpisode !== undefined && targetEpisode.targetSeconds > 0 ? targetEpisode.targetSeconds : project.meta.episodeSeconds
      const maxShots = Math.max(4, Math.min(30, Math.floor(targetSeconds / 4)))
      return {
        maxTokens: 7600,
        temperature: 0.6,
        user: `${describe(project)}
${episodeContext(project, episodeId)}${extra}

请为 ${episodeId} 拆分镜，最多 ${maxShots} 镜，duration 合计约 ${targetSeconds} 秒。JSON 结构：
{
  "shots": [{
    "sceneId": "S01",
    "duration": 4,
    "size": "extreme-close|close|medium|wide|establishing",
    "camera": "运镜（≤12 字）",
    "blocking": "站位与视线（≤30 字）",
    "action": "唯一主动作：起点→过程→终点（≤50 字）",
    "endState": "结束姿态/画面停在哪（≤30 字）",
    "emotion": {"start":"≤10 字","trigger":"≤12 字","end":"≤10 字"},
    "dialogue": [{"speaker":"C01","text":"逐字台词（≤15 字）","offScreen":false,"voiceOver":false}],
    "sound": {"ambience":"≤12 字","sfx":"≤12 字","music":"≤12 字"},
    "refs": [{"slot":"REF-1","state":"plan","role":"identity","path":"","note":"角色 C01 定妆"}],
    "locks": ["LOCK-C01-LOCK"]
  }]
}
硬约束：
- 每镜只有一个主动作；复杂动作拆成多镜。
- 先按剧本正文顺序拆，第一镜从剧本第一个动作/第一句台词开始；不得新增冷开场、前情、剧本外动作或台词，每个动作/台词都必须能在正文中找到依据。
- 只使用已有场景/角色/道具 ID；不得发明新 ID。
- 单镜 duration 4–15 秒，所有镜头 duration 合计 = ${targetSeconds}（允许 ±2 秒，但必须写满）。
- 台词字数 / 4 ≈ 发声秒数，必须 ≤ duration − 0.5。
- refs 的 state：ref=项目里已有文件；plan=创作者自己挂图（按顺序）；missing=待补（阻断）；t2v=明确文生视频。
- locks 引用角色锁（如 LOCK-C01-OUTFIT），后续编译时逐字写入正文。
- 不要写「她震惊了」这类不可见情绪，写可观察的表演。
- 字段必须短，确保整个 JSON 在输出上限内完整闭合；宁可少一镜，不要截断。`,
      }
    }
  }
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): { merged: T[], added: number, updated: number } {
  const byId = new Map(current.map(item => [item.id, item]))
  let added = 0
  let updated = 0
  for (const item of incoming) {
    if (byId.has(item.id)) {
      byId.set(item.id, { ...byId.get(item.id), ...item })
      updated += 1
    } else {
      byId.set(item.id, item)
      added += 1
    }
  }
  return { merged: [...byId.values()], added, updated }
}

export class Generator {
  constructor(private readonly llm: DshLlm) {}

  /** 内部剧本事实解析：逐人给性别/服装，必须带原句证据；不再让用户确认。 */
  private async ensureScriptAnalysis(context: GenerateContext, signal?: AbortSignal): Promise<Project> {
    const project = context.project
    if (project.scriptAnalysis.accepted && project.scriptAnalysis.episodes.length > 0) return project
    const scripts = project.episodes.map(episode => episode.script).filter(text => text.trim() !== '')
    if (scripts.length === 0) return project
    const cast = castNames(scripts)
    const locations = locationNames(scripts)
    if (cast.length === 0) return project
    const excerpt = project.episodes
      .filter(episode => episode.script.trim() !== '')
      .map(episode => `${episode.id}《${episode.title}》\n${episode.script}`)
      .join('\n\n')
      .slice(0, 24000)
    let reply
    try {
      reply = await this.llm.chatJson<{ cast?: Array<Record<string, unknown>> }>({
        provider: context.provider,
        model: context.model,
        label: 'AI 短剧·剧本事实解析',
        system: '你是剧本统筹。只提取剧本明确写出的事实，不改写、不补设定。',
        user: `人物候选：${cast.join('、') || '无'}
场景候选：${locations.join('、') || '无'}

请只输出 JSON：
{"cast":[{"name":"必须来自人物候选","gender":"男|女|未知","role":"社会身份/关系，例如朝臣、女帝、女官、狱卒、太子、掌柜；不能只写主角/对手/辅助","roleEvidence":["支持 role 的剧本原句"],"costume":"剧本明确写到的服装，没写就空字符串","evidence":"剧本原句"}]}

硬规则：
- 人物名必须逐字来自人物候选，不能改名、合并、发明；
- 性别按剧本里的称谓/身份词/代词判断，不能根据“囚犯/女帝”等身份想当然；
- role 必须综合自称、他称、官职、职业、关系词；出现“臣/微臣/属下/末将/奴婢/奴才/大人/公公”等时，必须把朝臣/属下/内侍/女官等社会身份写进 role，不能只写囚犯/旧识；
- roleEvidence 至少 1 条，必须是剧本原文连续子句；不能自己概括；
- 服装只认剧本明确写到的服饰词；没写就留空，绝不能因为身份是钦犯就写囚服；
- evidence 必须是剧本原文中的连续子句，不能自己概括。

剧本节选：
"""
${excerpt}
"""`,
        maxTokens: 3000,
        temperature: 0.1,
        signal,
      })
    } catch (error) {
      throw new Error(`剧本事实解析失败，已停止生成资产：${messageOf(error)}`)
    }
    const byName = new Map<string, { name: string, gender: '男' | '女' | '未知', role: string, roleEvidence: string[], costume: string, evidence: string }>()
    for (const raw of reply.value.cast ?? []) {
      const name = asString(raw.name).trim()
      if (!cast.includes(name)) continue
      const gender = asString(raw.gender).trim()
      const evidence = asString(raw.evidence).trim()
      const roleEvidence = Array.isArray(raw.roleEvidence)
        ? raw.roleEvidence.map(item => asString(item).trim()).filter(item => item !== '' && excerpt.includes(item)).slice(0, 5)
        : []
      byName.set(name, {
        name,
        gender: gender === '男' || gender === '女' ? gender : '未知',
        role: asString(raw.role).trim(),
        roleEvidence,
        costume: asString(raw.costume).trim(),
        evidence: evidence !== '' && excerpt.includes(evidence) ? evidence : '',
      })
    }
    if (byName.size === 0) throw new Error('剧本事实解析没有返回可用人物，已停止生成资产')
    const unresolved = cast.slice(0, 4).filter(name => byName.get(name)?.gender === '未知')
    if (unresolved.length > 0) {
      throw new Error(`剧本事实解析无法确定主要角色性别：${unresolved.join('、')}；已停止生成资产，不把“未知”写进角色卡`)
    }
    const unresolvedRoles = cast.slice(0, 4).filter(name => isGenericRole(byName.get(name)?.role ?? ''))
    if (unresolvedRoles.length > 0) {
      throw new Error(`剧本事实解析无法确定主要角色身份：${unresolvedRoles.join('、')}；role 不能只写主角/对手/辅助`)
    }
    const episodes = project.episodes.map(episode => {
      const episodeCast = cast
        .filter(name => episode.script.includes(name))
        .map(name => {
          const found = byName.get(name)
          return {
            name,
            gender: found?.gender ?? '未知',
            role: found?.role ?? '',
            roleEvidence: found?.roleEvidence ?? [],
            evidence: found?.evidence ?? '',
            costume: found?.costume ?? '',
            costumeEvidence: '',
          }
        })
      return {
        episodeId: episode.id,
        cast: episodeCast,
        locations: locationNamesFromText(episode.script).map(name => ({ name, evidence: '' })),
      }
    })
    return {
      ...project,
      scriptAnalysis: { episodes, accepted: true, generatedAt: Date.now() },
    }
  }

  private async repairGenericRoles(
    context: GenerateContext,
    project: Project,
    incoming: Character[],
    generic: Character[],
    signal?: AbortSignal,
  ): Promise<void> {
    const names = generic.map(character => character.name).join('、')
    const relevant = project.episodes
      .filter(episode => generic.some(character => episode.script.includes(character.name)))
      .map(episode => `${episode.id}《${episode.title}》\n${episode.script}`)
      .join('\n\n')
      .slice(0, 24000)
    const excerpt = relevant === '' ? project.episodes.map(episode => episode.script).join('\n').slice(0, 12000) : relevant
    const reply = await this.llm.chatJson<{ roles?: Array<Record<string, unknown>> }>({
      provider: context.provider,
      model: context.model,
      label: 'AI 短剧·角色身份修复',
      system: '你只做角色身份校对。角色定位必须来自剧本原句，不能只写主角/对手/辅助。',
      user: `这些角色的定位只有泛化标签：${names}

请只输出 JSON：
{"roles":[{"name":"角色名","role":"身份/职业/关系","roleEvidence":["剧本原句"]}]}

规则：
- 角色名必须来自上面的人名；
- role 不能是主角/配角/对手/辅助/反派/路人；
- roleEvidence 至少一条，必须是剧本原文连续子句；
- 剧本里没有明确身份就写“身份未明写”，不能编。

剧本节选：
"""
${excerpt}
"""`,
      maxTokens: 2000,
      temperature: 0.1,
      signal,
    })
    const byName = new Map(incoming.map(character => [character.name, character]))
    for (const raw of reply.value.roles ?? []) {
      const name = asString(raw.name).trim()
      const target = byName.get(name)
      if (target === undefined || !generic.includes(target)) continue
      const role = asString(raw.role).trim()
      if (isGenericRole(role)) continue
      const evidence = Array.isArray(raw.roleEvidence)
        ? raw.roleEvidence.map(item => asString(item).trim()).filter(item => item !== '' && excerpt.includes(item)).slice(0, 5)
        : []
      target.role = role
      target.roleEvidence = evidence
    }
  }

  async generate(context: GenerateContext, signal?: AbortSignal): Promise<GenerateOutcome> {
    if (context.stage === 'shots') return await this.generateShots(context, signal)
    const prepared = context.stage === 'characters' || context.stage === 'scenes'
      ? { ...context, project: await this.ensureScriptAnalysis(context, signal) }
      : context
    const prompt = userPrompt(prepared)
    const reply = await this.llm.chatJson<Record<string, unknown>>({
      provider: prepared.provider,
      model: prepared.model,
      label: `AI 短剧·${prepared.stage}`,
      system: SYSTEM,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      temperature: prompt.temperature,
      signal,
    })
    const base = structuredClone(prepared.project)
    const notes: string[] = []
    const data = reply.value

    switch (prepared.stage) {
      case 'bible': {
        base.title = asString(data.title).trim() || base.title
        base.bible.premise = asString(data.premise).trim()
        base.bible.world = asString(data.world).trim()
        base.bible.arc = asString(data.arc).trim()
        base.bible.episodePlan = asString(data.episodePlan).trim()
        base.bible.visualDirection = asString(data.visualDirection).trim()
        base.meta.theme = asString(data.theme).trim()
        base.meta.hook = asString(data.hook).trim()
        notes.push('已生成总纲；请确认一句话卖点与集末钩子。')
        break
      }
      case 'characters': {
        const incoming = normalizeProject({ ...base, characters: data.characters }).characters
        const requiredCast = castNames(base.episodes.map(episode => episode.script))
        if (requiredCast.length > 0) {
          const invalid = incoming.filter(character => !requiredCast.includes(character.name.trim()))
          if (invalid.length > 0) {
            throw new Error(`角色名必须来自剧本人物表（${requiredCast.join('、')}）；模型返回了：${invalid.map(item => item.name || '(空)').join('、')}。请重试或先修正剧本人物表`)
          }
        }
        if (base.scriptAnalysis.accepted) {
          const known = new Map(base.scriptAnalysis.episodes.flatMap(episode => episode.cast).map(member => [member.name, member.gender]))
          const wrong = incoming.filter(character => {
            const gender = known.get(character.name.trim())
            return gender !== undefined && gender !== '未知' && !character.slots.ageGender.includes(gender)
          })
          if (wrong.length > 0) {
            throw new Error(`角色性别与剧本事实冲突：${wrong.map(item => item.name).join('、')}`)
          }
          const roleByName = new Map(base.scriptAnalysis.episodes.flatMap(episode => episode.cast)
            .filter(member => member.role.trim() !== '' && !isGenericRole(member.role))
            .map(member => [member.name, member]))
          for (const character of incoming) {
            const mapped = roleByName.get(character.name.trim())
            if (mapped !== undefined) {
              character.role = mapped.role
              character.roleEvidence = mapped.roleEvidence
            }
          }
        }
        let genericRoles = base.scriptAnalysis.accepted
          ? incoming.filter(character => isGenericRole(character.role))
          : []
        if (genericRoles.length > 0) {
          await this.repairGenericRoles(context, base, incoming, genericRoles, signal)
          genericRoles = incoming.filter(character => isGenericRole(character.role))
        }
        if (genericRoles.length > 0) {
          throw new Error(`角色定位不能只写主角/对手/辅助：${genericRoles.map(item => item.name).join('、')}；必须从剧本称谓/职业/关系里给出身份`)
        }
        const evidenceByName = new Map(base.scriptAnalysis.episodes.flatMap(episode => episode.cast)
          .map(member => [member.name, member.roleEvidence]))
        for (const character of incoming) {
          if ((character.roleEvidence ?? []).length === 0) {
            character.roleEvidence = evidenceByName.get(character.name.trim()) ?? []
          }
          if ((character.roleEvidence ?? []).length === 0) {
            character.roleEvidence = base.episodes
              .flatMap(episode => episode.script.split(/[。！？\n]/))
              .filter(line => line.includes(character.name))
              .map(line => line.trim())
              .filter(line => line !== '')
              .slice(0, 5)
          }
        }
        for (const character of incoming) {
          const scriptLines = base.episodes.flatMap(episode => episode.script.split(/[。！？\n]/)).map(line => line.trim())
          const identityLines = scriptLines
            .filter(line => line.includes(character.name) && /臣|微臣|属下|末将|奴婢|奴才|大人|公公/.test(line))
          character.roleEvidence = [...new Set([...(character.roleEvidence ?? []), ...identityLines])].slice(0, 8)
          const evidenceText = character.roleEvidence.join('')
          const selfCourt = scriptLines.some(line => (line.startsWith(`${character.name}:`) || line.startsWith(`${character.name}：`)) && /臣|微臣/.test(line))
          const roleParts = character.role.split(/[\/、，,]/).map(part => part.trim()).filter(Boolean)
          const royal = roleParts.some(part => /^(女帝|皇帝|王爷|皇叔|宗室|太子|公主|朕|本王|本宫)$/.test(part) || /王$/.test(part))
          if (selfCourt && !royal && !/朝臣|臣子|官员|属下|末将/.test(character.role)) {
            character.role = character.role === '' ? '朝臣' : `${character.role}/朝臣`
          }
          if (/公公|太监/.test(evidenceText)) {
            character.role = character.role.replace(/[^/]*侍郎[^/]*/g, '').replace(/^\/+|\/+$/g, '')
            if (!/内侍|太监|宦官/.test(character.role)) character.role = character.role === '' ? '内侍' : `${character.role}/内侍`
          }
        }
        const scriptText = base.episodes.map(episode => episode.script).join('\n')
        const guessedPrison = incoming.filter(character => /囚服|狱服/.test(character.slots.outfit) && !/囚服|狱服/.test(scriptText))
        if (guessedPrison.length > 0) {
          throw new Error(`剧本没有写囚服，模型却给 ${guessedPrison.map(item => item.name).join('、')} 写了囚服；请重试，服装只能来自剧本或用户指定`)
        }
        if (base.meta.genre === 'costume' || base.meta.genre === 'xianxia') {
          const modern = incoming.filter(character => /卫衣|连帽|运动鞋|牛仔裤|T恤|拉链|西装|衬衫/.test(character.slots.outfit))
          if (modern.length > 0) {
            throw new Error(`古装/仙侠题材不能出现现代服装：${modern.map(item => `${item.name}（${item.slots.outfit.slice(0, 30)}）`).join('、')}`)
          }
        }
        const current = new Map(base.characters.map(character => [character.id, character]))
        let added = 0
        let updated = 0
        for (const character of incoming) {
          character.lockText = renderLockText(character)
          const old = current.get(character.id)
          if (old === undefined) {
            current.set(character.id, character)
            added += 1
            continue
          }
          // 重生成只更新创作字段；媒体、音色、LOOK、人工锁定与身份锁必须保留。
          current.set(character.id, {
            ...old,
            ...character,
            slots: old.status === 'locked' ? old.slots : character.slots,
            identityLock: old.identityLock,
            looks: old.looks,
            stateVariants: old.stateVariants,
            refs: old.refs,
            refPrompts: old.refPrompts,
            voiceCard: old.voiceCard,
            status: old.status,
            lockText: old.status === 'locked' ? old.lockText : character.lockText,
          })
          updated += 1
        }
        base.characters = [...current.values()]
        notes.push(`角色：新增 ${added}，更新 ${updated}。媒体/LOOK/音色/锁定状态已保留。`)
        break
      }
      case 'scenes': {
        const incoming = normalizeProject({ ...base, scenes: data.scenes }).scenes
        const current = new Map(base.scenes.map(scene => [scene.id, scene]))
        let added = 0
        let updated = 0
        for (const scene of incoming) {
          const old = current.get(scene.id)
          if (old === undefined) {
            current.set(scene.id, scene)
            added += 1
          } else {
            current.set(scene.id, { ...old, ...scene, refImage: old.refImage, variants: old.variants })
            updated += 1
          }
        }
        base.scenes = [...current.values()]
        const locations = locationNames(base.episodes.map(episode => episode.script))
        let sceneFallback = 0
        for (const location of locations) {
          if (base.scenes.some(scene => scene.name.includes(location) || location.includes(scene.name))) continue
          const id = `S${String(base.scenes.length + 1).padStart(2, '0')}`
          base.scenes.push({
            id, name: location, appearsIn: [], space: '（从剧本场次标题补建，待补空间结构）',
            props: '', palette: '', keyLight: '', refImage: '', variants: [],
          })
          sceneFallback += 1
        }
        notes.push(`场景：新增 ${added}，更新 ${updated}${sceneFallback === 0 ? '' : `；另按剧本场次补建 ${sceneFallback} 个未覆盖场景`}；参考图已保留。`)
        break
      }
      case 'props': {
        const incoming = normalizeProject({ ...base, props: data.props }).props
        const current = new Map(base.props.map(prop => [prop.id, prop]))
        let added = 0
        let updated = 0
        for (const prop of incoming) {
          const old = current.get(prop.id)
          if (old === undefined) {
            current.set(prop.id, prop)
            added += 1
          } else {
            current.set(prop.id, { ...old, ...prop, refImage: old.refImage })
            updated += 1
          }
        }
        base.props = [...current.values()]
        const scriptText = base.episodes.map(episode => episode.script).join('\n')
        if (scriptText.includes('手机') && !base.props.some(prop => prop.name.includes('手机'))) {
          const ownerLine = base.episodes.flatMap(episode => episode.script.split(/[。！？\n]/))
            .find(line => line.includes('手机')) ?? ''
          const owner = base.characters.find(character => ownerLine.includes(character.name))?.id ?? base.characters[0]?.id ?? ''
          const nextId = `P${String(base.props.length + 1).padStart(2, '0')}`
          base.props.push({
            id: nextId,
            name: '手机',
            function: 'countdown',
            appearance: '现代智能手机，按剧本描述保留屏幕/电量/裂纹等状态特征',
            owner,
            endPosition: '',
            appearsIn: [],
            refImage: '',
          })
          added += 1
        }
        notes.push(`道具：新增 ${added}，更新 ${updated}；参考图已保留。`)
        break
      }
      case 'episode': {
        const raw = (data.episode !== null && typeof data.episode === 'object') ? data.episode as Record<string, unknown> : {}
        const normalized = normalizeProject({ ...base, episodes: [raw] }, ).episodes[0]
        if (normalized === undefined) throw new Error('模型没有返回 episode')
        const id = context.episodeId ?? nextEpisodeId(base)
        const existingIndex = base.episodes.findIndex(item => item.id === id)
        const previous = existingIndex >= 0 ? base.episodes[existingIndex] : undefined
        const episode: Episode = {
          ...normalized,
          id,
          title: previous?.title ?? normalized.title,
          targetSeconds: previous?.targetSeconds ?? 0,
          script: previous !== undefined && previous.script.trim() !== '' ? previous.script : normalized.script,
          shots: previous?.shots ?? [],
          segments: previous?.segments ?? [],
          scriptLocked: previous?.scriptLocked ?? false,
          scriptHash: previous?.scriptHash ?? '',
        }
        if (existingIndex >= 0) base.episodes[existingIndex] = episode
        else base.episodes.push(episode)
        // 模型常把 beats 秒数写大；按本集目标重新分配，避免导入/生成后立刻 GEN-005。
        balanceBeats(episode, episode.targetSeconds > 0 ? episode.targetSeconds : base.meta.episodeSeconds)
        notes.push(`已生成 ${id}《${episode.title}》；节拍 ${episode.beats.length} 个，剧本 ${episode.script.length} 字。`)
        break
      }
    }

    base.updatedAt = Date.now()
    if (prepared.stage === 'characters' || prepared.stage === 'scenes') lockScripts(base)
    fillAppearances(base)
    return { project: base, notes: notes.join(' '), usage: reply.usage }
  }

  /**
   * 分镜分段生成：每段最多 5 镜、独立一次调用。
   *
   * 原因：一次让模型输出整集 10+ 镜的完整 JSON，很容易撞上模型输出上限被截断
   * （实测 5783 字符处断在属性名中间）。分段后每段都有独立的 token 预算，
   * 失败只影响该段；最后统一编号、合并、把时长差补齐到单集目标。
   */
  private async generateShots(context: GenerateContext, signal?: AbortSignal): Promise<GenerateOutcome> {
    const base = structuredClone(context.project)
    const episodeId = context.episodeId ?? base.episodes[0]?.id
    if (episodeId === undefined) throw new Error('还没有任何一集，请先生成分集')
    const index = base.episodes.findIndex(item => item.id === episodeId)
    const episode = base.episodes[index]
    if (episode === undefined) throw new Error(`找不到 ${episodeId}`)

    const targetSeconds = episode.targetSeconds > 0 ? episode.targetSeconds : base.meta.episodeSeconds
    if (targetSeconds < 16) throw new Error(`单集目标 ${targetSeconds}s 低于 4 镜 × 4 秒的最小可行时长；请先调整本集时长`)
    const maxShots = Math.max(4, Math.min(30, Math.floor(targetSeconds / 4)))
    const chunkSize = 2
    const chunks = Math.max(1, Math.ceil(maxShots / chunkSize))
    const collected: Shot[] = []
    let inputTokens = 0
    let outputTokens = 0
    const extra = context.instruction === undefined || context.instruction.trim() === '' ? '' : `\n用户补充要求：${context.instruction.trim()}`

    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const count = Math.min(chunkSize, maxShots - chunk * chunkSize)
      const seconds = Math.max(3 * count, Math.round(targetSeconds * count / maxShots))
      const previous = collected.length === 0
        ? ''
        : `\n前面已生成的镜头（不要重复这些动作）：${collected.slice(-6).map(item => item.action).join('；')}`
      const user = `${describe(base)}
${episodeContext(base, episodeId)}${previous}${extra}

这是${episodeId}分镜的第 ${chunk + 1}/${chunks} 段，只输出 ${count} 个镜头，duration 合计约 ${seconds} 秒。不要重复前面段落的镜头。JSON 结构：
{"shots":[{"sceneId":"S01","duration":4,"size":"medium","camera":"≤12字","blocking":"≤30字","action":"起点→过程→终点（≤50字）","endState":"≤30字","emotion":{"start":"≤10字","trigger":"≤12字","end":"≤10字"},"dialogue":[{"speaker":"C01","text":"≤15字","offScreen":false,"voiceOver":false}],"sound":{"ambience":"≤12字","sfx":"≤12字","music":"≤12字"},"refs":[{"slot":"REF-1","state":"plan","role":"identity","path":"","note":"≤16字"}],"locks":["LOCK-C01-LOCK"]}]}
硬约束：一镜一个主动作；duration 4–15 秒；台词字数 / 4 ≤ duration − 0.5；refs 的 state 用 ref/plan/missing/t2v；字段必须短，确保 JSON 完整闭合。`

      const reply = await this.llm.chatJson<Record<string, unknown>>({
        provider: context.provider,
        model: context.model,
        label: `AI 短剧·分镜 ${chunk + 1}/${chunks}`,
        system: SYSTEM,
        user,
        maxTokens: 2600,
        temperature: 0.6,
        signal,
      })
      inputTokens += reply.usage.inputTokens
      outputTokens += reply.usage.outputTokens
      const incoming = normalizeProject({ ...base, episodes: [{ id: episodeId, shots: reply.value.shots }] }).episodes[0]?.shots ?? []
      if (incoming.length === 0) throw new Error(`第 ${chunk + 1} 段没有返回镜头`)
      collected.push(...incoming.slice(0, count))
    }

    let remapped = 0
    const sceneIds = new Set(base.scenes.map(scene => scene.id))
    const characterIds = new Set(base.characters.map(character => character.id))
    const shots: Shot[] = collected.map((shot, i) => {
      const knownScene = sceneIds.has(shot.sceneId)
      if (!knownScene) remapped += 1
      const dialogue = shot.dialogue.filter(line => line.speaker !== '' && characterIds.has(line.speaker))
      const refs = shot.refs.map(ref => ref.state === 'ref' && ref.path.trim() === '' ? { ...ref, state: 'plan' as const } : ref)
      const validLocks = shot.locks.filter(lock => /^LOCK-C\d+/i.test(lock))
      const withDialogue = { ...shot, dialogue }
      return {
        ...shot,
        dialogue,
        refs,
        id: newShotId(episodeId, i),
        sceneId: knownScene ? shot.sceneId : base.scenes[0]?.id ?? '',
        locks: validLocks.length > 0 ? validLocks : defaultLocks(withDialogue, base),
        prompt: { dialect: '', text: '', compiledAt: 0, version: 0, inputHash: '', warnings: [] },
      }
    })

    // 模型自创的台词不进入项目；只保留剧本里逐字能找到的对白。
    const scriptKey = dialogueKey(episode.script)
    if (scriptKey !== '') {
      for (const shot of shots) {
        shot.dialogue = shot.dialogue.filter(line => line.text.trim() !== '' && scriptKey.includes(dialogueKey(line.text)))
      }
    }

    // 把时长差补齐到本集目标（每镜限制 3–15 秒）。
    const target = targetSeconds
    let total = shots.reduce((sum, shot) => sum + shot.duration, 0)
    for (let guard = 0; guard < 400 && total !== target; guard += 1) {
      let changed = false
      for (const shot of shots) {
        if (total < target && shot.duration < 15) { shot.duration += 1; total += 1; changed = true }
        else if (total > target && shot.duration > 4) { shot.duration -= 1; total -= 1; changed = true }
        if (total === target) break
      }
      if (!changed) break
    }

    episode.shots = shots
    episode.segments = groupShotsIntoSegments(shots, episodeId)
    episode.scriptLocked = true
    episode.scriptHash = hashScript(episode.script)
    episode.status = 'boarded'
    base.updatedAt = Date.now()
    const mismatch = total === target ? '' : `（时长合计 ${total}s，目标 ${target}s，仍有偏差）`
    const remapNote = remapped === 0 ? '' : `；${remapped} 镜引用了不存在的场景，已回退到 ${base.scenes[0]?.id ?? '空场景'}，请逐镜检查`
    return {
      project: base,
      notes: `已分段生成 ${episodeId} 的分镜 ${shots.length} 镜${mismatch}${remapNote}；请检查台词容量与一镜一动作，再编译提示词。`,
      usage: { inputTokens, outputTokens },
    }
  }
}

/** 由九槽渲染只读锁面：确定性、可复制、无同义词改写。 */
export function renderLockText(character: Character): string {
  const s = character.slots
  const parts = [
    s.ageGender && `年龄性别：${s.ageGender}`,
    s.face && `脸型五官：${s.face}`,
    s.hair && `发型发色：${s.hair}`,
    s.body && `体型身高：${s.body}`,
    s.outfit && `服装：${s.outfit}`,
    s.accessories && `配饰：${s.accessories}`,
    s.temperament && `气质：${s.temperament}`,
    s.forbidden && `禁改：${s.forbidden}`,
    s.lightBaseline && `光线基准：${s.lightBaseline}`,
  ].filter((item): item is string => typeof item === 'string' && item !== '')
  return parts.join('；')
}

function defaultLocks(shot: Shot, project: Project): string[] {
  const ids = shot.dialogue.map(line => line.speaker).filter(Boolean)
  const locks: string[] = []
  for (const id of ids) {
    const character = project.characters.find(item => item.id === id)
    if (character !== undefined) locks.push(`LOCK-${character.id}-LOCK`)
  }
  return locks
}
