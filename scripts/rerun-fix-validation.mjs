import { ProjectStore } from '../src/host/store.ts'
import { compileShotInto } from '../src/host/compiler.ts'
import { validateProject } from '../src/host/validator.ts'

const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const root = `${cwd}/.dsh-aidrama/projects`
const store = new ProjectStore(() => cwd, () => root)
const project = await store.read('drama-20261105-003557-7r3y')
const episode = project.episodes.find(item => item.id === 'EP001')
if (episode === undefined) throw new Error('EP001 missing')
for (const shot of episode.shots) {
  shot.refs = shot.refs.map(ref => ref.state === 'missing' ? { ...ref, state: 'plan' } : ref)
}
const bad = episode.shots.find(shot => shot.id === 'SHOT-EP001-010')
if (bad !== undefined) {
  bad.dialogue = [
    { speaker: 'C02', text: '许青，你同党。', offScreen: false, voiceOver: false },
    { speaker: 'C01', text: '臣是救驾——', offScreen: false, voiceOver: false },
  ]
}
for (const shot of episode.shots) {
  if (shot.prompt.text.trim() === '' || shot.shotId === 'SHOT-EP001-010' || shot.id === 'SHOT-EP001-005') compileShotInto(project, episode, shot, 'seedance-2.0')
}
const saved = await store.save(project, project.revision)
const validation = validateProject(saved, 'EP001')
console.log(JSON.stringify({ revision: saved.revision, errors: validation.errors, warns: validation.warns, findings: validation.findings.filter(item => item.level === 'error') }, null, 2))
