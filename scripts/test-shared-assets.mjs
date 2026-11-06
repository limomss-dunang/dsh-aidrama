import assert from 'node:assert/strict'
import { emptyProject, normalizeProject } from '../src/host/store.ts'
import { groupShotsIntoSegments } from '../src/shared/segments.ts'

const project = emptyProject('共享资产')
project.episodes = [
  { id: 'EP001', title: '一', logline: '', status: 'scripted', targetSeconds: 0, beats: [], script: '人物：许青、江洛漓\n金銮殿殿内\n许青抬头。', scriptLocked: false, scriptHash: '', shots: [], segments: [] },
  { id: 'EP002', title: '二', logline: '', status: 'scripted', targetSeconds: 0, beats: [], script: '人物：许青\n天牢过道\n许青坐下。', scriptLocked: false, scriptHash: '', shots: [], segments: [] },
]
project.characters = [{
  id: 'C01', name: '许青', role: '主角', status: 'draft', appearsIn: [],
  slots: { ageGender: '', face: '', hair: '', body: '', outfit: '', accessories: '', temperament: '', forbidden: '', lightBaseline: '' },
  lockText: '', identityLock: '', looks: [], stateVariants: [],
  refs: { front: '', side: '', back: '', expression: '', main: '' },
  refPrompts: { front: '', side: '', back: '', sheet: '' },
  voiceCard: { voiceId: '', ageRange: '', rate: '', baseline: '', forbidden: '', voiceSample: '', designPrompt: '', sampleText: '', designedAt: 0 },
}]
project.scenes = [{ id: 'S01', name: '金銮殿殿内', appearsIn: [], space: '', props: '', palette: '', keyLight: '', refImage: '', variants: [] }]
const shots = Array.from({ length: 4 }, (_, i) => ({
  id: `SHOT-EP001-00${i + 1}`, sceneId: 'S01', duration: 4, size: 'medium', camera: '固定', blocking: '', action: `动作${i + 1}`, endState: '',
  emotion: { start: '', trigger: '', end: '' }, dialogue: [], sound: { ambience: '', sfx: '', music: '' },
  refs: [], locks: [], wardrobe: { C01: 'LOOK-01' }, status: 'draft', videoPath: '',
  prompt: { dialect: '', text: '', compiledAt: 0, version: 0, inputHash: '', warnings: [] },
}))
project.episodes[0].shots = shots
project.episodes[0].segments = groupShotsIntoSegments(shots, 'EP001')

const normalized = normalizeProject(project)
assert.deepEqual(normalized.characters[0].appearsIn, ['EP001', 'EP002'])
assert.deepEqual(normalized.scenes[0].appearsIn, ['EP001'])
assert.ok(normalized.episodes[0].segments.length >= 2)
for (const segment of normalized.episodes[0].segments) {
  assert.ok(segment.duration <= 15)
  assert.ok(segment.shotIds.length <= 3)
}
console.log('PASS shared assets keep one copy and derive appearsIn')
console.log('PASS segments group shots into <=15s video tasks')
