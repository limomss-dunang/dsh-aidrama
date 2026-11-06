/**
 * 为当前会话建一个最小项目并绑定，供 Agent 工具冒烟使用。
 * 用法：node scripts/bind-smoke.mjs <sessionId>
 */
const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:51469'
const sessionId = process.argv[2]
async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}
const session = await post('/api/dsh-aidrama/session', { sessionId })
const created = await post('/api/dsh-aidrama/projects', { cwd: session.cwd, sessionId, title: 'Agent 工具冒烟' })
const project = created.project
project.meta.logline = '被裁员的单亲妈妈在菜市场捡到一张中奖彩票，却发现失主是前夫'
project.meta.episodeSeconds = 60
project.meta.targetEpisodes = 3
const saved = await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'save', project, expectedRevision: project.revision })
await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'bind', projectId: saved.project.id, sessionId })
console.log(JSON.stringify({ cwd: session.cwd, projectId: saved.project.id }))
