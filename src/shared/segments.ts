import type { Shot, Segment } from './types.ts'

/**
 * 把镜头按视频任务分组：一个片段 2–3 个子镜、总时长不超过 15 秒。
 * 分镜仍然保留独立 Shot；片段只是生成/合成单位。
 */
export function groupShotsIntoSegments(shots: Shot[], episodeId: string): Segment[] {
  const groups: Shot[][] = []
  let current: Shot[] = []
  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  for (const shot of shots) {
    const nextDuration = current.reduce((sum, item) => sum + item.duration, 0) + shot.duration
    if (current.length >= 3 || nextDuration > 15) flush()
    current.push(shot)
  }
  flush()
  // 避免末尾只剩一个、上一组却能挪出一个的孤镜。
  if (groups.length > 1 && groups[groups.length - 1].length === 1 && groups[groups.length - 2].length > 2) {
    const last = groups[groups.length - 1]
    const donor = groups[groups.length - 2]
    last.unshift(donor.pop() as Shot)
  }
  return groups.map((group, index) => {
    const sceneId = group[0]?.sceneId ?? ''
    const cast = [...new Set(group.flatMap(shot => Object.keys(shot.wardrobe ?? {})))]
    return {
      id: `SEG-${episodeId}-${String(index + 1).padStart(3, '0')}`,
      title: group.map(shot => shot.action).filter(Boolean).join(' / ').slice(0, 80) || `片段 ${String(index + 1).padStart(2, '0')}`,
      shotIds: group.map(shot => shot.id),
      duration: group.reduce((sum, shot) => sum + shot.duration, 0),
      sceneId,
      cast,
      status: group.every(shot => shot.status === 'generated') ? 'generated' : group.some(shot => shot.status === 'compiled' || shot.status === 'approved') ? 'prompted' : 'ready',
      videoPath: group.find(shot => shot.videoPath !== '')?.videoPath ?? '',
      prompt: group[0]?.prompt ?? { dialect: '', text: '', compiledAt: 0, version: 0, inputHash: '', warnings: [] },
    }
  })
}
