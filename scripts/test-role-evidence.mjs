import assert from 'node:assert/strict'
import { Generator } from '../src/host/generator.ts'
import { emptyProject } from '../src/host/store.ts'

const project = emptyProject('角色解析')
project.episodes = [{
  id: 'EP001', title: '一', logline: '', status: 'scripted', targetSeconds: 90, beats: [],
  script: '1-1 内 金銮殿 日人物:许青、江洛漓\n许青:臣有本要奏！\n柳拂衣:许大人，奴婢柳拂衣。\n江洛漓:朕登基头一日。',
  scriptLocked: false, scriptHash: '', shots: [], segments: [],
}]

const generator = new Generator({
  chatJson: async request => {
    if (request.label.includes('剧本事实解析')) {
      return {
        value: {
          cast: [
            { name: '许青', gender: '男', role: '朝臣·女帝旧识', roleEvidence: ['许青:臣有本要奏！'], costume: '交领长衫', evidence: '许青:臣有本要奏！' },
            { name: '江洛漓', gender: '女', role: '女帝', roleEvidence: ['江洛漓:朕登基头一日。'], costume: '龙袍', evidence: '江洛漓:朕登基头一日。' },
          ],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    }
    if (request.label.includes('角色身份修复')) {
      return {
        value: {
          roles: [
            { name: '许青', role: '朝臣·女帝旧识', roleEvidence: ['许青:臣有本要奏！'] },
            { name: '江洛漓', role: '女帝', roleEvidence: ['江洛漓:朕登基头一日。'] },
          ],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    }
    return {
      value: {
        characters: [
          { id: 'C01', name: '许青', role: '主角', slots: { ageGender: '28岁 男', outfit: '交领长衫' } },
          { id: 'C02', name: '江洛漓', role: '对手', slots: { ageGender: '24岁 女', outfit: '龙袍' } },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    }
  },
})

const result = await generator.generate({ project, stage: 'characters', provider: 'mock', model: 'mock' })
const xu = result.project.characters.find(item => item.name === '许青')
const jiang = result.project.characters.find(item => item.name === '江洛漓')
assert.equal(xu?.role, '朝臣·女帝旧识')
assert.equal(jiang?.role, '女帝')
assert.ok((xu?.roleEvidence ?? []).length > 0)
console.log('PASS generic role is replaced by script-evidenced role')
