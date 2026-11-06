/**
 * 客户端挂载冒烟（空状态）：jsdom 里搭一个最小 DSH 壳，加载打包后的
 * lib/client.js，确认侧边栏入口出现、点击后中栏接管并渲染空状态。
 *
 * 用法：node scripts/render-test.mjs
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
    <div data-conversation-content data-conversation-session="session-test">
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

globalThis.fetch = async (url) => {
  const href = String(url)
  const value = href.includes('/api/dsh-aidrama/session')
    ? { sessionId: 'session-test', cwd: 'C:/demo' }
    : href.includes('/api/dsh-aidrama/projects')
      ? { cwd: 'C:/demo', projectsRoot: 'C:/demo/.dsh-aidrama', projects: [], sessionId: 'session-test', stages: [] }
      : {}
  return { ok: true, json: async () => ({ ok: true, value }) }
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
if (entry.textContent !== '短剧') throw new Error(`入口文案不对：${entry.textContent}`)
const view = window.document.querySelector('[data-aidrama-view]')
if (view === null) throw new Error('中栏没有挂载工作台容器')
entry.click()
if (!window.document.documentElement.hasAttribute('data-aidrama-active')) throw new Error('点击后没有设置 active 属性')
await new Promise(resolve => setTimeout(resolve, 200))
const text = view.textContent ?? ''
for (const expected of ['AI 短剧工坊', '还没有短剧项目', '新建项目']) {
  if (!text.includes(expected)) throw new Error(`空状态缺少「${expected}」：${text.slice(0, 300)}`)
}
console.log('entry =', entry.textContent, '| active =', window.document.documentElement.hasAttribute('data-aidrama-active'))
console.log('rendered chars =', text.length)
console.log('MOUNT OK')
