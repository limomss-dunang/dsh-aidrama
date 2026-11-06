import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL(process.env.DSH_BASE ?? 'http://127.0.0.1:58858')
const root = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = process.argv[2] ?? 'drama-20261106-005140-7otb'

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
          if (json.ok !== true) reject(new Error(`${path}: ${json.error}`))
          else resolve(json.value)
        } catch (error) { reject(error) }
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error(`request timeout ${path}`)))
    req.on('error', reject)
    req.end(data)
  })
}

async function getProject() {
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

const log = []
const steps = [
  ['bible', undefined],
  ['characters', undefined],
  ['scenes', undefined],
  ['props', undefined],
  ['episode', 'EP001'],
  ['shots', 'EP001'],
]
let project = await getProject()
log.push(`start ${project.id} rev=${project.revision} episodes=${project.episodes.length}`)
for (const [stage, episodeId] of steps) {
  const started = Date.now()
  const result = await post('/api/dsh-aidrama/generate', {
    cwd: root, projectId, stage, episodeId,
    expectedRevision: project.revision,
  })
  project = result.project
  const summary = {
    stage,
    seconds: Math.round((Date.now() - started) / 1000),
    revision: project.revision,
    characters: project.characters.length,
    scenes: project.scenes.length,
    props: project.props.length,
    episode: episodeId,
    shots: project.episodes.find(item => item.id === episodeId)?.shots.length,
    beats: project.episodes.find(item => item.id === episodeId)?.beats.length,
    notes: result.notes,
    errors: result.validation?.errors,
    warns: result.validation?.warns,
  }
  log.push(JSON.stringify(summary))
  console.log(JSON.stringify(summary))
}
await writeFile(`${root}/output/audit-dsh-aidrama/text-rerun-20261106.json`, JSON.stringify(project, null, 2), 'utf8')
await writeFile(`${root}/output/audit-dsh-aidrama/text-rerun-20261106.log`, log.join('\n'), 'utf8')
console.log('DONE', project.id, 'rev', project.revision)
