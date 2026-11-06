import { ProjectStore } from '../src/host/store.ts'
import { balanceBeats } from '../src/host/estimator.ts'
import { compileShotInto, shotInputHash } from '../src/host/compiler.ts'
import { validateProject } from '../src/host/validator.ts'

const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const root = `${cwd}/.dsh-aidrama/projects`
const store = new ProjectStore(() => cwd, () => root)
const project = await store.read('drama-20261105-003557-7r3y')
const episode = project.episodes.find(item => item.id === 'EP001')
if (episode === undefined) throw new Error('EP001 missing')
episode.targetSeconds = 90
balanceBeats(episode, 90)
project.meta.dialect = 'seedance-2.0'
for (const shot of episode.shots) {
  shot.refs = shot.refs.map(ref => (ref.state === 'ref' && ref.path.trim() === '') || ref.state === 'missing' ? { ...ref, state: 'plan' } : ref)
  shot.dialogue = shot.dialogue.filter(line => project.characters.some(character => character.id === line.speaker))
  const valid = shot.locks.filter(lock => /^LOCK-C\d+/i.test(lock))
  shot.locks = valid.length > 0 ? valid : [...new Set(shot.dialogue.map(line => line.speaker).filter(Boolean).map(id => `LOCK-${id}-LOCK`))]
  compileShotInto(project, episode, shot, 'seedance-2.0')
}
const saved = await store.save(project, project.revision)
const validation = validateProject(saved, 'EP001')
console.log(JSON.stringify({
  revision: saved.revision,
  beats: episode.beats.reduce((sum, beat) => sum + beat.seconds, 0),
  shots: episode.shots.length,
  seconds: episode.shots.reduce((sum, shot) => sum + shot.duration, 0),
  locks: [...new Set(episode.shots.flatMap(shot => shot.locks))],
  errors: validation.errors,
  warns: validation.warns,
  findings: validation.findings.filter(item => item.level === 'error').slice(0, 10),
  hashStable: episode.shots.every(shot => shot.prompt.inputHash === shotInputHash(saved, episode, shot)),
}, null, 2))
