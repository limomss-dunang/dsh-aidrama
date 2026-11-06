/**
 * Seedance 2.0 路由冒烟：本地 mock 方舟，验证参考图/参考音频请求体、轮询与落盘。
 * 用法：node scripts/test-video-generate.mjs <sessionId>
 */
import { createServer } from 'node:http'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:65361'
const sessionId = process.argv[2]
const ws = 'E:\\work\\aiwork\\dimexplore\\code\\dim_dsh_plugin'
const temp = join(ws, '.tmp-video-test')
const port = 7789
let captured = null

const mock = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/v3/contents/generations/tasks') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'task-test-1' }))
    return
  }
  if (req.method === 'GET' && req.url === '/api/v3/contents/generations/tasks/task-test-1') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'succeeded', content: { video_url: `http://127.0.0.1:${port}/video.mp4` } }))
    return
  }
  if (req.method === 'GET' && req.url === '/video.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4' })
    res.end(Buffer.alloc(2048, 1))
    return
  }
  res.writeHead(404).end('not found')
})
await new Promise(resolve => mock.listen(port, '127.0.0.1', resolve))

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}

function wav() {
  const data = Buffer.alloc(400)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zx1cAAAAASUVORK5CYII=', 'base64')
await post('/api/dsh-aidrama/config', { config: { dataDir: temp } })
const created = await post('/api/dsh-aidrama/projects', { cwd: ws, sessionId, title: '视频测试' })
const projectId = created.project.id
const dir = join(temp, projectId)
await mkdir(join(dir, 'refs'), { recursive: true })
await mkdir(join(dir, 'audio'), { recursive: true })
await writeFile(join(dir, 'refs', 'SHOT-EP001-001.png'), png)
await writeFile(join(dir, 'audio', 'voice-C01.wav'), wav())

const character = {
  id: 'C01', name: '陈默', role: '外卖员', status: 'draft',
  slots: { ageGender: '', face: '', hair: '', body: '', outfit: '', accessories: '', temperament: '', forbidden: '', lightBaseline: '' },
  lockText: '', looks: [], stateVariants: [],
  refs: { front: '', side: '', back: '', expression: '', main: '' },
  voiceCard: { voiceId: 'mimo', ageRange: '', rate: '', baseline: '', forbidden: '', voiceSample: 'audio/voice-C01.wav', designPrompt: '35岁男性，低沉', sampleText: '我是陈默。', designedAt: Date.now() },
}
const shot = {
  id: 'SHOT-EP001-001', sceneId: 'S01', duration: 5, size: 'medium', camera: '固定机位', blocking: '',
  action: '陈默抬头', endState: '', emotion: { start: '', trigger: '', end: '' },
  dialogue: [{ speaker: 'C01', text: '你好。', offScreen: false, voiceOver: false }],
  sound: { ambience: '', sfx: '', music: '' },
  refs: [{ slot: 'REF-FIRST', state: 'ref', role: 'first', path: 'refs/SHOT-EP001-001.png', note: '' }],
  locks: [], status: 'compiled', videoPath: '',
  prompt: { dialect: 'seedance-2.0', text: '中景，陈默抬头说：“你好。”', compiledAt: Date.now(), warnings: [] },
}
const episode = { id: 'EP001', title: '第一集', logline: '', status: 'boarded', beats: [], script: '', shots: [shot] }
const project = { ...created.project, characters: [character], episodes: [episode] }
const saved = await post('/api/dsh-aidrama/project', { cwd: ws, action: 'save', project, expectedRevision: project.revision })
await post('/api/dsh-aidrama/config', { config: { dataDir: temp, videoBaseUrl: `http://127.0.0.1:${port}/api/v3`, videoApiKey: 'test-key', videoModel: 'doubao-seedance-2-0-test' } })
const result = await post('/api/dsh-aidrama/video-generate', { cwd: ws, projectId, shotId: shot.id, expectedRevision: saved.project.revision })
console.log('videoPath =', result.videoPath, 'task =', result.taskId)
console.log('video bytes =', await stat(join(dir, result.videoPath)).then(info => info.size))
console.log('request =', JSON.stringify(captured, null, 2))
await post('/api/dsh-aidrama/project', { cwd: ws, action: 'delete', projectId })
await post('/api/dsh-aidrama/config', { config: { dataDir: '', videoBaseUrl: '', videoApiKey: '', videoModel: '' } })
await rm(temp, { recursive: true, force: true })
mock.close()
console.log('VIDEO OK')
