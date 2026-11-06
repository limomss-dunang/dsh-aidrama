import { readFile, writeFile } from 'node:fs/promises'

const base = 'http://127.0.0.1:60251'
const docx = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin/docs/攻略女帝_1-11集.docx'
const post = async (path, body, timeout = 600000) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const json = await response.json()
  if (json.ok !== true) throw new Error(`${path}: ${json.error}`)
  return json.value
}

const session = await post('/api/dsh-aidrama/session', { sessionId: '' }, 30000)
console.log('cwd', session.cwd)
const list = await fetch(`${base}/api/dsh-aidrama/projects?cwd=${encodeURIComponent(session.cwd)}&sessionId=`, { headers: { origin: base } }).then(response => response.json())
console.log('projects', JSON.stringify(list.value?.projects?.map(item => ({ id: item.id, title: item.title, revision: item.revision }))))

const file = await readFile(docx)
const preview = await post('/api/dsh-aidrama/import', {
  cwd: session.cwd,
  projectId: '',
  title: '攻略女帝（真实测试）',
  fileName: '攻略女帝_1-11集.docx',
  fileBase64: file.toString('base64'),
}, 900000)
await writeFile('output/audit-dsh-aidrama/real-import-preview.json', JSON.stringify(preview, null, 2), 'utf8')
console.log('preview', JSON.stringify({
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
