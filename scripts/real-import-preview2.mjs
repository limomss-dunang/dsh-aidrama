import { readFile, writeFile } from 'node:fs/promises'

const base = 'http://127.0.0.1:60251'
const docx = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin/docs/攻略女帝_1-11集.docx'
const api = async (path, init = {}) => {
  const response = await fetch(base + path, { ...init, headers: { origin: base, ...(init.headers ?? {}) } })
  const json = await response.json()
  if (json.ok !== true) throw new Error(`${path}: ${json.error}`)
  return json.value
}
const post = (path, body, timeout = 900000) => api(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(timeout),
})

const session = await post('/api/dsh-aidrama/session', { sessionId: '' }, 30000)
const view = await api('/api/dsh-aidrama/config')
const config = { ...view.config }
config.parseProvider = 'dimexplore'
config.parseModel = 'deepseek-v4.1-flash'
await post('/api/dsh-aidrama/config', { config }, 30000)
console.log('parse model', config.parseProvider, config.parseModel)

const file = await readFile(docx)
const preview = await post('/api/dsh-aidrama/import', {
  cwd: session.cwd,
  projectId: '',
  title: '攻略女帝',
  fileName: '攻略女帝_1-11集.docx',
  fileBase64: file.toString('base64'),
}, 1800000)
await writeFile('output/audit-dsh-aidrama/real-import-preview.json', JSON.stringify(preview, null, 2), 'utf8')
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
