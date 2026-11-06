/** 时长自动估算：有分镜用分镜实际时长；没有分镜用剧本字数粗估；再回填节拍。 */

import type { Episode } from '../shared/types.ts'

export function estimateEpisodeSeconds(episode: Episode): number {
  if (episode.shots.length > 0) {
    const total = episode.shots.reduce((sum, shot) => sum + Math.max(1, shot.duration), 0)
    return Math.max(15, Math.round(total))
  }
  const script = episode.script.replace(/\s+/g, '')
  if (script !== '') {
    // 中文剧本按 4.5 字/秒粗估，另加开场/转场余量。
    return Math.max(15, Math.min(1800, Math.round(script.length / 4.5 + 8)))
  }
  if (episode.beats.length > 0) {
    const total = episode.beats.reduce((sum, beat) => {
      const chars = beat.text.replace(/\s+/g, '').length
      return sum + Math.max(4, Math.min(25, chars / 5 + 4))
    }, 0)
    return Math.max(15, Math.round(total))
  }
  return 0
}

/** 把节拍秒数调到目标；已有秒数按比例缩放，全 0 则均分。 */
export function balanceBeats(episode: Episode, target: number): void {
  const beats = episode.beats
  if (beats.length === 0 || target <= 0) return
  const goal = Math.round(target)
  // 目标低于拍数时无法既保证每拍 ≥1 又不超时；只能全部 1 秒并在校验里显示超时。
  if (goal < beats.length) {
    for (const beat of beats) beat.seconds = 1
    return
  }
  const current = beats.reduce((sum, beat) => sum + Math.max(0, beat.seconds), 0)
  const weights = current <= 0 ? beats.map(() => 1) : beats.map(beat => Math.max(0, beat.seconds))
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const remaining = goal - beats.length
  const raw = weights.map(value => value * remaining / weightSum)
  const extra = raw.map(value => Math.floor(value))
  let leftover = remaining - extra.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - extra[index]! }))
    .sort((a, b) => b.fraction - a.fraction)
  for (let i = 0; i < order.length && leftover > 0; i += 1) {
    extra[order[i]!.index] = (extra[order[i]!.index] ?? 0) + 1
    leftover -= 1
  }
  beats.forEach((beat, index) => {
    beat.seconds = 1 + (extra[index] ?? 0)
  })
}
