/**
 * 音色设计路由冒烟：启动本地 mock MiMo，生成一条 WAV 样音并走 asset 路由回读。
 * 用法：node scripts/test-voice-design.mjs <sessionId>
 */
import { createServer } from 'node:http'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:65361'
const sessionId = process.argv[2]
const ws = 'E:\\work\\aiwork\\dimexplore\\code\\dim_dsh_plugin'
const temp = join(ws, '.tmp-voice-test')
const port = 7788

function wav() {
  const sampleRate = 8000
  const seconds = 0.25
  const samples = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(samples * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const mock = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { audio: { data: wav().toString('base64') } } }] }))
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

const char = {
  id: 'C01', name: '陈默', role: '外卖员', status: 'draft',
  slots: { ageGender: '35岁男性', face: '瘦削', hair: '短发', body: '中等', outfit: '外卖服', accessories: '', temperament: '隐忍', forbidden: '', lightBaseline: '' },
  lockText: '', looks: [], stateVariants: [],
  refs: { front: '', side: '', back: '', expression: '', main: '' },
  voiceCard: { voiceId: '', ageRange: '35岁', rate: '偏慢', baseline: '低沉略哑', forbidden: '', voiceSample: '', designPrompt: '', sampleText: '', designedAt: 0 },
}

const cfg = await post('/api/dsh-aidrama/config', { config: { dataDir: temp, ttsBaseUrl: `http://127.0.0.1:${port}/v1`, ttsApiKey: 'test-key', ttsModel: 'mimo-v2.5-tts-voicedesign' } })
console.log('dataRoot =', cfg.dataRoot)
const created = await post('/api/dsh-aidrama/projects', { cwd: ws, sessionId, title: '音色测试' })
const project = { ...created.project, characters: [char] }
const saved = await post('/api/dsh-aidrama/project', { cwd: ws, action: 'save', project, expectedRevision: project.revision })
console.log('project =', saved.project.id)
const designed = await post('/api/dsh-aidrama/voice-design', {
  cwd: ws, projectId: saved.project.id, characterId: 'C01', description: '35岁男性，低沉略哑，语速偏慢', sampleText: '我是陈默。', expectedRevision: saved.project.revision,
})
console.log('audioPath =', designed.audioPath, 'bytes =', designed.bytes)
console.log('sample stored =', await stat(join(temp, saved.project.id, designed.audioPath)).then(info => info.size))
const asset = await fetch(`${BASE}/api/dsh-aidrama/asset?cwd=${encodeURIComponent(ws)}&projectId=${encodeURIComponent(saved.project.id)}&path=${encodeURIComponent(designed.audioPath)}`, { headers: { range: 'bytes=0-99' } })
console.log('asset =', asset.status, asset.headers.get('content-type'), asset.headers.get('content-range'), (await asset.arrayBuffer()).byteLength)
await post('/api/dsh-aidrama/project', { cwd: ws, action: 'delete', projectId: saved.project.id })
await post('/api/dsh-aidrama/config', { config: { dataDir: '', ttsBaseUrl: '', ttsApiKey: '', ttsModel: '' } })
await rm(temp, { recursive: true, force: true })
mock.close()
console.log('VOICE OK')
