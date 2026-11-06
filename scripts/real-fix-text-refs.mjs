import { request } from 'node:http'

const base = new URL('http://127.0.0.1:60251')
const root = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = 'drama-20261106-005140-7otb'

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = request({
      hostname: base.hostname, port: base.port, path, method,
      headers: { origin: base.origin, ...(data === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }) },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (json.ok !== true) reject(new Error(json.error))
          else resolve(json.value)
        } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

const current = await call('GET', `/api/dsh-aidrama/project?cwd=${encodeURIComponent(root)}&projectId=${projectId}`)
const project = current.project
const episode = project.episodes.find(item => item.id === 'EP001')
if (episode === undefined) throw new Error('EP001 missing')

let fixedRefs = 0
for (const shot of episode.shots) {
  for (const ref of shot.refs) {
    if (ref.role !== 'identity') continue
    const character = project.characters.find(item => ref.note.includes(item.id) || ref.note.includes(item.name))
    if (character !== undefined) {
      ref.note = `${character.id} ${character.name}`
      fixedRefs += 1
    }
  }
}

if (project.styles.length === 0) {
  project.styles.push({
    id: 'STYLE_A',
    name: '架空唐风宫廷·冷暖对冲',
    prompt: project.bible.visualDirection,
    avoid: ['水印', 'Logo', '字幕', '现代元素'],
  })
}
const primaryStyle = project.styles[0]
if (primaryStyle !== undefined) {
  primaryStyle.status = 'proposed'
  primaryStyle.medium ??= ''
  primaryStyle.palette ??= ''
  primaryStyle.lighting ??= ''
  primaryStyle.lens ??= ''
  primaryStyle.texture ??= ''
  primaryStyle.referenceImage ??= ''
}

const shot1 = episode.shots.find(item => item.id === 'SHOT-EP001-001')
const shot2 = episode.shots.find(item => item.id === 'SHOT-EP001-002')
if (shot1 !== undefined) {
  shot1.duration = 6
  shot1.dialogue = [
    { speaker: 'C02', text: '朕登基头一日', offScreen: false, voiceOver: false },
    { speaker: 'C02', text: '你在宫门外妖言惑众', offScreen: false, voiceOver: false },
  ]
}
if (shot2 !== undefined) {
  shot2.dialogue = [
    { speaker: 'C02', text: '拖出去，打死。', offScreen: false, voiceOver: false },
    { speaker: 'C01', text: '慢着！', offScreen: false, voiceOver: false },
    { speaker: 'C02', text: '当诛', offScreen: false, voiceOver: false },
  ]
}
if (shot2 !== undefined && shot2.duration > 4) shot2.duration -= 1

const saved = await call('POST', '/api/dsh-aidrama/project', {
  cwd: root, action: 'save', project, expectedRevision: project.revision,
})
const compiled = await call('POST', '/api/dsh-aidrama/compile', {
  cwd: root, projectId, episodeId: 'EP001', dialect: 'seedance-2.5', expectedRevision: saved.project.revision,
})
const first = compiled.project.episodes[0].shots[0]
console.log(JSON.stringify({
  revision: compiled.project.revision,
  fixedRefs,
  firstPrompt: first.prompt.text.slice(0, 380),
  firstDialogue: first.dialogue.map(item => item.text),
  errors: (compiled.findings ?? []).filter(item => item.level === 'error').map(item => `${item.ruleId} ${item.message}`),
  warns: (compiled.findings ?? []).filter(item => item.level === 'warn').length,
}, null, 2))
