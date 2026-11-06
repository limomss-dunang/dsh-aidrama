import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { ProjectStore, normalizeProject } from '../src/host/store.ts'
import { ConfigStore } from '../src/host/config.ts'
import { makeRoutes } from '../src/host/routes.ts'
import { API } from '../src/shared/types.ts'

const base = await mkdtemp(join(tmpdir(), 'dsh-aidrama-fix-http-'))
const root = join(base, 'projects')
const cfg = new ConfigStore(() => join(base, 'config'))
await cfg.save({ dataDir: root })
const store = new ProjectStore(() => base, () => root)
const project = await store.create({ title: 'audit' })
const routes = makeRoutes({
  configs: cfg,
  dsh: { defaultSelection: () => undefined, available: false },
  dataRoot: () => base,
  storeFor: (cwd, dir) => new ProjectStore(() => cwd, () => dir),
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
async function post(path, body) {
  return (await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
}
try {
  await writeFile(join(base, 'outside-secret.txt'), 'AUDIT-LOCAL-FILE', 'utf8')
  const params = new URLSearchParams({ cwd: base, projectId: '..', path: 'outside-secret.txt' })
  const escaped = await fetch(url + API.asset + '?' + params).then(response => response.text())
  assert(!escaped.includes('AUDIT-LOCAL-FILE'))
  console.log('PASS asset projectId traversal blocked')

  const shotId = '../../../escape-marker'
  const shotProject = normalizeProject({ ...project, episodes: [{ id: 'EP001', shots: [{ id: shotId, duration: 4, action: 'look' }] }] })
  const beforeUpload = await store.save(shotProject, shotProject.revision)
  const upload = await post(API.shotImage, {
    cwd: base, projectId: project.id, shotId, mime: 'image/jpeg',
    dataBase64: Buffer.from('AUDIT-ESCAPED-WRITE').toString('base64'),
    expectedRevision: beforeUpload.revision,
  })
  assert.equal(upload.ok, true)
  assert.equal(await access(join(base, '..', 'escape-marker.jpg')).then(() => true, () => false), false)
  console.log('PASS shot id write traversal blocked')

  const imported = await post(API.importApply, {
    cwd: base, parent: join(base, 'other-root'),
    project: normalizeProject({ id: 'import-new', title: 'new root' }),
  })
  assert.equal(imported.ok, false)
  assert((await cfg.read()).config.dataDir === root)
  console.log('PASS import cannot silently switch global root')

  const blocker = join(base, 'blocker-file')
  await writeFile(blocker, 'file', 'utf8')
  const broken = new ConfigStore(() => join(blocker, 'child'))
  const before = await broken.read()
  await assert.rejects(() => broken.save({ provider: 'not-persisted' }))
  const after = await broken.read()
  assert.equal(after.config.provider, before.config.provider)
  console.log('PASS config write failure propagates and cache is unchanged')
} finally {
  await new Promise(resolve => server.close(resolve))
}
console.log('AUDIT HTTP REGRESSION OK')
