/**
 * 挂载点：侧边栏入口（会话 / 短剧）+ 中栏工作台接管。
 *
 * 与 dsh-video-replica / dsh-imagegen 一致：中栏是单占用区（ui-conversation
 * 独占），外部插件无法声明 slot，所以在 DOM 层接管——往中栏追加一个 React
 * 容器，用 `<html data-aidrama-active>` 标识隐藏原生会话视图。会话子树保持
 * 挂载，切回来状态不丢。
 *
 * 当前会话 id 从 `[data-conversation-content][data-conversation-session]` 读取；
 * 打开面板时读一次，用户切会话时由 shell 点击关闭面板，下次打开重新读。
 */

import { createRoot, type Root } from 'react-dom/client'
import { DramaApi } from './api.ts'
import { Workbench } from './Workbench.tsx'
import { tt } from './locale.ts'
import { ACTIVE_ATTR, ENTRY_ATTR, ENTRY_HOST_ATTR, VIEW_SELECTOR, shellStyle } from './styles.ts'

const CENTER_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const SIDEBAR_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"], [class*="dshDesktopSidebarSurface"], [class*="dshDesktopUpstreamSidebar"]'
const NEW_SESSION_SELECTOR = 'button[data-dsh-part="new-session"], button[class*="newSession"]'
const IMAGEGEN_TABS_SELECTOR = '[data-dsh-imagegen-session-tabs]'
const COMMENTARY_HOST_SELECTOR = '[data-dsh-commentary-entry-host]'
const PANEL_EVENT = 'dsh-panel-activate'
const OTHER_ACTIVE_ATTRS = [
  'data-dvr-active', 'data-dsh-imagegen-active', 'data-dsh-brainstorm-active',
  'data-dsh-commentary-active', 'data-dsh-ssh-active', 'data-dsh-taskboard-active',
]

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2"/><path d="M1.8 5.6h12.4M5.5 2.6v3M10.5 2.6v3"/><path d="M5 8.2h3M5 10.6h6M10 8.2h1"/></svg>'

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  return root.querySelector<HTMLButtonElement>(NEW_SESSION_SELECTOR)
    ?? [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
      /new session|new chat|新会话|新建会话|新对话|新话题/i.test(`${button.getAttribute('aria-label')} ${button.title} ${button.textContent}`))
}

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR)
  if (column === null) return undefined
  const logo = column.querySelector<HTMLElement>('[class*="logoRow"]')
  for (let candidate = logo?.parentElement; candidate !== null && candidate !== undefined && candidate !== document.body; candidate = candidate.parentElement) {
    if (newSessionButton(candidate) !== undefined) return candidate
    if (candidate === column) break
  }
  return (column.firstElementChild as HTMLElement | null) ?? column
}

function centerColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CENTER_SELECTOR) ?? undefined
}

/** 主会话的 sessionId；排除右侧栏里的 subagent 会话。 */
function currentSessionId(): string | undefined {
  const main = document.querySelector<HTMLElement>('[data-conversation-content][data-conversation-session]:not([data-sidebar-chat] *)')
  const id = main?.getAttribute('data-conversation-session')
  if (typeof id === 'string' && id !== '') return id
  const any = document.querySelector<HTMLElement>('[data-conversation-session]')
  const fallback = any?.getAttribute('data-conversation-session')
  return typeof fallback === 'string' && fallback !== '' ? fallback : undefined
}

function makeEntry(onOpen: () => void): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.aidramaEntry = ''
  entry.title = tt('navTip')
  entry.setAttribute('aria-label', tt('nav'))
  // 与 dsh-video-replica 的侧边栏入口同款：透明底、次要文字色、无边框；
  // 不使用强调色，避免在插件 tab 里显得突兀。
  entry.style.setProperty('display', 'inline-flex', 'important')
  entry.style.setProperty('align-items', 'center', 'important')
  entry.style.setProperty('justify-content', 'center', 'important')
  entry.style.setProperty('gap', '6px', 'important')
  entry.style.setProperty('height', '30px', 'important')
  entry.style.setProperty('padding', '0 8px', 'important')
  entry.style.setProperty('border-radius', '8px', 'important')
  entry.style.setProperty('border', '0', 'important')
  entry.style.setProperty('background', 'transparent', 'important')
  entry.style.setProperty('color', 'var(--dsw-alias-label-secondary, #b8b8b8)', 'important')
  entry.style.setProperty('-webkit-text-fill-color', 'currentColor', 'important')
  entry.style.setProperty('font-size', '12px', 'important')
  entry.style.setProperty('font-weight', '400', 'important')
  entry.style.setProperty('white-space', 'nowrap', 'important')
  entry.innerHTML = `<span class="ad-entry-icon" style="display:flex;flex:none;color:currentColor">${ICON}</span><span class="ad-entry-label" style="color:inherit">${tt('nav')}</span>`
  entry.addEventListener('click', onOpen)
  return entry
}

export function mountWorkbench(api: DramaApi, pickDirectory?: () => Promise<string | null>): () => void {
  let open = false
  let root: Root | undefined
  let view: HTMLDivElement | undefined
  let column: HTMLElement | undefined
  let sidebar: HTMLElement | undefined
  let entry: HTMLButtonElement | undefined
  let entryHost: HTMLDivElement | undefined
  let sessionId: string | undefined

  const style = document.createElement('style')
  style.dataset.aidramaStyles = ''
  style.textContent = shellStyle()
  document.head.append(style)

  const render = (): void => {
    if (root === undefined) return
    root.render(<Workbench sessionId={sessionId} pickDirectory={pickDirectory} />)
  }

  const syncEntry = (): void => {
    if (entry === undefined) return
    entry.toggleAttribute('data-active', open)
    entry.setAttribute('aria-pressed', String(open))
    entry.title = open ? tt('sessionTip') : tt('navTip')
    entry.setAttribute('aria-label', tt('nav'))
    entry.style.setProperty('background', open ? 'rgba(127,127,127,.16)' : 'transparent', 'important')
    entry.style.setProperty('color', 'var(--dsw-alias-label-secondary, #b8b8b8)', 'important')
    entry.style.setProperty('font-weight', open ? '600' : '400', 'important')
    const label = entry.querySelector('.ad-entry-label')
    if (label !== null) {
      label.textContent = tt('nav')
      ;(label as HTMLElement).style.setProperty('color', 'inherit', 'important')
    }
  }

  const readSession = (attempt = 0): void => {
    const id = currentSessionId()
    if (id !== undefined) {
      if (sessionId !== id) {
        sessionId = id
        render()
      }
      return
    }
    // 刚切到工作台时原生会话可能还在挂载，短轮询几次；读不到就显示空状态。
    if (open && attempt < 6) window.setTimeout(() => readSession(attempt + 1), 200)
  }

  function setOpen(next: boolean): void {
    if (open === next) return
    if (next) {
      // 中栏同一时刻只给一个插件面板：先把别的面板请回会话视图。
      if (document.documentElement.hasAttribute('data-dsh-imagegen-active')) {
        document.querySelector<HTMLButtonElement>('[data-dsh-imagegen-tab="session"]')?.click()
      }
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      sessionId = currentSessionId()
      document.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: 'aidrama' }))
    }
    open = next
    document.documentElement.toggleAttribute(ACTIVE_ATTR, open)
    syncEntry()
    render()
    if (open) readSession()
  }

  const placeEntry = (): void => {
    if (sidebar === undefined || !sidebar.isConnected) sidebar = sidebarRoot()
    if (sidebar === undefined) return
    const sharedTabs = sidebar.querySelector<HTMLElement>(IMAGEGEN_TABS_SELECTOR)
    const commentary = sidebar.querySelector<HTMLElement>(COMMENTARY_HOST_SELECTOR)
    const target = sharedTabs ?? commentary

    if (target !== null) {
      if (entry !== undefined && entry.parentElement === target) return
      entry?.remove()
      entryHost?.remove()
      entryHost = undefined
      entry = makeEntry(() => setOpen(true))
      target.append(entry)
      syncEntry()
      return
    }

    const native = newSessionButton(sidebar)
    if (native === undefined) return
    if (entryHost !== undefined && entryHost.isConnected && entryHost.parentElement === native.parentElement) return
    entry?.remove()
    entryHost?.remove()
    entryHost = document.createElement('div')
    entryHost.dataset.aidramaEntryHost = ''
    const session = document.createElement('button')
    session.type = 'button'
    session.textContent = tt('session')
    session.title = tt('sessionTip')
    session.style.setProperty('color', 'var(--dsw-alias-label-secondary, #b8b8b8)', 'important')
    session.style.setProperty('-webkit-text-fill-color', 'currentColor', 'important')
    session.style.setProperty('background', 'transparent', 'important')
    session.style.setProperty('border', '0', 'important')
    session.style.setProperty('height', '30px', 'important')
    session.style.setProperty('padding', '0 8px', 'important')
    session.style.setProperty('border-radius', '8px', 'important')
    session.style.setProperty('font-size', '12px', 'important')
    session.addEventListener('click', () => setOpen(false))
    entry = makeEntry(() => setOpen(true))
    entryHost.append(session, entry)
    native.before(entryHost)
    syncEntry()
  }

  const ensure = (): void => {
    placeEntry()
    if (view !== undefined && !view.isConnected) {
      root?.unmount()
      root = undefined
      view = undefined
      column = undefined
    }
    column ??= centerColumn()
    if (column !== undefined && view === undefined) {
      view = document.createElement('div')
      view.dataset.aidramaView = ''
      column.append(view)
      root = createRoot(view)
      render()
    }
    // 重启后会话 DOM 可能晚于插件挂载；持续观察，读到 session 后自动切回该项目的列表。
    if (open) readSession()
  }

  const observer = new MutationObserver(ensure)
  const onActivate = (event: Event): void => {
    if ((event as CustomEvent).detail !== 'aidrama') setOpen(false)
  }
  const onShellClick = (event: MouseEvent): void => {
    if (!open || !(event.target instanceof Element)) return
    if (event.target.closest([
      '[data-dsh-imagegen-tab="session"]',
      '[data-dsh-commentary-entry-host] > button:first-child',
      '[class*="sessionRow"]',
      '[class*="projectRow"]',
      '[class*="searchResultRow"]',
      '[class*="searchResultWorkspace"]',
      '[data-dsh-part="new-session"]',
      '[class*="newSession"]',
    ].join(', ')) !== null) {
      setOpen(false)
    }
  }

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session'] })
  document.addEventListener(PANEL_EVENT, onActivate)
  document.addEventListener('click', onShellClick, true)
  ensure()

  return () => {
    observer.disconnect()
    document.removeEventListener(PANEL_EVENT, onActivate)
    document.removeEventListener('click', onShellClick, true)
    root?.unmount()
    view?.remove()
    entry?.remove()
    entryHost?.remove()
    style.remove()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
  }
}

export const __viewSelector = VIEW_SELECTOR
export const __entryAttr = ENTRY_ATTR
export const __entryHostAttr = ENTRY_HOST_ATTR
