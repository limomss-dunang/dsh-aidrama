import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
function call(path, body, timeout = 1_200_000) {
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

const session = await call('/api/dsh-aidrama/session', { sessionId: '' }, 30_000)
const cwd = session.cwd
const projectId = 'drama-20261105-003557-7r3y'
const view = await call('/api/dsh-aidrama/config', {}, 30_000)
await call('/api/dsh-aidrama/config', { config: { ...view.config, provider: 'dimexplore', model: 'deepseek-v4.1-flash' } }, 30_000)
console.log('model', 'dimexplore/deepseek-v4.1-flash', 'cwd', cwd)

for (const stage of ['characters', 'scenes', 'props']) {
  const started = Date.now()
  try {
    const result = await call('/api/dsh-aidrama/generate', { cwd, projectId, stage })
    console.log(stage, 'OK', Math.round((Date.now() - started) / 1000) + 's', result.notes, result.usage)
    await writeFile(`E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/real-${stage}.json`, JSON.stringify(result, null, 2), 'utf8')
  } catch (error) {
    console.log(stage, 'FAIL', Math.round((Date.now() - started) / 1000) + 's', error.message)
    process.exitCode = 1
    break
  }
}
