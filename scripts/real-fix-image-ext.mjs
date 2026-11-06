import { rename, access } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectStore } from '../src/host/store.ts'

const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const root = `${cwd}/.dsh-aidrama/projects`
const store = new ProjectStore(() => cwd, () => root)
const project = await store.read('drama-20261105-003557-7r3y')
const dir = store.directoryOf(project.id)
const renameRef = async (path) => {
  if (typeof path !== 'string' || !path.endsWith('.png')) return path
  const source = join(dir, path)
  const target = path.replace(/\.png$/, '.jpg')
  try {
    await access(join(dir, target))
  } catch {
    await rename(source, join(dir, target))
  }
  return target
}
for (const character of project.characters) {
  character.refs.main = await renameRef(character.refs.main)
  character.refs.front = await renameRef(character.refs.front)
  character.refs.side = await renameRef(character.refs.side)
  character.refs.back = await renameRef(character.refs.back)
  for (const look of character.looks) {
    look.refs.main = await renameRef(look.refs.main)
    look.refs.front = await renameRef(look.refs.front)
    look.refs.side = await renameRef(look.refs.side)
    look.refs.back = await renameRef(look.refs.back)
  }
}
for (const scene of project.scenes) scene.refImage = await renameRef(scene.refImage)
for (const prop of project.props) prop.refImage = await renameRef(prop.refImage)
for (const episode of project.episodes) for (const shot of episode.shots) for (const ref of shot.refs) ref.path = await renameRef(ref.path)
const saved = await store.save(project, project.revision)
console.log('saved', saved.revision, saved.characters[0].refs.main, saved.scenes.find(s => s.id === 'S04').refImage, saved.episodes[0].shots.find(s => s.id === 'SHOT-EP001-002').refs.map(r => r.path))
