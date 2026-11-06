import { readFile, writeFile } from 'node:fs/promises'
import { emptyProject, normalizeProject, ProjectStore } from '../src/host/store.ts'
import { splitEpisodes, docxToText } from '../src/host/importer.ts'

const cwd = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin'
const projectId = 'drama-20261105-003557-7r3y'
const root = `${cwd}/.dsh-aidrama/projects`
const docx = `${cwd}/docs/攻略女帝_1-11集.docx`
const backup = 'E:/work/aiwork/dimexplore/code/dim_dsh_plugin/output/audit-dsh-aidrama/backups/攻略女帝-project-before-real-test-20261105-172034.json'

const old = JSON.parse(await readFile(backup, 'utf8'))
const text = docxToText((await readFile(docx)).toString('base64'))
const segments = splitEpisodes(text)
const raw = {
  ...emptyProject(projectId, '攻略女帝'),
  id: projectId,
  title: '攻略女帝',
  meta: {
    ...emptyProject(projectId, '攻略女帝').meta,
    platform: 'douyin',
    orientation: 'portrait',
    genre: 'costume',
    targetEpisodes: segments.length,
    episodeSeconds: 90,
    durationMode: 'fixed',
    audience: '女频/古装/穿书',
    logline: '现代人许青穿越成待斩钦犯，绑定攻略女帝系统，在赵王逼宫与宫变中护驾求生。',
    theme: '攻略进度与真心的博弈：算计的开局换来无法抽身的羁绊。',
    hook: '瞎编的刺客真的来了，护驾反被当成同党。',
    forbidden: ['现代品牌', '真实历史人物'],
  },
  styles: old.styles ?? [],
  characters: [],
  scenes: [],
  props: [],
  episodes: segments.map(segment => ({
    id: segment.id,
    title: segment.heading,
    logline: '',
    status: 'scripted',
    targetSeconds: 90,
    beats: [],
    script: segment.body,
    shots: [],
  })),
  decisions: [],
  jobs: [],
  ledger: [],
}
const project = normalizeProject(raw)
const store = new ProjectStore(() => cwd, () => root)
await store.write(project)
console.log(JSON.stringify({ id: project.id, title: project.title, episodes: project.episodes.map(item => `${item.id} ${item.title} ${item.script.length}`), root }))
