import { writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
const root = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = 'drama-20261106-005140-7otb'

function post(path, body, timeout = 300_000) {
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

let project = await getProject()
const style = project.styles[0]
if (style === undefined) throw new Error('missing style')
style.status = 'accepted'
const saved = await post('/api/dsh-aidrama/project', {
  cwd: root, action: 'save', project, expectedRevision: project.revision,
})
project = saved.project
console.log('style accepted, rev', project.revision)

const character = await post('/api/dsh-aidrama/image-generate', {
  cwd: root, projectId, target: 'character', id: 'C01', view: 'sheet', expectedRevision: project.revision,
})
project = character.project
console.log('CHARACTER', character.imagePath, character.bytes)

const scene = await post('/api/dsh-aidrama/image-generate', {
  cwd: root, projectId, target: 'scene', id: 'S01', expectedRevision: project.revision,
})
project = scene.project
console.log('SCENE', scene.imagePath, scene.bytes)

await writeFile(`${root}/output/audit-dsh-aidrama/style-test-20261106.json`, JSON.stringify(project, null, 2), 'utf8')
await writeFile(`${root}/output/audit-dsh-aidrama/style-test-20261106.log`, JSON.stringify({
  character: character.imagePath,
  scene: scene.imagePath,
  revision: project.revision,
  errors: scene.validation?.errors,
  warns: scene.validation?.warns,
}, null, 2), 'utf8')
console.log('DONE rev', project.revision)
