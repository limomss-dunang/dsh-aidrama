/** 生成前置条件：前端用于提示/禁用，后端用于最终拦截，避免空项目直接烧模型。 */

import type { GenerateStage, Project } from './types.ts'

export function missingPrerequisites(project: Project, stage: GenerateStage, episodeId = ''): string[] {
  const missing: string[] = []
  if (stage === 'bible') {
    if (project.meta.logline.trim() === '' && project.meta.theme.trim() === '') missing.push('构想的一句话或主题')
    return missing
  }
  if (stage === 'characters') {
    if (project.bible.premise.trim() === '') missing.push('总纲的「故事前提」')
    return missing
  }
  if (stage === 'scenes') {
    if (project.bible.premise.trim() === '') missing.push('总纲的「故事前提」')
    return missing
  }
  if (stage === 'episode') {
    if (project.bible.premise.trim() === '') missing.push('总纲的「故事前提」')
    if (project.meta.logline.trim() === '') missing.push('构想的「一句话」')
    if (project.characters.length === 0) missing.push('至少一个角色')
    if (project.scenes.length === 0) missing.push('至少一个场景')
    return missing
  }
  if (stage === 'shots') {
    const episode = episodeId === ''
      ? project.episodes[0]
      : project.episodes.find(item => item.id === episodeId)
    if (episode === undefined) {
      missing.push('先新建一集')
      return missing
    }
    if (episode.script.trim() === '' && episode.beats.length === 0) missing.push('本集剧本或节拍')
    if (project.characters.length === 0) missing.push('至少一个角色')
    if (project.scenes.length === 0) missing.push('至少一个场景')
    return missing
  }
  return missing
}
