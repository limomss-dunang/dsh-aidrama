import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = 'drama-20261105-003557-7r3y'
let revision = 24
function call(path, body, timeout = 1_800_000) {
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
const started = Date.now()
const look = await call('/api/dsh-aidrama/image-generate', {
  cwd, projectId, target: 'character', id: 'C01', view: 'sheet', lookId: 'LOOK-01', expectedRevision: revision,
})
revision = look.project.revision
console.log('LOOK-01 sheet', look.imagePath, revision, Math.round((Date.now() - started) / 1000) + 's')
const first = await call('/api/dsh-aidrama/image-generate', {
  cwd, projectId, target: 'shot', id: 'SHOT-EP001-002', expectedRevision: revision,
})
revision = first.project.revision
console.log('shot first', first.imagePath, revision, Math.round((Date.now() - started) / 1000) + 's')
const video = await call('/api/dsh-aidrama/video-generate', {
  cwd, projectId, shotId: 'SHOT-EP001-002', expectedRevision: revision,
})
await writeFile('E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/real-video-final.json', JSON.stringify(video, null, 2), 'utf8')
console.log('video final', video.videoPath, video.taskId, Math.round((Date.now() - started) / 1000) + 's')
