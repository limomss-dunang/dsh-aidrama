/** 从剧本中确定性提取人物与场景名，供生成器约束资产、导入回退兜底。 */

import type { ScriptAnalysis, ScriptCastMember, ScriptEpisodeAnalysis } from './types.ts'

const GENERIC_CAST = new Set([
  '系统', '侍卫', '禁军', '朝臣', '狱卒', '刺客', '百官', '宫人', '太监', '士兵', '百姓', '众人', '群臣', '旧部', '死士',
])

export function castNamesFromText(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/人物\s*[:：]\s*([^\n△。！？；;]+)/g)) {
    for (const raw of match[1]!.split(/[、,，/／\s]+/)) {
      const name = raw.trim()
      if (name.length < 2 || name.length > 4) continue
      if (GENERIC_CAST.has(name)) continue
      if (/旧部|刺客|侍卫|禁军|朝臣|狱卒|系统|死士|老板/.test(name)) continue
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

export function locationNamesFromText(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/^\s*\d+\s*-\s*\d+\s+(?:内|外)\s+(.+?)\s+(?:日|夜)\s*(?:人物|$)/gm)) {
    const name = match[1]!.trim()
    if (name.length < 2) continue
    if (!names.includes(name)) names.push(name)
  }
  return names
}

export function castNames(scripts: string[]): string[] {
  return [...new Set(scripts.flatMap(script => castNamesFromText(script)))]
}

export function locationNames(scripts: string[]): string[] {
  return [...new Set(scripts.flatMap(script => locationNamesFromText(script)))]
}

const COSTUME_WORDS = /囚衣|禁军号衣|朝服|常服|旧袍|长袍|衣裳|衣摆|衣襟|披风|铠甲|龙袍|官服|短褐/

function evidenceLine(lines: string[], name: string): string {
  const castLine = lines.find(line => line.includes('人物') && line.includes(name))
  if (castLine !== undefined) return castLine.trim().slice(0, 160)
  const line = lines.find(item => item.includes(name))
  return line === undefined ? '' : line.trim().slice(0, 160)
}

function genderOf(text: string, name: string): '男' | '女' | '未知' {
  let femaleScore = 0
  let maleScore = 0
  let index = -1
  let checked = 0
  while ((index = text.indexOf(name, index + 1)) >= 0 && checked < 80) {
    checked += 1
    const window = text.slice(Math.max(0, index - 100), index + 180)
    femaleScore += (window.match(/女帝|娘娘|姑娘|夫人|小姐|女官|她/g) ?? []).length
    maleScore += (window.match(/公子|公子爷|少年|男子|皇叔|王爷|世子|差爷/g) ?? []).length * 2
    maleScore += (window.match(/他/g) ?? []).length
  }
  // “女帝/女官”等明确职称权重高于泛用“他”，避免把女帝判成男。
  femaleScore += (text.match(/女帝/g) ?? []).length > 0 && text.includes(name) ? 1 : 0
  if (femaleScore > maleScore && femaleScore > 0) return '女'
  if (maleScore > 0) return '男'
  return '未知'
}

/** 确定性“剧本理解”：只记录文字里能证明的人物/性别/服装/地点，不根据身份猜造型。 */
export function analyzeScript(episodes: Array<{ id: string, script: string }>): ScriptAnalysis {
  const result: ScriptEpisodeAnalysis[] = episodes.map(episode => {
    const lines = episode.script.split('\n')
    const cast: ScriptCastMember[] = castNamesFromText(episode.script).map(name => {
      const costumeLine = lines.find(line => line.includes(name) && COSTUME_WORDS.test(line))
      return {
        name,
        gender: genderOf(episode.script, name),
        role: '',
        roleEvidence: [],
        evidence: evidenceLine(lines, name),
        costume: costumeLine === undefined ? '' : (COSTUME_WORDS.exec(costumeLine)?.[0] ?? ''),
        costumeEvidence: costumeLine === undefined ? '' : costumeLine.trim().slice(0, 160),
      }
    })
    const locations = locationNamesFromText(episode.script).map(name => ({
      name,
      evidence: evidenceLine(lines, name),
    }))
    return { episodeId: episode.id, cast, locations }
  })
  return { episodes: result, accepted: false, generatedAt: Date.now() }
}
