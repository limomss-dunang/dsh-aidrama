/**
 * 清理冒烟项目与会话绑定。只删除标题包含 Smoke / 冒烟 / 测试 的项目。
 * 用法：node scripts/cleanup-smoke.mjs <sessionId>
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:51469'
const sessionId = process.argv[2]
async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}
const session = await post('/api/dsh-aidrama/session', { sessionId })
const listResponse = await fetch(`${BASE}/api/dsh-aidrama/projects?cwd=${encodeURIComponent(session.cwd)}&sessionId=${encodeURIComponent(sessionId)}`)
const list = (await listResponse.json()).value
for (const project of list.projects) {
  if (/smoke|冒烟|测试/i.test(project.title)) {
    await post('/api/dsh-aidrama/project', { cwd: session.cwd, action: 'delete', projectId: project.id })
    console.log('deleted', project.id, project.title)
  }
}
const configFile = join(homedir(), '.dsh', 'storages', 'dsh-aidrama', 'config.json')
try {
  const doc = JSON.parse(await readFile(configFile, 'utf8'))
  if (doc.projectSessions !== undefined && doc.projectSessions[sessionId] !== undefined) {
    delete doc.projectSessions[sessionId]
    await writeFile(configFile, JSON.stringify(doc, null, 2), 'utf8')
    console.log('unbound session', sessionId)
  }
} catch (error) {
  console.log('config cleanup skipped:', error instanceof Error ? error.message : String(error))
}
