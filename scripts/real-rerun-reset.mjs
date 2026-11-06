import { copyFile, writeFile } from 'node:fs/promises'
import { ProjectStore } from '../src/host/store.ts'

const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const root = `${cwd}/.dsh-aidrama/projects`
const store = new ProjectStore(() => cwd, () => root)
const id = 'drama-20261105-003557-7r3y'
const source = `${root}/${id}/project.json`
const backup = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/backups/攻略女帝-project-v1-before-rerun.json'
await copyFile(source, backup)
const project = await store.read(id)
project.title = '攻略女帝'
project.characters = []
project.scenes = []
project.props = []
project.jobs = []
project.ledger = []
project.episodes = project.episodes.map(episode => ({
  ...episode,
  beats: [],
  shots: [],
  targetSeconds: 90,
  status: 'scripted',
}))
const saved = await store.save(project, project.revision)
await writeFile('E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/rerun-reset.json', JSON.stringify({ backup, id: saved.id, revision: saved.revision, episodes: saved.episodes.length }, null, 2), 'utf8')
console.log('reset', saved.revision, backup)
