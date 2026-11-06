import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { ProjectStore, emptyProject, normalizeProject } from '../src/host/store.ts'
import { ConfigStore } from '../src/host/config.ts'
import { makeRoutes } from '../src/host/routes.ts'
import { API } from '../src/shared/types.ts'

const base = await mkdtemp(join(tmpdir(), 'dsh-aidrama-video-race-'))
const root = join(base, 'projects')
const cfg = new ConfigStore(() => join(base, 'config'))
await cfg.save({
  dataDir: root,
  videoBaseUrl: 'http://mock.local/api/v3',
  videoApiKey: 'test-key',
  videoModel: 'doubao-seedance-2-0-fast-260128',
})
const store = new ProjectStore(() => base, () => root)
const created = await store.create({ title: 'before-race' })
const project = normalizeProject({
  ...emptyProject(''),
  id: created.id,
  title: 'before-race',
  meta: { ...emptyProject('').meta, orientation: 'portrait' },
  characters: [{ id: 'C01', name: '甲', status: 'locked', voiceCard: { voiceSample: 'audio/voice.wav' }, refs: { main: 'refs/first.png' } }],
  scenes: [{ id: 'S01', name: '房间' }],
  episodes: [{
    id: 'EP001', title: '竞态', targetSeconds: 4,
    beats: [{ id: 'B1', seconds: 4, text: '钩子' }],
    script: '甲说话',
    shots: [{
      id: 'SHOT-EP001-001', duration: 4, sceneId: 'S01', action: '抬头',
      dialogue: [{ speaker: 'C01', text: '你好', offScreen: false, voiceOver: false }],
      locks: ['LOCK-C01-LOCK'], wardrobe: {}, refs: [],
      prompt: { dialect: '', text: '', compiledAt: 0, version: 0, inputHash: '', warnings: [] },
    }],
  }],
})
const saved = await store.save(project, project.revision)
const dir = store.directoryOf(saved.id)
await mkdir(join(dir, 'audio'), { recursive: true })
await mkdir(join(dir, 'refs'), { recursive: true })
await writeFile(join(dir, 'audio', 'voice.wav'), Buffer.from('RIFF....WAVE'))
await writeFile(join(dir, 'refs', 'first.png'), Buffer.from('89504e470d0a1a0a', 'hex'))

const routes = makeRoutes({
  configs: cfg,
  dsh: { defaultSelection: () => undefined, available: false },
  dataRoot: () => base,
  storeFor: (cwd, dataDir) => new ProjectStore(() => cwd, () => dataDir),
  sessionCwd: () => base,
  homeCwd: () => base,
})
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  const route = routes.find(item => item.path === path)
  if (route) void route.handler(req, res)
  else res.writeHead(404).end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`

let posts = 0
let pollSaved = false
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input.url
  if (href.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
    posts += 1
    // 模拟 pending 保存后、taskId 回写前的并发编辑。
    const latest = await store.read(saved.id)
    latest.title = 'concurrent-edit'
    await store.save(latest, latest.revision)
    return new Response(JSON.stringify({ id: 'task-race-1' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.includes('/contents/generations/tasks/task-race-1')) {
    if (!pollSaved) {
      pollSaved = true
      const latest = await store.read(saved.id)
      latest.title = 'poll-edit'
      await store.save(latest, latest.revision)
    }
    return new Response(JSON.stringify({ status: 'succeeded', content: { video_url: 'http://mock.local/video.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.endsWith('/video.mp4')) {
    return new Response(Buffer.alloc(4096, 1), { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  return originalFetch(input, init)
}
try {
  const response = await originalFetch(url + API.videoGenerate, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: base, projectId: saved.id, shotId: 'SHOT-EP001-001', expectedRevision: saved.revision }),
  })
  const payload = await response.json()
  assert.equal(payload.ok, true)
  const after = await store.read(saved.id)
  const job = after.jobs.find(item => item.id === payload.value.taskId || item.providerTaskId === payload.value.taskId)
  assert(job !== undefined)
  assert.equal(job.providerTaskId, 'task-race-1')
  assert.equal(job.status, 'done')
  assert.equal(after.title, 'poll-edit')
  assert.equal(after.episodes[0].shots[0].videoPath, 'videos/SHOT-EP001-001.mp4')
  assert.equal(posts, 1)
  console.log('PASS video taskId survives concurrent save without duplicate submit')
} finally {
  globalThis.fetch = originalFetch
  await new Promise(resolve => server.close(resolve))
}
console.log('VIDEO RACE REGRESSION OK')
