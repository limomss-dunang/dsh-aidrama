import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { locationNames } from '../src/shared/script.ts'

const base = new URL('http://127.0.0.1:60251')
const root = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = 'drama-20261106-005140-7otb'

function requestJson(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = request({
      hostname: base.hostname, port: base.port, path, method,
      headers: { origin: base.origin, ...(data === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }) },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (json.ok !== true) reject(new Error(json.error))
          else resolve(json.value)
        } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

const current = await requestJson('GET', `/api/dsh-aidrama/project?cwd=${encodeURIComponent(root)}&projectId=${projectId}`)
const project = current.project
const original = JSON.parse(await readFile(`${root}/output/audit-dsh-aidrama/import-deterministic-20261106.json`, 'utf8')).project
const originalFirst = original.episodes[0]
const episode = project.episodes.find(item => item.id === 'EP001')
if (episode !== undefined && originalFirst !== undefined) {
  episode.title = originalFirst.title
}
const locations = locationNames(project.episodes.map(item => item.script))
let added = 0
for (const location of locations) {
  if (project.scenes.some(scene => scene.name.includes(location) || location.includes(scene.name))) continue
  project.scenes.push({
    id: `S${String(project.scenes.length + 1).padStart(2, '0')}`,
    name: location,
    appearsIn: [],
    space: '（从剧本场次补建，待补空间结构）',
    props: '', palette: '', keyLight: '', refImage: '', variants: [],
  })
  added += 1
}
for (const scene of project.scenes) {
  if (scene.appearsIn.length === 0) {
    scene.appearsIn = project.episodes.filter(item => item.script.includes(scene.name)).map(item => item.id)
  }
}
const saved = await requestJson('POST', '/api/dsh-aidrama/project', {
  cwd: root, action: 'save', project, expectedRevision: project.revision,
})
console.log(JSON.stringify({
  revision: saved.project.revision,
  title: episode?.title,
  scenes: saved.project.scenes.length,
  added,
  errors: saved.validation?.errors,
  warns: saved.validation?.warns,
  findings: saved.validation?.findings?.filter(item => item.level === 'error').map(item => `${item.ruleId} ${item.message}`).slice(0, 10),
}, null, 2))
