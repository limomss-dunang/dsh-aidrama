import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = 'drama-20261105-003557-7r3y'
function call(path, body, timeout = 300_000) {
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

const validated = await call('/api/dsh-aidrama/validate', { cwd, projectId, episodeId: 'EP001' })
console.log('validation', validated.validation.errors, 'errors', validated.validation.warns, 'warns')
await writeFile('E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/real-final-validation.json', JSON.stringify(validated, null, 2), 'utf8')
const exported = await call('/api/dsh-aidrama/export', { cwd, projectId })
console.log('export', exported.dir, exported.files.length, 'files')
await writeFile('E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/real-export.json', JSON.stringify(exported, null, 2), 'utf8')
console.log(JSON.stringify(exported.files))
