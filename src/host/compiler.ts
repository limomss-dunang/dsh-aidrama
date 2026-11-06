/**
 * 提示词编译器：结构化镜头 → 目标模型方言的可复制正文。
 *
 * 原则（来自调研）：
 * - 先选模型，再只读该方言，不要把相近模型的语法硬套；
 * - 素材要分配唯一职责，编号按实际挂载顺序；
 * - 锁面必须逐字进入正文；
 * - 编辑/延长直接点名视频，不写成「参考」；
 * - H3 首尾帧与 reference 互斥，无配乐写 N/A；
 * - 时间戳连续、不重叠、总和等于时长。
 */

import { createHash } from 'node:crypto'
import type { Character, DialectId, Episode, Look, Project, Shot } from '../shared/types.ts'
import { asString } from './util.ts'

export interface CompileOutcome {
  text: string
  warnings: string[]
}

const SIZE_ZH: Record<string, string> = {
  'extreme-close': '大特写',
  close: '近景',
  medium: '中景',
  wide: '全景',
  establishing: '远景/建立镜头',
}

const SIZE_EN: Record<string, string> = {
  'extreme-close': 'extreme close-up',
  close: 'close-up',
  medium: 'medium shot',
  wide: 'wide shot',
  establishing: 'establishing shot',
}

const ROLE_EN: Record<string, string> = {
  identity: 'identity',
  look: 'styling state',
  geo: 'geography',
  composition: 'composition',
  scale: 'scale reference',
  effect: 'effect',
  first: 'start frame',
  last: 'end frame',
  style: 'style',
}

function characterName(project: Project, id: string): string {
  return project.characters.find(item => item.id === id)?.name || id
}

function sceneName(project: Project, id: string): string {
  const scene = project.scenes.find(item => item.id === id)
  return scene === undefined ? id : `${scene.id} ${scene.name}`
}

function defaultLook(character: Character): Look {
  const outfit = [character.slots.outfit, character.slots.accessories].filter(item => item.trim() !== '').join('；')
  return {
    id: 'LOOK-01',
    text: outfit || character.slots.outfit,
    episodes: [],
    refs: { front: '', side: '', back: '', main: '' },
    refPrompts: { front: '', side: '', back: '', sheet: '' },
  }
}

function lookForShot(character: Character, shot: Shot, episodeId: string): Look {
  const looks = character.looks.length > 0 ? character.looks : [defaultLook(character)]
  const bound = shot.wardrobe[character.id]
  if (bound !== undefined) {
    const found = looks.find(look => look.id === bound)
    if (found !== undefined) return found
  }
  return looks.find(look => look.episodes.includes(episodeId)) ?? looks[0]!
}

function identityText(character: Character): string {
  if (character.identityLock.trim() !== '') return character.identityLock.trim()
  const parts = [
    character.slots.ageGender,
    character.slots.face,
    character.slots.hair,
    character.slots.body,
    character.slots.temperament,
    character.slots.forbidden,
    character.slots.lightBaseline,
  ].filter(item => item.trim() !== '')
  if (parts.length > 0) return parts.join('；')
  return character.lockText.trim()
}

function effectiveLock(character: Character, shot: Shot, episodeId: string): string {
  const look = lookForShot(character, shot, episodeId)
  const identity = identityText(character)
  const costume = look.text.trim() === '' ? '' : `造型（${look.id}）：${look.text.trim()}`
  return [identity, costume].filter(item => item !== '').join('；')
}

/** 供图片/视频等非编译链路复用同一套身份 + LOOK 解析。 */
export function effectiveCharacterText(project: Project, episode: Episode, shot: Shot, characterId: string): string {
  const character = project.characters.find(item => item.id === characterId)
  return character === undefined ? '' : effectiveLock(character, shot, episode.id)
}

/** 编译输入指纹：任一上游字段变化都应让旧提示词失效。 */
export function shotInputHash(project: Project, episode: Episode, shot: Shot): string {
  const ids = new Set<string>()
  for (const lock of shot.locks) {
    const match = /^LOCK-(C\d+)/i.exec(lock)
    if (match !== null) ids.add(match[1]!)
  }
  for (const line of shot.dialogue) if (line.speaker !== '') ids.add(line.speaker)
  const characters = [...ids].map(id => {
    const character = project.characters.find(item => item.id === id)
    if (character === undefined) return { id, missing: true }
    const look = lookForShot(character, shot, episode.id)
    return {
      id,
      name: character.name,
      identity: identityText(character),
      look: look.id,
      lookText: look.text,
      voice: character.voiceCard.voiceId,
    }
  })
  const scene = project.scenes.find(item => item.id === shot.sceneId)
  const payload = {
    projectTitle: project.title,
    episodeId: episode.id,
    episodeTitle: episode.title,
    sceneId: shot.sceneId,
    scene: scene === undefined ? undefined : { name: scene.name, space: scene.space, palette: scene.palette, keyLight: scene.keyLight },
    duration: shot.duration,
    size: shot.size,
    camera: shot.camera,
    blocking: shot.blocking,
    action: shot.action,
    endState: shot.endState,
    emotion: shot.emotion,
    dialogue: shot.dialogue,
    sound: shot.sound,
    refs: shot.refs,
    locks: shot.locks,
    wardrobe: shot.wardrobe,
    characters,
    styles: project.styles,
    dialect: project.meta.dialect,
    orientation: project.meta.orientation,
  }
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex')
}

function locksOf(project: Project, shot: Shot, episode: Episode): string[] {
  const ids: string[] = []
  for (const lockId of shot.locks) {
    const match = /^LOCK-(C\d+)/i.exec(lockId)
    if (match !== null) ids.push(match[1]!)
  }
  for (const line of shot.dialogue) if (line.speaker !== '') ids.push(line.speaker)
  const out: string[] = []
  for (const id of [...new Set(ids)]) {
    const character = project.characters.find(item => item.id === id)
    if (character === undefined) continue
    const text = effectiveLock(character, shot, episode.id)
    if (text.trim() !== '' && !out.includes(text)) out.push(text)
  }
  return out
}

function refsOf(shot: Shot): Array<{ label: string, role: string, state: string }> {
  return shot.refs.map((ref, index) => {
    const label = ref.state === 'ref' && ref.path.trim() !== ''
      ? `${ref.slot || `REF-${index + 1}`}（${ref.path}）`
      : `${ref.slot || `PLAN-${index + 1}`}（${ref.note || '待挂图'}）`
    return { label, role: ref.role, state: ref.state }
  })
}

function actionLine(shot: Shot): string {
  const parts = [
    shot.action.trim() !== '' ? shot.action.trim() : '',
    shot.blocking.trim() !== '' ? `站位：${shot.blocking.trim()}` : '',
    shot.endState.trim() !== '' ? `终点：${shot.endState.trim()}` : '',
  ].filter(Boolean)
  return parts.join('；')
}

function dialogueZh(shot: Shot, project: Project): string {
  return shot.dialogue
    .filter(line => line.text.trim() !== '')
    .map(line => `${characterName(project, line.speaker)}${line.voiceOver ? '（画外）' : line.offScreen ? '（画外音）' : ''}：“${line.text.trim()}”`)
    .join(' ')
}

function soundLine(shot: Shot): string {
  const parts = [
    shot.sound.ambience.trim() === '' ? '' : `环境声：${shot.sound.ambience.trim()}`,
    shot.sound.sfx.trim() === '' ? '' : `音效：${shot.sound.sfx.trim()}`,
    shot.sound.music.trim() === '' ? '' : `音乐：${shot.sound.music.trim()}`,
  ].filter(Boolean)
  return parts.join('；')
}

function continuityLock(locks: string[]): string {
  return locks.length === 0 ? '' : `连续性锁（逐字保持）：${locks.join(' / ')}`
}

function negativeLine(): string {
  return '不要生成水印、Logo、字幕或任何画面文字；人物面部与身体比例稳定不变形；动作连贯自然，无穿模、无卡顿、无闪烁。'
}

export function compileShot(project: Project, episode: Episode, shot: Shot, dialect: DialectId): CompileOutcome {
  const warnings: string[] = []
  const locks = locksOf(project, shot, episode)
  const refs = refsOf(shot)
  const missing = shot.refs.filter(ref => ref.state === 'missing')
  if (missing.length > 0) warnings.push(`有 ${missing.length} 个参考槽位处于「待补」，投产前必须补图或改成 t2v`)
  if (shot.action.trim() === '') warnings.push('缺少唯一主动作（action）')
  if (shot.dialogue.some(line => line.text.length > 20)) warnings.push('有台词超过 20 字，口型镜建议 ≤15 字')
  if (locks.length === 0 && shot.dialogue.length > 0) warnings.push('有台词但没有可用的角色锁面，一致性只能靠参考图')
  const dialogueSeconds = shot.dialogue.reduce((sum, line) => sum + line.text.length / 3.8, 0)
  if (dialogueSeconds > Math.max(0.5, shot.duration - 0.5)) {
    warnings.push(`台词容量约 ${dialogueSeconds.toFixed(1)}s，超过镜头时长 ${shot.duration}s（按 3.8 字/秒估算）`)
  }
  if (!refs.every(ref => ref.state === 'ref' || ref.state === 'plan' || ref.state === 't2v')) {
    warnings.push('参考图四态不完整：请把每个槽位设为 ref / plan / missing / t2v 之一')
  }

  const scene = sceneName(project, shot.sceneId)
  const size = SIZE_ZH[shot.size] ?? shot.size
  const action = actionLine(shot)
  const sound = soundLine(shot)
  const lockLine = continuityLock(locks)

  switch (dialect) {
    case 'generic':
      return {
        warnings,
        text: [
          `${project.meta.orientation === 'portrait' ? '9:16 竖屏' : '16:9 横屏'}，${shot.duration} 秒，${size}，${scene}。`,
          `画面：${action}`,
          shot.emotion.start.trim() === '' ? '' : `表演：从「${shot.emotion.start}」开始，${shot.emotion.trigger || '被事件触发'}，到「${shot.emotion.end}」结束。`,
          dialogueZh(shot, project) === '' ? '' : `对白：${dialogueZh(shot, project)}`,
          sound === '' ? '' : `声音：${sound}`,
          shot.camera.trim() === '' ? '' : `运镜：${shot.camera}`,
          lockLine,
          refs.length === 0 ? '' : `参考：${refs.map(ref => `${ref.label}（用途：${ROLE_EN[ref.role] ?? ref.role}）`).join('；')}`,
          negativeLine(),
        ].filter(Boolean).join('\n'),
      }

    case 'seedance-2.0': {
      const orientation = project.meta.orientation === 'landscape' ? '横屏' : '竖屏'
      const materialLine = refs.length === 0
        ? ''
        : `参考 ${refs.map((ref, i) => `@图片${i + 1}（${ROLE_EN[ref.role] ?? ref.role}：${ref.label}）`).join('、')}，生成${shot.duration}秒${orientation}短剧。`
      const dialogue = dialogueZh(shot, project)
      return {
        warnings,
        text: [
          materialLine,
          `镜头 1：${size}，${shot.camera || '固定机位'}，${action}${dialogue === '' ? '' : `；对白：${dialogue}`}`,
          lockLine,
          sound === '' ? '' : `声音：${sound}`,
          negativeLine(),
        ].filter(Boolean).join('\n'),
      }
    }

    case 'seedance-2.5': {
      const materialLine = refs.length === 0
        ? ''
        : `参考 ${refs.map((ref, i) => `@图片${i + 1} 的${ROLE_EN[ref.role] ?? ref.role}`).join('、')}，保持素材职责与编号顺序。`
      const end = `0:${String(Math.max(1, shot.duration)).padStart(2, '0')}`
      return {
        warnings,
        text: [
          materialLine,
          `镜头 1 [0:00–${end}]：${size}，${shot.camera || '固定机位'}。${action}`,
          shot.emotion.start.trim() === '' ? '' : `表演：从「${shot.emotion.start}」到「${shot.emotion.end}」。`,
          dialogueZh(shot, project) === '' ? '' : `对白：${dialogueZh(shot, project)}`,
          sound === '' ? '' : `<声音>${sound}</声音>`,
          lockLine,
          '任务类型：reference（素材仅作参考，不做编辑或延长）。',
          '全程无字幕、无对白文字叠加。' + negativeLine(),
        ].filter(Boolean).join('\n'),
      }
    }

    case 'minimax-h3': {
      const pictures = shot.refs.filter(ref => ref.state === 'ref' || ref.state === 'plan')
      const hasRefs = pictures.length > 0
      const subjectDefs = project.characters
        .filter(character => shot.dialogue.some(line => line.speaker === character.id) || shot.locks.some(lock => lock.includes(character.id)))
        .map((character, i) => `S${i + 1} = ${character.name}`)
        .join('; ')
      const shotLine = `[Shot 1] ${SIZE_EN[shot.size] ?? shot.size}, ${shot.camera || 'locked camera'}. ${action}. ${
        shot.dialogue.map(line => `<d>[Chinese] ${line.text.trim()}</d>`).join(' ')
      }`
      if (!hasRefs) {
        return {
          warnings,
          text: [
            `integrated_multimodal_description: ${shotLine}${shot.blocking === '' ? '' : ` Blocking: ${shot.blocking}.`}`,
            lockLine === '' ? '' : `continuity_lock: ${locks.join(' / ')}`,
            `overall_soundscape: ${[shot.sound.ambience, shot.sound.sfx].filter(Boolean).join('; ') || 'room tone only'}`,
            `non_diegetic_music: ${shot.sound.music.trim() === '' ? 'N/A' : shot.sound.music.trim()}`,
          ].filter(Boolean).join('\n'),
        }
      }
      return {
        warnings,
        text: [
          `subject_definitions: ${subjectDefs || 'subjects follow the reference pictures'}`,
          `summary: ${project.title} · ${episode.title}；${scene}；${shot.duration}s single shot.`,
          `retention_analysis: ${pictures.map((ref, i) => `<Picture ${i + 1}> preserves ${ROLE_EN[ref.role] ?? ref.role}`).join('; ')}.`,
          `detailed_description: ${shotLine}${lockLine === '' ? '' : ` Continuity lock (verbatim): ${locks.join(' / ')}.`}`,
          `overall_soundscape: ${[shot.sound.ambience, shot.sound.sfx].filter(Boolean).join('; ') || 'room tone only'}`,
          `non_diegetic_music: ${shot.sound.music.trim() === '' ? 'N/A' : shot.sound.music.trim()}`,
        ].filter(Boolean).join('\n'),
      }
    }

    case 'kling': {
      const refLine = refs.length === 0 ? '' : `参考图 1 为${refs[0]?.label ?? '主体'}${refs[1] === undefined ? '' : `，参考图 2 为${refs[1].label}`}。`
      return {
        warnings: [...warnings, 'Kling 仅提供写法级模板，未做协议级核对；参数以官方当前文档为准'],
        text: [
          refLine,
          `${size}，在${scene}中，${action}。`,
          shot.dialogue.length === 0 ? '' : `对白：${dialogueZh(shot, project)}`,
          lockLine,
          '保持角色脸部、服装、身高比例，保持场景结构和道具外观。',
          negativeLine(),
        ].filter(Boolean).join('\n'),
      }
    }

    case 'wan-3.0': {
      return {
        warnings: [...warnings, 'Wan 3.0 仅提供写法级模板，未做协议级核对；参数以官方当前文档为准'],
        text: [
          `(0:00 - 0:${String(Math.max(1, shot.duration)).padStart(2, '0')}) 镜头1，${size}：${action}。`,
          shot.dialogue.length === 0 ? '' : `说道：“${shot.dialogue.map(line => line.text.trim()).join(' ')}”。`,
          lockLine,
          sound === '' ? '无背景音乐。' : `声音：${sound}；无背景音乐。`,
          negativeLine(),
        ].filter(Boolean).join('\n'),
      }
    }
  }
}

/** 编译一集（或一镜），把结果写回 shot.prompt。 */
export function compileShotInto(project: Project, episode: Episode, shot: Shot, dialect: DialectId): CompileOutcome {
  const outcome = compileShot(project, episode, shot, dialect)
  const primary = project.styles[0]
  const style = primary === undefined
    ? project.bible.visualDirection.trim()
    : [primary.medium, primary.prompt, primary.palette, primary.lighting, primary.lens, primary.texture]
        .map(item => (item ?? '').trim()).filter(item => item !== '').join('；')
  const avoid = project.styles.flatMap(item => item.avoid).map(item => item.trim()).filter(item => item !== '')
  if (primary?.status !== 'accepted') outcome.warnings.push('风格锚未锁定（accepted）：当前只能预览，不能进入批量生图/生视频')
  if (style !== '') {
    const scene = project.scenes.find(item => item.id === shot.sceneId)
    const sceneColor = scene === undefined
      ? ''
      : `【L5 本镜色调】${scene.palette}${scene.keyLight === '' ? '' : `；主光：${scene.keyLight}`}`
    outcome.text = [
      `【L1 全局风格锚（所有镜头必须保持）】${style}`,
      sceneColor,
      outcome.text,
      avoid.length === 0 ? '' : `【风格禁用】${[...new Set(avoid)].join('、')}`,
    ].filter(item => item !== '').join('\n\n')
  } else {
    outcome.warnings.push('没有设置全局风格锚：图像/视频会各生成各的风格')
  }
  shot.prompt = {
    dialect,
    text: outcome.text,
    compiledAt: Date.now(),
    version: 1,
    inputHash: shotInputHash(project, episode, shot),
    warnings: outcome.warnings,
  }
  shot.status = shot.status === 'approved' || shot.status === 'generated' ? shot.status : 'compiled'
  return outcome
}

export function lockSummary(character: Character): string {
  return character.lockText.trim() === '' ? asString(character.name) : character.lockText
}
