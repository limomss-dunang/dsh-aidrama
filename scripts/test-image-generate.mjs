/**
 * Seedream 三视图路由冒烟：本地 mock 方舟生图，验证自定义提示词、落盘与 refs 回写。
 * 用法：node scripts/test-image-generate.mjs <sessionId>
 */
import { createServer } from 'node:http'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:65361'
const sessionId = process.argv[2]
const ws = 'E:\\work\\aiwork\\dimexplore\\code\\dim_dsh_plugin'
const temp = join(ws, '.tmp-image-test')
const port = 7790
let captured = null
const png = Buffer.alloc(1024, 1)

const mock = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/v3/images/generations') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
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

await post('/api/dsh-aidrama/config', { config: { dataDir: temp, imageBaseUrl: `http://127.0.0.1:${port}/api/v3`, imageApiKey: 'test-key', imageModel: 'doubao-seedream-test' } })
const created = await post('/api/dsh-aidrama/projects', { cwd: ws, sessionId, title: '生图测试' })
const character = {
  id: 'C01', name: '陈默', role: '外卖员', status: 'draft',
  slots: { ageGender: '35岁男性', face: '瘦削', hair: '短发', body: '中等', outfit: '外卖服', accessories: '', temperament: '隐忍', forbidden: '', lightBaseline: '' },
  lockText: '', looks: [], stateVariants: [],
  refs: { front: '', side: '', back: '', expression: '', main: '' },
  refPrompts: { front: '', side: '', back: '' },
  voiceCard: { voiceId: '', ageRange: '', rate: '', baseline: '', forbidden: '', voiceSample: '', designPrompt: '', sampleText: '', designedAt: 0 },
}
const project = { ...created.project, characters: [character] }
const saved = await post('/api/dsh-aidrama/project', { cwd: ws, action: 'save', project, expectedRevision: project.revision })
const result = await post('/api/dsh-aidrama/image-generate', {
  cwd: ws, projectId: saved.project.id, target: 'character', id: 'C01', view: 'sheet',
  prompt: '三十岁男性，正面/侧面/背面三视图并排，外卖服，冷灰背景', expectedRevision: saved.project.revision,
})
console.log('imagePath =', result.imagePath)
console.log('bytes =', await stat(join(temp, saved.project.id, result.imagePath)).then(info => info.size))
console.log('refs.main =', result.project.characters[0].refs.main)
console.log('refPrompt =', result.project.characters[0].refPrompts.sheet)
console.log('request prompt =', captured.prompt)
console.log('request size =', captured.size)
await post('/api/dsh-aidrama/project', { cwd: ws, action: 'delete', projectId: saved.project.id })
await post('/api/dsh-aidrama/config', { config: { dataDir: '', imageBaseUrl: '', imageApiKey: '', imageModel: '' } })
await rm(temp, { recursive: true, force: true })
mock.close()
console.log('IMAGE OK')
