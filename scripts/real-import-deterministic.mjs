import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { docxToText, splitEpisodes } from '../src/host/importer.ts'
import { emptyProject } from '../src/host/store.ts'

const base = new URL(process.env.DSH_BASE ?? 'http://127.0.0.1:58858')
const root = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const docx = `${root}/docs/攻略女帝_1-11集.docx`

function post(path, body, timeout = 120_000) {
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

const text = docxToText((await readFile(docx)).toString('base64'))
const segments = splitEpisodes(text)
if (segments.length === 0) throw new Error('没有识别到分集')
const project = emptyProject('', '攻略女帝')
project.meta.targetEpisodes = segments.length
project.meta.episodeSeconds = 90
project.meta.durationMode = 'fixed'
project.meta.logline = '现代社畜许青穿越成女帝江洛漓的旧识，靠系统攻略她，在宫廷与天牢之间求生。'
project.meta.genre = 'costume'
project.meta.orientation = 'portrait'
project.episodes = segments.map((segment, index) => ({
  id: segment.id || `EP${String(index + 1).padStart(3, '0')}`,
  title: segment.heading.replace(/^第[0-9一二三四五六七八九十百]+集[:：]/, '').trim() || `第 ${index + 1} 集`,
  logline: '',
  status: 'scripted',
  targetSeconds: 90,
  beats: [],
  script: segment.body,
  scriptLocked: false,
  scriptHash: '',
  shots: [],
  segments: [],
}))
const applied = await post('/api/dsh-aidrama/import/apply', {
  cwd: root,
  projectId: '',
  project,
})
await writeFile(`${root}/output/audit-dsh-aidrama/import-deterministic-20261106.json`, JSON.stringify(applied, null, 2), 'utf8')
console.log(JSON.stringify({
  id: applied.project.id,
  title: applied.project.title,
  episodes: applied.project.episodes.length,
  first: applied.project.episodes[0]?.id,
  chars: applied.project.characters.length,
  scenes: applied.project.scenes.length,
  warnings: applied.validation.warns,
}, null, 2))
