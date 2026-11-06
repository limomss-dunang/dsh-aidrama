import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
function call(path, body, timeout = 1_500_000) {
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
    req.setTimeout(timeout, () => req.destroy(new Error(`timeout ${path}`)))
    req.on('error', reject)
    req.end(data)
  })
}
function get(path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: base.hostname, port: base.port, path, method: 'GET', headers: { origin: base.origin } }, response => {
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
    req.on('error', reject)
    req.end()
  })
}

const session = await call('/api/dsh-aidrama/session', { sessionId: '' }, 30_000)
const cwd = session.cwd
const projectId = 'drama-20261105-003557-7r3y'
const episodeId = 'EP001'

for (const stage of ['episode', 'shots']) {
  const started = Date.now()
  const result = await call('/api/dsh-aidrama/generate', { cwd, projectId, stage, episodeId })
  console.log(stage, 'OK', Math.round((Date.now() - started) / 1000) + 's', result.notes, result.usage)
  await writeFile(`E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/real-${stage}.json`, JSON.stringify(result, null, 2), 'utf8')
}

const current = await get(`/api/dsh-aidrama/project?cwd=${encodeURIComponent(cwd)}&projectId=${projectId}`)
const compiled = await call('/api/dsh-aidrama/compile', { cwd, projectId, episodeId, expectedRevision: current.project.revision }, 300_000)
console.log('compile', compiled.compiled, '镜')
const validated = await call('/api/dsh-aidrama/validate', { cwd, projectId, episodeId }, 120_000)
await writeFile('E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/real-episode-validate.json', JSON.stringify(validated, null, 2), 'utf8')
const episode = compiled.project.episodes.find(item => item.id === episodeId)
console.log('episode', episode?.title, 'beats', episode?.beats.length, 'shots', episode?.shots.length, 'seconds', episode?.shots.reduce((sum, shot) => sum + shot.duration, 0))
console.log('validation', validated.validation.errors, 'errors', validated.validation.warns, 'warns')
console.log(JSON.stringify(validated.validation.findings.slice(0, 10).map(item => ({ rule: item.ruleId, level: item.level, message: item.message, shot: item.shotId }))))
