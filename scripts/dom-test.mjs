/**
 * 填充态挂载冒烟：jsdom + ReactDOM 渲染一个有项目的短剧工作台，验证侧边栏入口、
 * 中栏接管、接口加载后三栏与关键字段出现在 DOM 中。
 *
 * 用法：node scripts/dom-test.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const dom = new JSDOM(`<!doctype html><html><body>
  <div data-pane="sidebar">
    <div class="logoRow"><span>DeepSeek</span></div>
    <button data-dsh-part="new-session">新会话</button>
  </div>
  <div data-pane="conversation">
    <div data-conversation-content data-conversation-session="s1">
      <div class="center-shell">原生会话</div>
    </div>
  </div>
</body></html>`, { url: 'http://127.0.0.1:51469/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.MutationObserver = window.MutationObserver
globalThis.CustomEvent = window.CustomEvent
globalThis.Event = window.Event
globalThis.requestAnimationFrame = (fn) => window.setTimeout(fn, 0)
globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id)

const now = Date.now()
const project = {
  schema: 'dsh-aidrama/v1', id: 'p1', title: '测试短剧', createdAt: now, updatedAt: now, revision: 1,
  meta: { platform: 'douyin', orientation: 'portrait', genre: 'urban', targetEpisodes: 1, episodeSeconds: 60, audience: '', logline: '外卖员被羞辱后亮身份', theme: '', hook: '', forbidden: [], dialect: 'seedance-2.5' },
  bible: { premise: '一个外卖员', world: '', arc: '', episodePlan: '', visualDirection: '' },
  characters: [{ id: 'C01', name: '陈默', role: '主角', status: 'draft', slots: { ageGender: '32岁男', face: '', hair: '', body: '', outfit: '', accessories: '', temperament: '', forbidden: '', lightBaseline: '' }, lockText: '年龄性别：32岁男', looks: [], stateVariants: [], refs: { front: '', side: '', back: '', expression: '', main: '' }, voiceCard: { voiceId: '', ageRange: '', rate: '', baseline: '', forbidden: '' } }],
  scenes: [], props: [], styles: [],
  episodes: [{ id: 'EP001', title: '第一集', logline: '', status: 'boarded', beats: [], script: '',
    shots: [{ id: 'SHOT-EP001-001', sceneId: '', duration: 4, size: 'medium', camera: '', blocking: '', action: '推门', endState: '', emotion: { start: '', trigger: '', end: '' }, dialogue: [], sound: { ambience: '', sfx: '', music: '' }, refs: [], locks: [], status: 'draft', prompt: { dialect: '', text: '', compiledAt: 0, warnings: [] } }] }],
  decisions: [], jobs: [], ledger: [],
}
const summary = { id: 'p1', title: '测试短剧', cwd: 'C:/demo', revision: 1, updatedAt: now, episodes: 1, shots: 1, genre: 'urban', platform: 'douyin', stage: 'storyboard' }
const envelope = (value) => Promise.resolve({ ok: true, json: async () => ({ ok: true, value }) })
const calls = []

globalThis.fetch = async (url, init) => {
  const href = String(url)
  const method = init?.method ?? 'GET'
  calls.push(`${method} ${href}`)
  if (href.includes('/api/dsh-aidrama/session')) return envelope({ sessionId: 's1', cwd: 'C:/demo' })
  if (href.includes('/api/dsh-aidrama/projects')) {
    return envelope({ cwd: 'C:/demo', projectsRoot: 'C:/demo/.dsh-aidrama', projects: [summary], sessionId: 's1', boundProjectId: 'p1', stages: [] })
  }
  if (href.includes('/api/dsh-aidrama/project') && method === 'POST') return envelope({ project })
  if (href.includes('/api/dsh-aidrama/project')) return envelope({ project, stage: 'storyboard', validation: { findings: [{ ruleId: 'GEN-002', level: 'error', message: '场景不存在', shotId: 'SHOT-EP001-001' }], errors: 1, warns: 0, checkedAt: now } })
  if (href.includes('/api/dsh-aidrama/validate')) return envelope({ validation: { findings: [], errors: 0, warns: 0, checkedAt: now }, project })
  return envelope({})
}

let exportsModule
window.__ModuleLoader__ = { load: ({ factory }) => { exportsModule = factory(require) } }
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'navigator', code)(window, window.document, window.navigator)

const ctx = {
  effect: (run) => { try { run() } catch (error) { console.warn('effect failed', error) } return () => {} },
  locale: { getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
}
exportsModule.apply(ctx)

const entry = window.document.querySelector('[data-aidrama-entry]')
if (entry === null) throw new Error('侧边栏没有出现短剧入口')
entry.click()
const view = window.document.querySelector('[data-aidrama-view]')
if (view === null) throw new Error('中栏没有挂载工作台容器')
await new Promise(resolve => setTimeout(resolve, 400))

const text = view.textContent ?? ''
console.log('calls:', calls.join(' | '))
console.log('text tail:', text.slice(-700))
for (const expected of ['AI 短剧工坊', '测试短剧', 'SHOT-EP001-001', '校验', 'GEN-002']) {
  if (!text.includes(expected)) throw new Error(`渲染结果缺少「${expected}」`)
}
console.log('rendered chars =', text.length)
if (globalThis.ResizeObserver === undefined) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}
const canvasButton = [...view.querySelectorAll('button')].find(button => button.textContent?.includes('画布'))
if (canvasButton === undefined) throw new Error('阶段栏缺少「画布」')
canvasButton.click()
await new Promise(resolve => setTimeout(resolve, 400))
const canvasText = view.textContent ?? ''
for (const expected of ['整理', '3D 导演台', '备注']) {
  if (!canvasText.includes(expected)) throw new Error(`画布缺少「${expected}」`)
}
console.log('CANVAS RENDER OK')
console.log('DOM RENDER OK')
