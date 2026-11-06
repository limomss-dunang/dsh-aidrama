import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
const docx = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin/docs/攻略女帝_1-11集.docx'

function post(path, body, timeout = 1_800_000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = request({
      hostname: base.hostname,
      port: base.port,
      path,
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base.origin, 'content-length': Buffer.byteLength(data) },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (json.ok !== true) reject(new Error(`${path}: ${json.error}`))
          else resolve(json.value)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error(`request timeout ${path}`)))
    req.on('error', reject)
    req.end(data)
  })
}

const session = await post('/api/dsh-aidrama/session', { sessionId: '' }, 30_000)
console.log('cwd', session.cwd)
const file = await readFile(docx)
console.log('docx bytes', file.length)
const started = Date.now()
try {
  const preview = await post('/api/dsh-aidrama/import', {
    cwd: session.cwd,
    projectId: '',
    title: '攻略女帝',
    fileName: '攻略女帝_1-11集.docx',
    fileBase64: file.toString('base64'),
  })
  await writeFile('output/audit-dsh-aidrama/real-import-preview.json', JSON.stringify(preview, null, 2), 'utf8')
  console.log('elapsed', Math.round((Date.now() - started) / 1000) + 's')
  console.log(JSON.stringify({
    id: preview.project.id,
    title: preview.project.title,
    characters: preview.project.characters.length,
    scenes: preview.project.scenes.length,
    props: preview.project.props.length,
    episodes: preview.project.episodes.map(episode => `${episode.id} ${episode.title} ${episode.shots.length}镜 ${episode.script.length}字`),
    errors: preview.validation.errors,
    warns: preview.validation.warns,
    notes: preview.notes,
    usage: preview.usage,
  }))
} catch (error) {
  console.error('FAILED', error.message)
  process.exitCode = 1
}
