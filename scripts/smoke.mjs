/**
 * 端到端冒烟：通过本机桥接路由跑一遍「建项目 → 存结构 → 编译 → 校验 → 导出 → 删除」。
 * 不调用模型，只验证确定性链路与文件落盘。
 *
 * 用法：node scripts/smoke.mjs <sessionId>
 *   可选环境变量 DSH_WEB_URL（默认 http://127.0.0.1:51469）
 */
const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:51469'
const sessionId = process.argv[2]
if (sessionId === undefined) {
  console.error('用法：node scripts/smoke.mjs <sessionId>')
  process.exit(2)
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`)
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}

const slots = {
  ageGender: '32 岁男', face: '方脸、单眼皮、左眉有旧疤', hair: '黑色短寸', body: '178cm、偏瘦',
  outfit: '深蓝工装夹克、灰色工装裤', accessories: '银色手表', temperament: '克制、疲惫',
  forbidden: '不许换发色、不许加眼镜', lightBaseline: '3200K 暖光',
}
const lockText = [
  `年龄性别：${slots.ageGender}`, `脸型五官：${slots.face}`, `发型发色：${slots.hair}`, `体型身高：${slots.body}`,
  `服装：${slots.outfit}`, `配饰：${slots.accessories}`, `气质：${slots.temperament}`, `禁改：${slots.forbidden}`,
  `光线基准：${slots.lightBaseline}`,
].join('；')

const session = await post('/api/dsh-aidrama/session', { sessionId })
console.log('session cwd =', session.cwd)
const created = await post('/api/dsh-aidrama/projects', { cwd: session.cwd, sessionId, title: 'Smoke 测试' })
const project = created.project
project.meta.logline = '外卖员被羞辱后亮出董事身份'
project.meta.episodeSeconds = 15
project.meta.targetEpisodes = 1
project.characters = [{
  id: 'C01', name: '陈默', role: '主角', status: 'locked', slots, lockText,
  looks: [{ id: 'LOOK-01', text: '深蓝工装夹克', episodes: ['EP001'] }],
  stateVariants: [], refs: { front: '', side: '', back: '', expression: '', main: '' },
  voiceCard: { voiceId: '', ageRange: '', rate: '', baseline: '', forbidden: '' },
}]
project.scenes = [{ id: 'S01', name: '高级餐厅', space: '大厅、靠窗卡座、入口在左', props: '餐桌、餐盘', palette: '冷金与深红', keyLight: '顶部暖射灯', variants: [] }]
project.props = [{ id: 'P01', name: '黑色工牌', function: 'identity', appearance: '磨砂黑卡、银边', owner: 'C01', endPosition: '桌上' }]
project.episodes = [{
  id: 'EP001', title: '第一集', logline: '被羞辱后亮身份', status: 'boarded',
  beats: [
    { id: 'B1', function: 'hook', seconds: 2, text: '经理把餐盘推回他面前' },
    { id: 'B2', function: 'goal', seconds: 3, text: '他要一个道歉' },
    { id: 'B3', function: 'obstacle', seconds: 4, text: '经理叫保安' },
    { id: 'B4', function: 'cliff', seconds: 6, text: '他亮出工牌' },
  ],
  script: '【场景】高级餐厅 夜\n经理把餐盘推回。陈默抬头。',
  shots: [
    {
      id: 'SHOT-EP001-001', sceneId: 'S01', duration: 7, size: 'medium', camera: '缓推',
      blocking: '陈默 A 左，经理 B 右，陈默看右', action: '经理把餐盘推回桌沿，陈默抬头看向他',
      endState: '餐盘停在桌沿，陈默抬眼', emotion: { start: '疲惫', trigger: '被推回餐盘', end: '克制' },
      dialogue: [{ speaker: 'C01', text: '我只是想讨个说法', offScreen: false, voiceOver: false }],
      sound: { ambience: '餐厅低声交谈', sfx: '瓷盘碰桌', music: '低频弦乐' },
      refs: [{ slot: 'REF-1', state: 'plan', role: 'identity', path: '', note: 'C01 定妆' }],
      locks: ['LOCK-C01-LOCK'], status: 'draft', prompt: { dialect: '', text: '', compiledAt: 0, warnings: [] },
    },
    {
      id: 'SHOT-EP001-002', sceneId: 'S01', duration: 8, size: 'close', camera: '固定机位',
      blocking: '陈默居中，经理虚化在后景', action: '陈默把黑色工牌放到桌上，抬眼',
      endState: '工牌停在桌面，经理表情僵住', emotion: { start: '克制', trigger: '经理叫保安', end: '冷静' },
      dialogue: [{ speaker: 'C01', text: '现在，叫你们董事来', offScreen: false, voiceOver: false }],
      sound: { ambience: '餐厅安静下来', sfx: '工牌落桌', music: '弦乐收束' },
      refs: [], locks: ['LOCK-C01-LOCK'], status: 'draft', prompt: { dialect: '', text: '', compiledAt: 0, warnings: [] },
    },
  ],
}]

const saved = await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'save', project, expectedRevision: project.revision })
console.log('saved revision =', saved.project.revision)
const compiled = await post('/api/dsh-aidrama/compile', {
  cwd: session.cwd, projectId: saved.project.id, episodeId: 'EP001', dialect: 'seedance-2.5', expectedRevision: saved.project.revision,
})
console.log('compiled =', compiled.compiled)
console.log('shot1 prompt:\n' + compiled.project.episodes[0].shots[0].prompt.text)
const validation = await post('/api/dsh-aidrama/validate', { cwd: session.cwd, projectId: saved.project.id, episodeId: 'EP001' })
console.log('validation =', validation.validation.errors, 'error /', validation.validation.warns, 'warn')
for (const finding of validation.validation.findings) console.log(`  [${finding.level}] ${finding.ruleId} ${finding.message}`)
const exported = await post('/api/dsh-aidrama/export', { cwd: session.cwd, projectId: saved.project.id })
console.log('exported =', exported.dir, exported.files.length, 'files')
const deleted = await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'delete', projectId: saved.project.id })
console.log('deleted =', deleted.deleted)
if (validation.validation.errors > 0 || compiled.compiled !== 2) {
  process.exitCode = 1
} else {
  console.log('SMOKE OK')
}
