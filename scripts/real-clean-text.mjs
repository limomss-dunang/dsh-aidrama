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

const b1 = episode.beats.find(item => item.id === 'B1')
if (b1 !== undefined) {
  b1.text = '九级台阶顶端，江洛漓坐在御座上按剑俯视；两名侍卫反拧许青双臂，将他按跪金砖地。江洛漓宣判「朕登基头一日，你在宫门外妖言惑众，乱朕朝纲，当诛」；许青抬头，面板弹出杀意值87%。'
}

const shot1 = episode.shots.find(item => item.id === 'SHOT-EP001-001')
if (shot1 !== undefined) {
  shot1.sceneId = 'S01'
  shot1.size = 'wide'
  shot1.camera = '低机位仰拍'
  shot1.blocking = '江洛漓坐御座俯视；许青被按跪阶下'
  shot1.action = '江洛漓按剑俯视→侍卫反拧许青双臂按跪→许青抬头'
  shot1.endState = '许青跪于金砖地，抬头看向御座'
  shot1.dialogue = []
}
const shot2 = episode.shots.find(item => item.id === 'SHOT-EP001-002')
if (shot2 !== undefined) {
  shot2.action = '江洛漓冷脸下令→侍卫架起许青拖向殿门→许青膝盖磕上石棱'
  shot2.endState = '许青被拖到殿门方向'
}

const saved = await call('POST', '/api/dsh-aidrama/project', {
  cwd: root,
  action: 'save',
  project,
  expectedRevision: project.revision,
})
const ep = saved.project.episodes.find(item => item.id === 'EP001')
console.log(JSON.stringify({
  revision: saved.project.revision,
  title: ep?.title,
  shots: ep?.shots.length,
  segments: ep?.segments.length,
  dialogue: ep?.shots.reduce((n, shot) => n + shot.dialogue.length, 0),
  first: ep?.shots[0] ? {
    sceneId: ep.shots[0].sceneId,
    action: ep.shots[0].action,
    dialogue: ep.shots[0].dialogue,
  } : undefined,
  errors: saved.validation?.errors,
  warns: saved.validation?.warns,
  errorFindings: saved.validation?.findings?.filter(item => item.level === 'error').map(item => `${item.ruleId} ${item.message}`).slice(0, 8),
}, null, 2))
