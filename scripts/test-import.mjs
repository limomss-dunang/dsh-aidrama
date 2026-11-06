/**
 * 剧本导入冒烟：粘贴两集短剧本 → 解析预览 → 写入临时目录 → 清理。
 * 会调用模型（解析 + 第一集分镜）。
 * 用法：node scripts/test-import.mjs <sessionId>
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:65361'
const sessionId = process.argv[2]
const ws = 'E:\\work\\aiwork\\dimexplore\\code\\dim_dsh_plugin'
const temp = join(ws, '.tmp-import-test')

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}

const script = `第一集
【场景】老居民楼客厅 夜
陈默把外卖箱放在门口，女儿小雨举着画跑过来。
小雨：爸爸，今天老师夸我画得好。
陈默（疲惫地笑）：画的什么？
小雨：画我们三个人。
陈默沉默，把画贴在冰箱上。

第二集
【场景】餐厅 夜
经理把餐盘推回陈默面前。
经理：送外卖的，别站在这里。
陈默抬头，慢慢从口袋里掏出黑色工牌。
陈默：现在，叫你们董事来。`

const session = await post('/api/dsh-aidrama/session', { sessionId })
const preview = await post('/api/dsh-aidrama/import', {
  cwd: ws,
  sessionId,
  title: '导入测试',
  text: script,
  instruction: '单集按 30 秒估算',
})
console.log('title =', preview.project.title)
console.log('logline =', preview.project.meta.logline)
console.log('counts =', {
  characters: preview.project.characters.length,
  scenes: preview.project.scenes.length,
  props: preview.project.props.length,
  episodes: preview.project.episodes.length,
  shots: preview.project.episodes[0]?.shots.length ?? 0,
  compiled: preview.project.episodes[0]?.shots.filter(shot => shot.prompt.text.trim() !== '').length ?? 0,
})
console.log('episodes =', preview.project.episodes.map(episode => `${episode.id} ${episode.title} ${episode.script.length}字`))
console.log('notes =', preview.notes)
console.log('warnings =', preview.warnings)
console.log('validation =', preview.validation.errors, 'error /', preview.validation.warns, 'warn')
console.log('usage =', preview.usage)

const applied = await post('/api/dsh-aidrama/import/apply', {
  cwd: ws, sessionId, parent: temp, project: preview.project,
})
console.log('applied =', applied.project.id, applied.project.title)
console.log('path exists =', await import('node:fs/promises').then(fs => fs.stat(join(temp, applied.project.id, 'project.json')).then(() => true).catch(() => false)))

await post('/api/dsh-aidrama/project', { cwd: ws, action: 'delete', projectId: applied.project.id })
await post('/api/dsh-aidrama/config', { config: { dataDir: '' } })
await rm(temp, { recursive: true, force: true })
const configFile = join(homedir(), '.dsh', 'storages', 'dsh-aidrama', 'config.json')
const doc = JSON.parse(await readFile(configFile, 'utf8'))
delete doc.projectSessions[sessionId]
await writeFile(configFile, JSON.stringify(doc, null, 2), 'utf8')
console.log('IMPORT OK')
