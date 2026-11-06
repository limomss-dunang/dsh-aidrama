/**
 * 生成链路冒烟：建项目 → 存一句话 → 调 DSH 已配置模型生成总纲 → 删除。
 * 会消耗一次模型调用（约 2k output tokens）。
 *
 * 用法：node scripts/smoke-generate.mjs <sessionId>
 */
const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:51469'
const sessionId = process.argv[2]
if (sessionId === undefined) {
  console.error('用法：node scripts/smoke-generate.mjs <sessionId>')
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

const session = await post('/api/dsh-aidrama/session', { sessionId })
const created = await post('/api/dsh-aidrama/projects', { cwd: session.cwd, sessionId, title: 'Smoke 生成测试' })
const project = created.project
project.meta.logline = '外卖员在高档餐厅被经理羞辱，亮出集团董事工牌'
project.meta.genre = 'urban'
project.meta.episodeSeconds = 60
project.meta.targetEpisodes = 3
project.meta.audience = '25–40 岁通勤人群'
const saved = await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'save', project, expectedRevision: project.revision })
const generated = await post('/api/dsh-aidrama/generate', {
  cwd: session.cwd, projectId: saved.project.id, stage: 'bible',
})
console.log('title =', generated.project.title)
console.log('notes =', generated.notes)
console.log('premise =', generated.project.bible.premise)
console.log('usage =', generated.usage)
console.log('validation =', generated.validation.errors, 'error /', generated.validation.warns, 'warn')
await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'delete', projectId: saved.project.id })
console.log('SMOKE GENERATE OK')
