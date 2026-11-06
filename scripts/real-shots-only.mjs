import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL(process.env.DSH_BASE ?? 'http://127.0.0.1:58858')
const root = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = process.argv[2] ?? 'drama-20261106-005140-7otb'
const episodeId = process.argv[3] ?? 'EP001'

function post(path, body, timeout = 900_000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = request({
      hostname: base.hostname, port: base.port, path, method: 'POST',
      headers: { 'content-type': 'application/json', origin: base.origin, 'content-length': Buffer.byteLength(data) },
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
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(data)
  })
}

function getProject() {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: base.hostname, port: base.port,
      path: `/api/dsh-aidrama/project?cwd=${encodeURIComponent(root)}&projectId=${projectId}`,
      method: 'GET', headers: { origin: base.origin },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (json.ok !== true) reject(new Error(json.error))
          else resolve(json.value.project)
        } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

const before = await getProject()
console.log('before', before.revision, before.episodes.find(item => item.id === episodeId)?.shots.length)
const started = Date.now()
const result = await post('/api/dsh-aidrama/generate', {
  cwd: root, projectId, stage: 'shots', episodeId, expectedRevision: before.revision,
})
await writeFile(`${root}/output/audit-dsh-aidrama/text-shots-20261106.json`, JSON.stringify(result.project, null, 2), 'utf8')
const episode = result.project.episodes.find(item => item.id === episodeId)
console.log(JSON.stringify({
  seconds: Math.round((Date.now() - started) / 1000),
  revision: result.project.revision,
  shots: episode?.shots.length,
  segments: episode?.segments.length,
  beats: episode?.beats.length,
  scriptLocked: episode?.scriptLocked,
  errors: result.validation?.errors,
  warns: result.validation?.warns,
  notes: result.notes,
}, null, 2))
