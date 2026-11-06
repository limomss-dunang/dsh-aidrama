/**
 * 导出：把结构化项目投影成人可读、可交接的 Markdown/JSON 快照。
 *
 * 注意：导出是「皮」，不是唯一真相。导入不反向解析 Markdown（避免两套真相打架）；
 * 需要外部 skill（如 drama-skills）接手时，直接交付这些文件即可。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Episode, Project } from '../shared/types.ts'
import { renderLockText } from './generator.ts'

export interface ExportResult {
  dir: string
  files: string[]
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

async function writeFileSafe(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => {})
  await writeFile(path, `${content.trim()}\n`, 'utf8')
}

function shotMarkdown(episode: Episode, shot: Episode['shots'][number], project: Project): string {
  const scene = project.scenes.find(item => item.id === shot.sceneId)
  const refs = shot.refs.length === 0
    ? '无'
    : shot.refs.map(ref => `${ref.slot}（${ref.state}，${ref.role}）${ref.path || ref.note}`).join('；')
  const dialogue = shot.dialogue.length === 0
    ? '无'
    : shot.dialogue.map(line => `${line.speaker}${line.voiceOver ? '[VO]' : line.offScreen ? '[OS]' : ''}：${line.text}`).join('；')
  return `### ${shot.id} · ${shot.duration}s
- 场景：${scene?.id ?? shot.sceneId} ${scene?.name ?? ''}
- 景别/运镜：${shot.size}；${shot.camera}
- 站位：${shot.blocking}
- 唯一动作：${shot.action}
- 终点：${shot.endState}
- 情绪：${shot.emotion.start} → ${shot.emotion.trigger} → ${shot.emotion.end}
- 台词：${dialogue}
- 声音：${[shot.sound.ambience, shot.sound.sfx, shot.sound.music].filter(Boolean).join(' / ') || '无'}
- 参考：${refs}
- 锁：${shot.locks.join('、') || '无'}
- 状态：${shot.status}
${shot.prompt.text.trim() === '' ? '' : `\n#### 可复制提示词（${shot.prompt.dialect || '未编译'}）\n\n\`\`\`text\n${shot.prompt.text}\n\`\`\`\n`}`
}

function episodeScript(project: Project, episode: Episode): string {
  return `# ${episode.id} ${episode.title}

> 项目：${project.title}
> 单集目标：${episode.targetSeconds > 0 ? episode.targetSeconds : project.meta.episodeSeconds}s｜状态：${episode.status}

## 一句话
${episode.logline || '（待补）'}

## 节拍表
| ID | 功能 | 秒 | 内容 |
|---|---|---|---|
${episode.beats.map(beat => `| ${beat.id} | ${beat.function} | ${beat.seconds} | ${beat.text.replace(/\|/g, '/')} |`).join('\n')}

## 剧本
${episode.script || '（待补）'}
`
}

function visualSetting(project: Project): string {
  const characters = project.characters.map(character => `### ${character.id} ${character.name}（${character.status}）
- 锁面：\`${renderLockText(character) || '（待补）'}\`
- 造型：${character.looks.map(look => `${look.id} ${look.text}`).join('；') || '无'}
- 状态链：${character.stateVariants.map(variant => `${variant.id} ${variant.change}（起于 ${variant.fromShot}）`).join('；') || '无'}
- 参考：${Object.entries(character.refs).filter(([, value]) => value !== '').map(([key, value]) => `${key}=${value}`).join('；') || '无'}
- 音色：${[character.voiceCard.voiceId, character.voiceCard.ageRange, character.voiceCard.baseline].filter(Boolean).join(' / ') || '无'}`).join('\n\n')
  const scenes = project.scenes.map(scene => `### ${scene.id} ${scene.name}
- 空间：${scene.space}
- 固定道具：${scene.props}
- 色调：${scene.palette}｜主光：${scene.keyLight}
- 变体：${scene.variants.map(variant => `${variant.id} ${variant.change}`).join('；') || '无'}`).join('\n\n')
  const props = project.props.map(prop => `### ${prop.id} ${prop.name}
- 功能：${prop.function}
- 外观：${prop.appearance}
- 持有：${prop.owner || '待定'}｜结束位置：${prop.endPosition || '待定'}`).join('\n\n')
  return `# 视觉设定

## 角色
${characters || '（待补）'}

## 场景
${scenes || '（待补）'}

## 道具
${props || '（待补）'}
`
}

export async function exportProject(project: Project, dir: string): Promise<ExportResult> {
  const files: string[] = []
  const write = async (relative: string, content: string): Promise<void> => {
    const target = join(dir, relative)
    await writeFileSafe(target, content)
    files.push(relative.replace(/\\/g, '/'))
  }

  await write('project.json', JSON.stringify(project, null, 2))
  await write('00-总纲.md', `# ${project.title}

> 平台：${project.meta.platform}｜画幅：${project.meta.orientation}｜题材：${project.meta.genre}｜单集 ${project.meta.episodeSeconds}s｜目标 ${project.meta.targetEpisodes} 集

## 一句话
${project.meta.logline || '（待补）'}

## 主题 / 钩子
- 主题：${project.meta.theme || '（待补）'}
- 开场钩子：${project.meta.hook || '（待补）'}
- 禁区：${project.meta.forbidden.join('、') || '无'}

## 总纲
- 前提：${project.bible.premise || '（待补）'}
- 世界：${project.bible.world || '（待补）'}
- 三幕：${project.bible.arc || '（待补）'}
- 分集：${project.bible.episodePlan || '（待补）'}
- 视觉方向：${project.bible.visualDirection || '（待补）'}
`)
  await write('10-视觉设定.md', visualSetting(project))

  for (const episode of project.episodes) {
    const folder = `剧集/${safeName(episode.id)}`
    await write(`${folder}/剧本.md`, episodeScript(project, episode))
    await write(`${folder}/分镜.md`, `# ${episode.id} 分镜

${episode.shots.map(shot => shotMarkdown(episode, shot, project)).join('\n\n') || '（待补）'}
`)
    await write(`${folder}/提示词.md`, `# ${episode.id} 视频提示词

> 方言：${project.meta.dialect}｜共 ${episode.shots.length} 镜｜已编译 ${episode.shots.filter(shot => shot.prompt.text.trim() !== '').length} 镜

${episode.shots.map(shot => `## MOTION-${shot.id.replace(/^SHOT-/, '')} · ${shot.duration}s

\`\`\`text
${shot.prompt.text || '（未编译：请在短剧工坊选择方言后编译）'}
\`\`\`
`).join('\n')}
`)
  }

  await write('90-生产台账.md', `# 生产台账

> 记录口径：本文件由短剧工坊导出，金额为记录值，最终以供应商后台账单为准。

## 任务
| 时间 | 类型 | 镜头 | 状态 | 上游任务 | 记录成本 |
|---|---|---|---|---|---|
${project.jobs.map(job => `| ${new Date(job.startedAt || Date.now()).toLocaleString('zh-CN')} | ${job.kind} | ${job.shotId} | ${job.status} | ${job.providerTaskId} | ¥${job.costCny.toFixed(2)} |`).join('\n') || '| - | - | - | - | - | - |'}

## 流水
| 时间 | 镜头 | 事件 | 详情 | 成本 |
|---|---|---|---|---|
${project.ledger.map(entry => `| ${new Date(entry.at).toLocaleString('zh-CN')} | ${entry.shotId} | ${entry.event} | ${entry.detail} | ¥${entry.costCny.toFixed(2)} |`).join('\n') || '| - | - | - | - | - |'}
`)

  return { dir, files }
}
