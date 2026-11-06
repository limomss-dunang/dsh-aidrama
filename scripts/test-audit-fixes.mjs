import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore, emptyProject, normalizeProject } from '../src/host/store.ts'
import { Generator } from '../src/host/generator.ts'
import { Importer, splitEpisodes } from '../src/host/importer.ts'
import { compileShot, compileShotInto, shotInputHash } from '../src/host/compiler.ts'
import { validateProject } from '../src/host/validator.ts'
import { balanceBeats } from '../src/host/estimator.ts'
import { mergeProject } from '../src/client/merge.ts'
import { castNamesFromText } from '../src/shared/script.ts'

const usage = { inputTokens: 1, outputTokens: 1 }

function base() {
  const raw = emptyProject('审计回归')
  raw.characters = [{
    id: 'C01', name: '甲', status: 'locked', identityLock: '固定身份',
    slots: { outfit: '蓝衣', face: '旧脸', hair: '旧发' },
    refs: { front: 'refs/old.png' },
    looks: [{ id: 'LOOK-02', text: '红衣', refs: { main: 'refs/look2.png' } }],
    voiceCard: { voiceSample: 'audio/old.wav' },
  }]
  raw.scenes = [{ id: 'S01', name: '房间', refImage: 'refs/scene.png' }]
  raw.episodes = [{
    id: 'EP001', title: '原第一集', script: '原第一集正文', targetSeconds: 45,
    beats: [{ id: 'B1', seconds: 45, text: '末尾事件' }],
    shots: [{
      id: 'SHOT-EP001-001', duration: 5, sceneId: 'S01', action: '旧分镜动作',
      dialogue: [{ speaker: 'C01', text: '别走' }], wardrobe: { C01: 'LOOK-02' },
      refs: [], videoPath: 'videos/old.mp4', status: 'generated',
    }],
  }]
  return normalizeProject(raw)
}

// 1. 重生成角色不得清掉媒体/音色/LOOK/锁定状态
{
  const project = base()
  project.characters[0].identityLock = ''
  const generator = new Generator({ chatJson: async () => ({ value: { characters: [{ id: 'C01', name: '甲', slots: { outfit: '新衣', face: '新脸', hair: '新发' } }] }, usage }) })
  const { project: result } = await generator.generate({ project, stage: 'characters', provider: 'mock', model: 'mock' })
  assert.equal(result.characters[0].refs.front, 'refs/old.png')
  assert.equal(result.characters[0].voiceCard.voiceSample, 'audio/old.wav')
  assert.equal(result.characters[0].looks.length, 1)
  assert.equal(result.characters[0].status, 'locked')
  assert.equal(result.characters[0].identityLock, '')
  assert.equal(result.characters[0].slots.face, '旧脸')
  console.log('PASS asset regeneration preserves media/looks/status')
}

// 2. 第十一集导入必须保留 EP001，并落到新的 EP011
{
  const project = base()
  const llm = { chatJson: async () => ({ value: { episodes: [{ id: 'EP011', title: '新第十一集', logline: '新冲突', beats: [{ id: 'B1', seconds: 90, text: '新节拍' }] }] }, usage }) }
  const importer = new Importer(llm, { generate: async () => { throw Error('unexpected') } })
  const result = await importer.preview(project, { text: '第十一集\n新第十一集正文' }, { parseProvider: 'mock', parseModel: 'mock', generationProvider: 'mock', generationModel: 'mock' })
  const ids = result.project.episodes.map(episode => episode.id)
  assert(ids.includes('EP001'))
  assert(ids.includes('EP011'))
  assert.equal(result.project.episodes.find(episode => episode.id === 'EP001').script, '原第一集正文')
  assert.equal(result.project.episodes.find(episode => episode.id === 'EP011').script, '新第十一集正文')
  console.log('PASS import EP011 does not overwrite EP001')
}

// 3. auto 45 秒不能再按 90 秒生成；120 秒要能排满
{
  const project = base()
  project.meta.durationMode = 'auto'
  project.meta.episodeSeconds = 90
  project.episodes[0].targetSeconds = 45
  const generator = new Generator({
    chatJson: async request => {
      const count = Number(/只输出 (\d+) 个镜头/.exec(request.user)?.[1] ?? 0)
      return { value: { shots: Array.from({ length: count }, () => ({ sceneId: 'S01', duration: 6, action: '站定' })) }, usage }
    },
  })
  const result = await generator.generate({ project, stage: 'shots', episodeId: 'EP001', provider: 'mock', model: 'mock' })
  const total = result.project.episodes[0].shots.reduce((sum, shot) => sum + shot.duration, 0)
  assert.equal(total, 45)
  project.meta.episodeSeconds = 120
  project.episodes[0].targetSeconds = 120
  const long = await generator.generate({ project, stage: 'shots', episodeId: 'EP001', provider: 'mock', model: 'mock' })
  const longTotal = long.project.episodes[0].shots.reduce((sum, shot) => sum + shot.duration, 0)
  assert.equal(longTotal, 120)
  project.episodes[0].targetSeconds = 18
  const short = await generator.generate({ project, stage: 'shots', episodeId: 'EP001', provider: 'mock', model: 'mock' })
  assert.equal(short.project.episodes[0].shots.reduce((sum, shot) => sum + shot.duration, 0), 18)
  assert(short.project.episodes[0].shots.every(shot => shot.duration >= 4 && shot.duration <= 15))
  project.episodes[0].targetSeconds = 15
  await assert.rejects(() => generator.generate({ project, stage: 'shots', episodeId: 'EP001', provider: 'mock', model: 'mock' }))
  console.log('PASS auto duration target 45/120/18 respected; 15s rejected')
}

// 4. H3 无参考图也必须保留身份/LOOK
{
  const project = base()
  const result = compileShot(project, project.episodes[0], project.episodes[0].shots[0], 'minimax-h3')
  assert(result.text.includes('固定身份'))
  assert(result.text.includes('红衣'))
  console.log('PASS H3 no-refs keeps identity and LOOK')
}

// 5. 空 ref 路径、2.5 无时间戳必须报错；编译后改动作要报 GEN-017
{
  const project = base()
  const episode = project.episodes[0]
  const shot = episode.shots[0]
  shot.prompt = { dialect: 'seedance-2.5', text: '完全没有时间戳', version: 1, compiledAt: 1, inputHash: '', warnings: [] }
  shot.refs = [{ slot: 'REF-1', state: 'ref', role: 'first', path: '', note: '' }]
  let findings = validateProject(project).findings
  assert(findings.some(finding => finding.ruleId === 'GEN-008'))
  assert(findings.some(finding => finding.ruleId === 'GEN-006'))
  compileShotInto(project, episode, shot, 'seedance-2.0')
  shot.action = '编译后改掉的动作'
  findings = validateProject(project).findings
  assert(findings.some(finding => finding.ruleId === 'GEN-017'))
  console.log('PASS validation catches empty ref, missing timestamps, stale prompt')
}

// 6. balanceBeats 不得超过目标
{
  const project = base()
  const episode = project.episodes[0]
  episode.beats = [{ id: 'B1', seconds: 1, text: '' }, { id: 'B2', seconds: 99, text: '' }]
  balanceBeats(episode, 15)
  assert.equal(episode.beats.reduce((sum, beat) => sum + beat.seconds, 0), 15)
  console.log('PASS beat balancer exact target')
}

// 6b. inputHash 必须覆盖角色名/场景名/项目名/集名；3 秒镜头归一为 4 秒
{
  const project = base()
  const episode = project.episodes[0]
  const shot = episode.shots[0]
  compileShotInto(project, episode, shot, 'seedance-2.0')
  const before = shot.prompt.inputHash
  project.characters[0].name = '乙'
  assert.notEqual(shotInputHash(project, episode, shot), before)
  project.scenes[0].name = '新房间'
  assert.notEqual(shotInputHash(project, episode, shot), before)
  project.title = '新剧名'
  assert.notEqual(shotInputHash(project, episode, shot), before)
  episode.title = '新集名'
  assert.notEqual(shotInputHash(project, episode, shot), before)
  const short = normalizeProject({ ...project, episodes: [{ id: 'EP009', shots: [{ id: 'SHOT-EP009-001', duration: 3 }] }] })
  assert.equal(short.episodes[0].shots[0].duration, 4)
  console.log('PASS input hash covers names; 3s normalizes to 4s')
}

// 7. Markdown # 第一集 / ## EP02 必须拆集
{
  const segments = splitEpisodes('# 第一集\n甲：我是甲。\n## EP02\n乙：我是乙。')
  assert.equal(segments.length, 2)
  console.log('PASS markdown headings split episodes')
}

// 8. 不指定 episodeId 的生成不能覆盖 EP001
{
  const project = base()
  const generator = new Generator({ chatJson: async () => ({ value: { episode: { id: 'EP001', title: '模型声称新建', script: '新剧本', beats: [{ id: 'B1', seconds: 45, text: '新节拍' }] } }, usage }) })
  const result = await generator.generate({ project, stage: 'episode', provider: 'mock', model: 'mock' })
  assert.equal(result.project.episodes.length, 2)
  assert.equal(result.project.episodes.find(episode => episode.id === 'EP001').script, '原第一集正文')
  assert.equal(result.project.episodes.find(episode => episode.id === 'EP002').script, '新剧本')
  console.log('PASS episode generation without id allocates EP002')
}

// 9. 三方合并：服务端媒体结果与本地无关编辑都要保留
{
  const baseProject = base()
  const server = structuredClone(baseProject)
  server.episodes[0].shots[0].videoPath = 'videos/new.mp4'
  server.jobs.push({
    id: 'job-merge', kind: 'video', shotId: 'SHOT-EP001-001', status: 'done',
    providerTaskId: 'task-merge', costCny: 0, startedAt: 1, endedAt: 2, note: 'videos/new.mp4',
  })
  const local = structuredClone(baseProject)
  local.title = '本地新标题'
  const merged = mergeProject(baseProject, server, local)
  assert.equal(merged.project.title, '本地新标题')
  assert.equal(merged.project.episodes[0].shots[0].videoPath, 'videos/new.mp4')
  assert(merged.project.jobs.some(job => job.id === 'job-merge'))
  assert.equal(merged.conflicts, 0)
  console.log('PASS three-way merge keeps server media and local edits')
}

// 10. junction 别名下的并发 save 必须共用同一把锁
{
  const baseDir = await mkdtemp(join(tmpdir(), 'dsh-aidrama-alias-'))
  const root = join(baseDir, 'projects')
  await mkdir(root)
  const storeA = new ProjectStore(() => baseDir, () => root)
  const created = await storeA.create({ title: 'alias' })
  const alias = join(baseDir, 'alias')
  let linked = false
  try {
    await symlink(root, alias, 'junction')
    linked = true
  } catch (error) {
    console.log(`SKIP junction alias (${error.message})`)
  }
  if (linked) {
    const storeB = new ProjectStore(() => baseDir, () => alias)
    const a = await storeA.read(created.id)
    const b = await storeB.read(created.id)
    a.title = 'a'
    b.title = 'b'
    const results = await Promise.allSettled([
      storeA.save(a, a.revision),
      storeB.save(b, b.revision),
    ])
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(results.filter(item => item.status === 'rejected').length, 1)
    console.log('PASS junction alias concurrent save shares CAS lock')
  }
}

// 9. 剧本人物/场景提取 + 角色名不得脱离剧本
{
  const script = '1-1 内 金銮殿 日人物:许青、江洛漓、赵王、老周\n△ 许青抬头。'
  assert.deepEqual(castNamesFromText(script).slice(0, 4), ['许青', '江洛漓', '赵王', '老周'])
  const project = base()
  project.episodes[0].script = script
  const generator = new Generator({
    chatJson: async request => request.label.includes('剧本事实解析')
      ? { value: { cast: [
        { name: '许青', gender: '男', role: '朝臣', roleEvidence: [], costume: '', evidence: '许青抬头' },
        { name: '江洛漓', gender: '女', role: '女帝', roleEvidence: [], costume: '', evidence: '许青抬头' },
        { name: '赵王', gender: '男', role: '皇叔', roleEvidence: [], costume: '', evidence: '许青抬头' },
        { name: '老周', gender: '男', role: '狱卒', roleEvidence: [], costume: '', evidence: '许青抬头' },
      ] }, usage }
      : { value: { characters: [{ id: 'C01', name: '萧明棠' }] }, usage },
  })
  await assert.rejects(() => generator.generate({ project, stage: 'characters', provider: 'mock', model: 'mock' }), /角色名必须来自剧本人物表/)
  console.log('PASS script cast extraction and character-name guard')
}

console.log('AUDIT FIX REGRESSION OK')
