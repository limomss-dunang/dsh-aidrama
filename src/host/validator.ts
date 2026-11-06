/**
 * 校验器：把「能判定的」做成硬规则。
 *
 * 规则分级参考 drama-skills：
 * - error：结构不成立，投产会出错或必然返工；
 * - warn：经验风险，允许人确认后继续；
 * - info：提示，不阻断。
 *
 * 每条 finding 带 ruleId + 中文原因 + 定位（episodeId/shotId/field）。
 */

import type { Episode, Finding, Project, ValidationResult } from '../shared/types.ts'
import { shotInputHash } from './compiler.ts'
import { castNames, locationNamesFromText } from '../shared/script.ts'

const VERBS = ['走', '跑', '冲', '拿', '推', '拉', '转身', '坐下', '站起', '打', '踢', '抱', '哭', '笑', '说', '看', '低头', '抬头', '举', '扔']

const CONTRADICTIONS: Array<{ a: RegExp, b: RegExp, message: string }> = [
  { a: /8\s*mm|胶片感|film\s*grain/i, b: /4K|超清|ultra\s*sharp/i, message: '「胶片感」与「4K 超清」互相抵消' },
  { a: /慢动作|slow\s*motion/i, b: /高速|high\s*speed/i, message: '「慢动作」与「高速动作」互相抵消' },
  { a: /电影感/i, b: /纪实手持|documentary\s*handheld/i, message: '「电影感」与「纪实手持」强写会互相拉扯' },
]

function err(ruleId: string, message: string, episodeId?: string, shotId?: string, field?: string): Finding {
  return { ruleId, level: 'error', message, ...(episodeId === undefined ? {} : { episodeId }), ...(shotId === undefined ? {} : { shotId }), ...(field === undefined ? {} : { field }) }
}

function warn(ruleId: string, message: string, episodeId?: string, shotId?: string, field?: string): Finding {
  return { ruleId, level: 'warn', message, ...(episodeId === undefined ? {} : { episodeId }), ...(shotId === undefined ? {} : { shotId }), ...(field === undefined ? {} : { field }) }
}

function info(ruleId: string, message: string, episodeId?: string, shotId?: string, field?: string): Finding {
  return { ruleId, level: 'info', message, ...(episodeId === undefined ? {} : { episodeId }), ...(shotId === undefined ? {} : { shotId }), ...(field === undefined ? {} : { field }) }
}

export function validateProject(project: Project, onlyEpisode?: string): ValidationResult {
  const findings: Finding[] = []
  const characterIds = new Set(project.characters.map(item => item.id))
  const sceneIds = new Set(project.scenes.map(item => item.id))
  const propIds = new Set(project.props.map(item => item.id))
  if (project.styles.length === 0 || project.styles[0]?.prompt.trim() === '') {
    findings.push(warn('GEN-023', '没有全局风格锚：角色图、场景图、首帧和视频会各生成各的风格', undefined, undefined, 'styles'))
  } else if (project.styles[0]?.status !== 'accepted') {
    findings.push(warn('GEN-023', '风格锚还没锁定（accepted）：先确认风格规格并锁定，再生成图片/视频', undefined, undefined, 'styles'))
  }

  // GEN-001 资产 ID 唯一
  const seen = new Map<string, string>()
  for (const [kind, items] of [['角色', project.characters], ['场景', project.scenes], ['道具', project.props]] as const) {
    for (const item of items) {
      const key = `${kind}:${item.id}`
      if (seen.has(key)) findings.push(err('GEN-001', `${kind} ID 重复：${item.id}`, undefined, undefined, 'id'))
      seen.set(key, item.name)
      if (item.id.trim() === '') findings.push(err('GEN-001', `${kind}存在空 ID`, undefined, undefined, 'id'))
    }
  }

  const episodes = project.episodes.filter(episode => onlyEpisode === undefined || episode.id === onlyEpisode)
  if (episodes.length === 0) {
    findings.push(info('GEN-000', '还没有分集；先生成或新建一集'))
  }
  const episodeIds = new Set<string>()
  const allShotIds = new Map<string, string>()
  for (const episode of project.episodes) {
    if (episode.id.trim() === '') findings.push(err('GEN-001', '存在空的分集 ID', undefined, undefined, 'episodes'))
    if (episodeIds.has(episode.id)) findings.push(err('GEN-001', `分集 ID 重复：${episode.id}`, episode.id, undefined, 'episodes'))
    episodeIds.add(episode.id)
    for (const shot of episode.shots) {
      if (allShotIds.has(shot.id)) findings.push(err('GEN-001', `分镜 ID 跨集重复：${shot.id}（${allShotIds.get(shot.id)} / ${episode.id}）`, episode.id, shot.id, 'id'))
      else allShotIds.set(shot.id, episode.id)
    }
  }
  for (const prop of project.props) {
    if (prop.owner !== '' && !characterIds.has(prop.owner)) {
      findings.push(err('GEN-002', `道具 ${prop.id} 的持有者 ${prop.owner} 不存在`, undefined, undefined, 'owner'))
    }
  }

  // GEN-018 主要角色必须来自剧本人物表（按出现频次取前 4 个作为硬要求）
  const scripts = project.episodes.map(episode => episode.script).filter(text => text.trim() !== '')
  if (scripts.length > 0) {
    const cast = castNames(scripts)
    const count = (name: string): number => scripts.reduce((sum, script) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return sum + (script.match(new RegExp(escaped, 'g'))?.length ?? 0)
    }, 0)
    const mainCast = [...cast].sort((a, b) => count(b) - count(a)).slice(0, 4)
    const presentNames = new Set(project.characters.map(character => character.name.trim()))
    for (const name of mainCast) {
      if (!presentNames.has(name)) {
        findings.push(err('GEN-018', `剧本主要角色「${name}」不在角色表；请重新生成角色或手动补齐`, undefined, undefined, 'characters'))
      }
    }
    for (const name of cast) {
      if (!presentNames.has(name)) {
        findings.push(info('GEN-018', `剧本角色「${name}」未建模（次要角色可忽略）`, undefined, undefined, 'characters'))
      }
    }
  }

  // GEN-019 本集剧本场景必须落成场景资产
  const sceneNames = project.scenes.map(scene => scene.name)
  for (const episode of episodes) {
    for (const location of locationNamesFromText(episode.script)) {
      if (!sceneNames.some(name => name.includes(location) || location.includes(name))) {
        findings.push(err('GEN-019', `${episode.id} 的剧本场景「${location}」没有对应场景资产`, episode.id, undefined, 'scenes'))
      }
    }
  }

  for (const character of project.characters.slice(0, 4)) {
    if ((character.roleEvidence ?? []).length === 0) {
      findings.push(err('GEN-024', `主要角色 ${character.id} ${character.name} 的定位没有剧本证据`, undefined, undefined, 'roleEvidence'))
    }
    if ((project.meta.genre === 'costume' || project.meta.genre === 'xianxia')
      && /卫衣|连帽|运动鞋|牛仔裤|T恤|拉链|西装|衬衫/.test(character.slots.outfit)) {
      findings.push(err('GEN-025', `古装/仙侠题材角色 ${character.id} ${character.name} 出现了现代服装`, undefined, undefined, 'outfit'))
    }
  }

  for (const episode of episodes) {
    const targetSeconds = episode.targetSeconds > 0 ? episode.targetSeconds : project.meta.episodeSeconds
    // GEN-005 节拍时长
    const beatSeconds = episode.beats.reduce((sum, beat) => sum + beat.seconds, 0)
    if (episode.beats.length > 0 && Math.abs(beatSeconds - targetSeconds) > 2) {
      findings.push(err('GEN-005', `节拍时长合计 ${beatSeconds}s，与单集时长 ${targetSeconds}s 相差超过 2 秒`, episode.id, undefined, 'beats'))
    }
    if (episode.beats.length === 0) {
      findings.push(warn('GEN-005', '本集还没有节拍表', episode.id, undefined, 'beats'))
    }

    const shotIds = new Set<string>()
    for (const shot of episode.shots) {
      // GEN-001b 分镜 ID 唯一
      if (shotIds.has(shot.id)) findings.push(err('GEN-001', `分镜 ID 重复：${shot.id}`, episode.id, shot.id, 'id'))
      shotIds.add(shot.id)

      // GEN-002 引用存在
      if (shot.sceneId.trim() === '') {
        findings.push(err('GEN-002', '镜头没有指定场景', episode.id, shot.id, 'sceneId'))
      } else if (!sceneIds.has(shot.sceneId)) {
        findings.push(err('GEN-002', `镜头引用的场景 ${shot.sceneId} 不存在`, episode.id, shot.id, 'sceneId'))
      }
      for (const line of shot.dialogue) {
        if (line.speaker.trim() === '') {
          findings.push(err('GEN-002', '台词没有指定说话人', episode.id, shot.id, 'dialogue'))
        } else if (!characterIds.has(line.speaker)) {
          findings.push(err('GEN-002', `台词说话人 ${line.speaker} 不在角色表`, episode.id, shot.id, 'dialogue'))
        }
      }
      for (const lock of shot.locks) {
        const match = /^LOCK-(C\d+)/i.exec(lock)
        if (match === null) {
          findings.push(err('GEN-002', `锁引用格式非法：${lock}`, episode.id, shot.id, 'locks'))
        } else if (!characterIds.has(match[1])) {
          findings.push(err('GEN-002', `镜头引用的锁 ${lock} 没有对应角色`, episode.id, shot.id, 'locks'))
        }
      }
      if (shot.action.trim() === '') {
        findings.push(err('GEN-003', '缺少唯一主动作', episode.id, shot.id, 'action'))
      } else {
        // GEN-003 一镜一主动作（启发式，只报 warn）
        const hits = VERBS.filter(verb => shot.action.includes(verb))
        if (hits.length >= 4) {
          findings.push(warn('GEN-003', `动作描述含 ${hits.length} 个动词（${hits.join('、')}），可能一镜多动作；建议拆分`, episode.id, shot.id, 'action'))
        }
      }

      // GEN-004 台词容量
      const chars = shot.dialogue.reduce((sum, line) => sum + line.text.length, 0)
      const need = chars / 3.8
      if (need > Math.max(0.5, shot.duration - 0.5)) {
        findings.push(err('GEN-004', `台词 ${chars} 字约需 ${need.toFixed(1)}s，超过镜头 ${shot.duration}s（按 3.8 字/秒，留 0.5s 余量）`, episode.id, shot.id, 'dialogue'))
      }
      for (const line of shot.dialogue) {
        if (line.text.length > 20) findings.push(warn('GEN-011', `台词 ${line.text.length} 字超过 20 字字幕软限`, episode.id, shot.id, 'dialogue'))
        else if (line.text.length > 15) findings.push(info('GEN-011', `台词 ${line.text.length} 字超过 15 字口型硬限（非口型镜可忽略）`, episode.id, shot.id, 'dialogue'))
        if (/（.*）|^…+$|^\.\.\.+$/.test(line.text)) {
          findings.push(err('GEN-004', `台词包含舞台指示或纯省略号，不可朗读：「${line.text}」`, episode.id, shot.id, 'dialogue'))
        }
      }

      // GEN-006 参考图四态
      const states = shot.refs.map(ref => ref.state)
      if (states.includes('missing')) {
        findings.push(err('GEN-006', '有参考槽位处于「待补」，投产前必须补图或改成 t2v', episode.id, shot.id, 'refs'))
      }
      for (const ref of shot.refs) {
        if (ref.state === 'ref' && ref.path.trim() === '') {
          findings.push(err('GEN-006', `参考槽 ${ref.slot} 标为 ref 但没有图片路径`, episode.id, shot.id, 'refs'))
        }
      }
      const refPaths = shot.refs.filter(ref => ref.state === 'ref').map(ref => ref.path.trim()).filter(Boolean)
      if (new Set(refPaths).size !== refPaths.length) {
        findings.push(err('GEN-006', '同一张参考图占了多个槽位；每张图只能有一个职责', episode.id, shot.id, 'refs'))
      }

      // GEN-016 造型 LOOK 绑定
      for (const [characterId, lookId] of Object.entries(shot.wardrobe)) {
        const character = project.characters.find(item => item.id === characterId)
        if (character === undefined) {
          findings.push(err('GEN-016', `造型绑定了不存在的角色 ${characterId}`, episode.id, shot.id, 'wardrobe'))
          continue
        }
        const look = character.looks.find(item => item.id === lookId)
        if (look === undefined) {
          findings.push(err('GEN-016', `${characterId} 没有造型 ${lookId}`, episode.id, shot.id, 'wardrobe'))
          continue
        }
        if (look.refs.main === '' && look.refs.front === '' && look.refs.side === '' && look.refs.back === '') {
          findings.push(warn('GEN-016', `${characterId} 的 ${lookId} 还没有参考图`, episode.id, shot.id, 'wardrobe'))
        }
      }

      // GEN-017 提示词过期
      if (shot.prompt.text.trim() !== '' && shot.prompt.version >= 1 && shot.prompt.inputHash !== '' && shot.prompt.inputHash !== shotInputHash(project, episode, shot)) {
        findings.push(warn('GEN-017', '提示词已过期：分镜/台词/LOOK/场景等输入在编译后改过；生成视频前会自动重编译', episode.id, shot.id, 'prompt'))
      }

      // GEN-007 锁面 / 造型逐字进入正文（旧版编译在生成视频前会自动重编译）
      if (shot.prompt.text.trim() !== '' && shot.prompt.version >= 1) {
        const ids = new Set<string>()
        for (const lock of shot.locks) {
          const match = /^LOCK-(C\d+)/i.exec(lock)
          if (match !== null) ids.add(match[1]!)
        }
        for (const line of shot.dialogue) if (line.speaker !== '') ids.add(line.speaker)
        for (const id of ids) {
          const character = project.characters.find(item => item.id === id)
          if (character === undefined) continue
          if (character.identityLock.trim() !== '' && !shot.prompt.text.includes(character.identityLock.trim())) {
            findings.push(err('GEN-007', `编译正文没有逐字包含 ${id} 的身份锁；同义改写会让模型认成另一个人`, episode.id, shot.id, 'prompt'))
          }
          const bound = shot.wardrobe[id]
          const look = (bound === undefined ? undefined : character.looks.find(item => item.id === bound))
            ?? character.looks.find(item => item.episodes.includes(episode.id))
            ?? character.looks[0]
          if (look !== undefined && look.text.trim() !== '' && !shot.prompt.text.includes(look.text.trim())) {
            findings.push(err('GEN-007', `编译正文没有逐字包含 ${id} 的造型 ${look.id}；换装描述会被模型忽略`, episode.id, shot.id, 'prompt'))
          }
        }
      }

      // GEN-008 时间戳连续（2.5）
      if (shot.prompt.dialect === 'seedance-2.5' && shot.prompt.text.trim() !== '') {
        const ranges = [...shot.prompt.text.matchAll(/\[0:(\d{2})[–-]0:(\d{2})\]/g)]
        if (ranges.length > 0) {
          let expected = 0
          let bad = false
          for (const range of ranges) {
            const start = Number(range[1])
            const end = Number(range[2])
            if (start !== expected || end <= start) bad = true
            expected = end
          }
          if (bad || expected !== shot.duration) {
            findings.push(err('GEN-008', `时间戳不连续或总和 ${expected}s ≠ 镜头时长 ${shot.duration}s`, episode.id, shot.id, 'prompt'))
          }
        } else {
          findings.push(err('GEN-008', 'Seedance 2.5 正文没有任何 [0:00–0:0X] 时间戳', episode.id, shot.id, 'prompt'))
        }
      }

      // GEN-009 H3 首尾帧与参考互斥（检查是否拆成两个段）
      if (shot.prompt.dialect === 'minimax-h3' && /first_frame/i.test(shot.prompt.text) && /reference_image|subject_definitions/i.test(shot.prompt.text)) {
        findings.push(err('GEN-009', 'H3 的首尾帧与参考输入互斥：起始帧应作为 reference_image 走 full-reference，不能拆成两段', episode.id, shot.id, 'prompt'))
      }

      // GEN-010 矛盾约束
      if (shot.prompt.text.trim() !== '') {
        for (const pair of CONTRADICTIONS) {
          if (pair.a.test(shot.prompt.text) && pair.b.test(shot.prompt.text)) {
            findings.push(warn('GEN-010', pair.message, episode.id, shot.id, 'prompt'))
          }
        }
      }

      // GEN-012 轴线/视线（启发式）
      if (/左/.test(shot.blocking) && /右/.test(shot.blocking) && /跳轴|越轴/.test(shot.camera)) {
        findings.push(warn('GEN-012', '站位含左右且运镜提到跳轴；请确认 180 度轴线', episode.id, shot.id, 'blocking'))
      }

      // GEN-014 首帧可动画性（有 first 参考时）
      if (shot.refs.some(ref => ref.role === 'first') && /转身|跑|跳|冲|打/.test(shot.action) && shot.prompt.text.trim() === '') {
        findings.push(info('GEN-014', '首帧只画动作开始前的清晰状态，不要把动作过程画进静态图', episode.id, shot.id, 'refs'))
      }

      // COST-001 单镜候选过多
      const candidates = project.jobs.filter(job => job.shotId === shot.id && job.kind === 'image').length
      if (candidates > 5) {
        findings.push(warn('COST-001', `单镜已有 ${candidates} 次图片任务，超过 5 次候选上限；建议时间盒后选最优`, episode.id, shot.id, 'jobs'))
      }

      // 时长区间
      if (shot.duration < 4 || shot.duration > 15) {
        findings.push(warn('GEN-005B', `镜头时长 ${shot.duration}s 不在 4–15s 区间`, episode.id, shot.id, 'duration'))
      }
    }

    if (episode.shots.length > 0) {
      const total = episode.shots.reduce((sum, shot) => sum + shot.duration, 0)
      if (Math.abs(total - targetSeconds) > 3) {
        findings.push(warn('GEN-005C', `分镜时长合计 ${total}s，与单集目标 ${targetSeconds}s 相差 ${Math.abs(total - targetSeconds)}s`, episode.id, undefined, 'shots'))
      }
    }
  }

  // GEN-015 方言核对日期提示
  if (project.meta.dialect === 'kling' || project.meta.dialect === 'wan-3.0') {
    findings.push(info('GEN-015', '当前方言为实验级：只保证写法模板，不保证协议级正确；请以官方当前文档为准'))
  }

  const errors = findings.filter(item => item.level === 'error').length
  const warns = findings.filter(item => item.level === 'warn').length
  return { findings, errors, warns, checkedAt: Date.now() }
}

export function episodeProgress(episode: Episode): { shots: number, compiled: number, approved: number } {
  return {
    shots: episode.shots.length,
    compiled: episode.shots.filter(shot => shot.prompt.text.trim() !== '').length,
    approved: episode.shots.filter(shot => shot.status === 'approved' || shot.status === 'generated').length,
  }
}
