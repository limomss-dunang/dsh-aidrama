import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import type { Project } from '../shared/types.ts'

type BoardKind = 'character' | 'scene' | 'prop' | 'shot' | 'director' | 'note' | 'group'

interface BoardNode {
  id: string
  kind: BoardKind
  refId: string
  x: number
  y: number
  w: number
  h: number
  text?: string
  dataUrl?: string
  mediaType?: 'image' | 'video'
  lookId?: string
  variantId?: string
  refPath?: string
}

interface BoardEdge {
  id: string
  from: string
  to: string
}

interface BoardDoc {
  nodes: BoardNode[]
  edges: BoardEdge[]
}

const CARD_W = 190
const CARD_H = 160
const BOARD_LEFT = 300
const BOARD_TOP = 100
const COLUMN_W = 300
const ROW_H = 360

const COLUMN_ORDER: BoardKind[] = ['character', 'scene', 'prop', 'shot', 'note', 'director']

function compactDoc(doc: BoardDoc): BoardDoc {
  const rows: Record<string, number> = {}
  return {
    ...doc,
    nodes: doc.nodes.map(node => {
      if (node.kind === 'group') return node
      const column = Math.max(0, COLUMN_ORDER.indexOf(node.kind))
      rows[node.kind] = rows[node.kind] ?? 0
      const next = { ...node, x: BOARD_LEFT + column * COLUMN_W, y: BOARD_TOP + rows[node.kind]! * ROW_H }
      rows[node.kind] = rows[node.kind]! + 1
      return next
    }),
  }
}

function overlaps(a: BoardNode, b: BoardNode): boolean {
  return a.x < b.x + b.w + 12 && b.x < a.x + a.w + 12 && a.y < b.y + b.h + 12 && b.y < a.y + a.h + 12
}

function normalizeIfOverlapping(doc: BoardDoc): BoardDoc {
  const visible = doc.nodes.filter(node => node.kind !== 'group')
  for (let index = 0; index < visible.length; index += 1) {
    for (let other = index + 1; other < visible.length; other += 1) {
      if (overlaps(visible[index]!, visible[other]!)) return compactDoc(doc)
    }
  }
  return doc
}

function storageKey(projectId: string): string {
  return `dsh-aidrama:canvas:${projectId}`
}

function readDoc(project: Project): BoardDoc | undefined {
  const persisted = project.canvas
  if (persisted !== null && typeof persisted === 'object') {
    const parsed = persisted as BoardDoc
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return normalizeIfOverlapping(parsed)
  }
  try {
    const raw = window.localStorage.getItem(storageKey(project.id))
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as BoardDoc
    return Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) ? normalizeIfOverlapping(parsed) : undefined
  } catch {
    return undefined
  }
}

function defaultDoc(project: Project): BoardDoc {
  const nodes: BoardNode[] = []
  let row = 0
  for (const character of project.characters) {
    if (character.looks.length === 0) {
      nodes.push({
        id: `character:${character.id}`,
        kind: 'character', refId: character.id,
        x: BOARD_LEFT, y: BOARD_TOP + row * ROW_H, w: CARD_W, h: CARD_H,
        text: `${character.id} ${character.name}`,
      })
      row += 1
    } else {
      for (const look of character.looks) {
        nodes.push({
          id: `character:${character.id}:look:${look.id}`,
          kind: 'character', refId: character.id, lookId: look.id,
          x: BOARD_LEFT, y: BOARD_TOP + row * ROW_H, w: CARD_W, h: CARD_H,
          text: `${character.name} · ${look.text.slice(0, 10) || look.id}`,
        })
        row += 1
      }
    }
  }
  row = 0
  for (const scene of project.scenes) {
    nodes.push({
      id: `scene:${scene.id}`,
      kind: 'scene', refId: scene.id,
      x: BOARD_LEFT + COLUMN_W, y: BOARD_TOP + row * ROW_H, w: CARD_W, h: CARD_H,
      text: scene.name,
    })
    row += 1
    for (const variant of scene.variants) {
      nodes.push({
        id: `scene:${scene.id}:variant:${variant.id}`,
        kind: 'scene', refId: scene.id, variantId: variant.id,
        x: BOARD_LEFT + COLUMN_W, y: BOARD_TOP + row * ROW_H, w: CARD_W, h: CARD_H,
        text: `${scene.name} · ${variant.change.slice(0, 10) || variant.id}`,
      })
      row += 1
    }
  }
  row = 0
  for (const prop of project.props) {
    nodes.push({
      id: `prop:${prop.id}`,
      kind: 'prop', refId: prop.id,
      x: BOARD_LEFT + 2 * COLUMN_W, y: BOARD_TOP + row * ROW_H, w: CARD_W, h: CARD_H,
      text: prop.name,
    })
    row += 1
  }
  row = 0
  for (const episode of project.episodes) {
    for (const shot of episode.shots) {
      const ref = shot.refs.find(item => item.state === 'ref' && item.path.trim() !== '')
      if (ref === undefined) continue
      nodes.push({
        id: `shotref:${shot.id}`,
        kind: 'shot', refId: shot.id, refPath: ref.path,
        x: BOARD_LEFT + 3 * COLUMN_W, y: BOARD_TOP + row * ROW_H, w: CARD_W, h: CARD_H,
        text: `${shot.id} 首帧`,
      })
      row += 1
    }
  }
  nodes.push({
    id: 'director:main',
    kind: 'director',
    refId: '',
    x: BOARD_LEFT + 4 * COLUMN_W,
    y: BOARD_TOP,
    w: 220,
    h: 160,
    text: '3D 导演台',
  })
  return { nodes, edges: [] }
}

function thumbOf(project: Project, node: BoardNode): string {
  if (node.dataUrl !== undefined && node.dataUrl !== '') return node.dataUrl
  if (node.refPath !== undefined && node.refPath !== '') return node.refPath
  if (node.kind === 'character') {
    const character = project.characters.find(c => c.id === node.refId)
    if (character === undefined) return ''
    return node.lookId === undefined
      ? character.refs.main
      : character.looks.find(look => look.id === node.lookId)?.refs.main ?? ''
  }
  if (node.kind === 'scene') return project.scenes.find(s => s.id === node.refId)?.refImage ?? ''
  if (node.kind === 'prop') return project.props.find(p => p.id === node.refId)?.refImage ?? ''
  if (node.kind === 'shot') {
    for (const episode of project.episodes) {
      const shot = episode.shots.find(item => item.id === node.refId)
      if (shot !== undefined) return shot.refs.find(ref => ref.state === 'ref' && ref.path.trim() !== '')?.path ?? ''
    }
  }
  return ''
}

/** 资产库是主数�?��画布�?��存位�?��项目新�?/删除资产时把节点补齐/清掉，不丢已有布�?�?*/
function syncDoc(project: Project, doc: BoardDoc): BoardDoc {
  const had = new Set(doc.nodes.map(node => node.id))
  const fresh = defaultDoc(project).nodes
  const nodes = doc.nodes.filter(node => {
    if (node.kind === 'character') {
      const character = project.characters.find(item => item.id === node.refId)
      if (character === undefined) return false
      if (node.lookId === undefined) return character.looks.length === 0
      return character.looks.some(look => look.id === node.lookId)
    }
    if (node.kind === 'scene') {
      const scene = project.scenes.find(item => item.id === node.refId)
      return scene !== undefined && (node.variantId === undefined || scene.variants.some(variant => variant.id === node.variantId))
    }
    if (node.kind === 'prop') return project.props.some(item => item.id === node.refId)
    if (node.kind === 'shot' && node.refPath !== undefined) {
      return project.episodes.some(episode => episode.shots.some(shot => shot.id === node.refId))
    }
    return true
  })
  for (const node of fresh) {
    if ((node.kind === 'character' || node.kind === 'scene' || node.kind === 'prop' || node.kind === 'shot') && !had.has(node.id)) {
      nodes.push(node)
    }
  }
  const ids = new Set(nodes.map(node => node.id))
  return { nodes, edges: doc.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) }
}

export function CanvasPanel(props: {
  project: Project
  imageUrl: (path: string) => string
  onOpenDirector: () => void
  busy: string
  mutate: (fn: (project: Project) => void) => void
  onGenerateImage: (target: 'character' | 'scene' | 'prop' | 'shot', id: string) => Promise<void>
  onApplyImage: (target: 'character' | 'scene', id: string, dataUrl: string) => Promise<void>
}) {
  const [doc, setDoc] = useState<BoardDoc>(() => readDoc(props.project) ?? defaultDoc(props.project))
  const [zoom, setZoom] = useState(0.8)
  const [selected, setSelected] = useState<string>()
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [noteSeq, setNoteSeq] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [gridSnap, setGridSnap] = useState(true)
  const [onlyAssets, setOnlyAssets] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryKind, setLibraryKind] = useState<'all' | 'character' | 'scene' | 'prop'>('all')
  const [menu, setMenu] = useState<{ x: number, y: number, nodeId: string }>()
  const [applyNode, setApplyNode] = useState<BoardNode>()
  const drag = useRef<{ id: string, startX: number, startY: number, nodeX: number, nodeY: number }>()
  const copiedNode = useRef<BoardNode>()

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === 'Escape') {
        setMenu(undefined)
        setConnectMode(false)
        setConnectFrom(undefined)
      }
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'c' && selected !== undefined) {
        const node = doc.nodes.find(item => item.id === selected)
        if (node !== undefined) copiedNode.current = node
      }
      if (modifier && event.key.toLowerCase() === 'v' && copiedNode.current !== undefined) {
        const source = copiedNode.current
        const node: BoardNode = { ...source, id: `${source.kind}:copy:${Date.now()}`, x: source.x + 30, y: source.y + 30 }
        save({ ...doc, nodes: [...doc.nodes, node] })
        setSelected(node.id)
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== undefined) {
        save({ ...doc, nodes: doc.nodes.filter(node => node.id !== selected), edges: doc.edges.filter(edge => edge.from !== selected && edge.to !== selected) })
        setSelected(undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, selected])

  const snap = (value: number): number => gridSnap ? Math.round(value / 24) * 24 : value

  useEffect(() => {
    setDoc(syncDoc(props.project, readDoc(props.project) ?? defaultDoc(props.project)))
    setSelected(undefined)
    setConnectFrom(undefined)
  }, [props.project.id, props.project.revision])

  const save = useCallback((next: BoardDoc) => {
    setDoc(next)
    props.mutate(project => { project.canvas = next })
    try {
      window.localStorage.setItem(storageKey(props.project.id), JSON.stringify(next))
    } catch {
      // 本地画布只是编排辅助，写入失败不能阻塞制片流程。
    }
  }, [props.mutate, props.project.id])

  const patchNode = useCallback((id: string, patch: Partial<BoardNode>) => {
    save({ ...doc, nodes: doc.nodes.map(node => node.id === id ? { ...node, ...patch } : node) })
  }, [doc, save])

  const onPointerDown = (event: React.PointerEvent, node: BoardNode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (connectMode) {
      if (connectFrom === undefined) {
        setConnectFrom(node.id)
      } else if (connectFrom !== node.id) {
        save({ ...doc, edges: [...doc.edges, { id: `e-${Date.now()}`, from: connectFrom, to: node.id }] })
        setConnectFrom(undefined)
      }
      return
    }
    setSelected(node.id)
    drag.current = { id: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y }
    setDragging(true)
    const move = (moveEvent: PointerEvent) => {
      const current = drag.current
      if (current === undefined) return
      const scale = zoom
      patchNode(current.id, {
        x: snap(Math.max(0, current.nodeX + (moveEvent.clientX - current.startX) / scale)),
        y: snap(Math.max(0, current.nodeY + (moveEvent.clientY - current.startY) / scale)),
      })
    }
    const up = () => {
      drag.current = undefined
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const compact = () => {
    save(compactDoc(doc))
  }

  const addNote = () => {
    const node: BoardNode = {
      id: `note:${Date.now()}`,
      kind: 'note',
      refId: '',
      x: BOARD_LEFT + 5 * COLUMN_W,
      y: BOARD_TOP + (noteSeq - 1) * ROW_H,
      w: 210,
      h: 120,
      text: '备注',
    }
    save({ ...doc, nodes: [...doc.nodes, node] })
    setNoteSeq(value => value + 1)
  }

  const addGroup = () => {
    const node: BoardNode = {
      id: `group:${Date.now()}`,
      kind: 'group',
      refId: '',
      x: 60,
      y: 60,
      w: 520,
      h: 360,
      text: '新分组',
    }
    save({ ...doc, nodes: [node, ...doc.nodes] })
  }

  const generateNode = async (node: BoardNode) => {
    if (node.kind === 'character' || node.kind === 'scene' || node.kind === 'prop' || node.kind === 'shot') {
      await props.onGenerateImage(node.kind, node.refId)
    }
  }

  const missingAssets = doc.nodes.filter(node =>
    (node.kind === 'character' || node.kind === 'scene' || node.kind === 'prop') && thumbOf(props.project, node) === '')
  const missingShots = doc.nodes.filter(node => node.kind === 'shot')

  const runMissing = async () => {
    if (props.busy !== '') return
    for (const node of missingAssets) await generateNode(node)
  }

  const runShots = async () => {
    if (props.busy !== '') return
    for (const node of missingShots) {
      if (thumbOf(props.project, node) === '') await generateNode(node)
    }
  }

  const nodeMenu = menu === undefined ? undefined : doc.nodes.find(node => node.id === menu.nodeId)

  const library = [
    ...props.project.characters.map(character => ({ kind: 'character' as const, id: character.id, name: character.name, sub: character.role })),
    ...props.project.scenes.map(scene => ({ kind: 'scene' as const, id: scene.id, name: scene.name, sub: scene.space })),
    ...props.project.props.map(prop => ({ kind: 'prop' as const, id: prop.id, name: prop.name, sub: prop.function })),
  ].filter(item => libraryKind === 'all' || item.kind === libraryKind)
    .filter(item => libraryQuery.trim() === '' || `${item.name}${item.sub}${item.id}`.toLowerCase().includes(libraryQuery.trim().toLowerCase()))

  const locate = (kind: 'character' | 'scene' | 'prop', id: string) => {
    const nodeId = `${kind}:${id}`
    const existing = doc.nodes.find(node => node.id === nodeId)
    if (existing !== undefined) {
      setSelected(nodeId)
      return
    }
    const source = defaultDoc(props.project).nodes.find(node => node.id === nodeId)
    if (source === undefined) return
    save({ ...doc, nodes: [...doc.nodes, source] })
    setSelected(nodeId)
  }

  const addChild = (parent: BoardNode) => {
    const child: BoardNode = {
      id: `note:${Date.now()}`,
      kind: 'note',
      refId: '',
      x: parent.x + parent.w + 80,
      y: parent.y,
      w: 200,
      h: 110,
      text: `来自 ${parent.text ?? parent.kind}`,
    }
    save({ ...doc, nodes: [...doc.nodes, child], edges: [...doc.edges, { id: `e-${Date.now()}`, from: parent.id, to: child.id }] })
  }

  const visibleNodes = useMemo(() => onlyAssets
    ? doc.nodes.filter(node => node.kind === 'character' || node.kind === 'scene' || node.kind === 'prop' || node.kind === 'director')
    : doc.nodes, [doc.nodes, onlyAssets])
  const visibleIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes])
  const edges = useMemo(() => doc.edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)).map(edge => {
    const from = doc.nodes.find(node => node.id === edge.from)
    const to = doc.nodes.find(node => node.id === edge.to)
    if (from === undefined || to === undefined) return null
    return {
      id: edge.id,
      x1: from.x + from.w,
      y1: from.y + from.h / 2,
      x2: to.x,
      y2: to.y + to.h / 2,
    }
  }).filter((edge): edge is NonNullable<typeof edge> => edge !== null), [doc, visibleIds])

  return (
    <div className="ad-canvas-wrap" style={fullscreen
      ? { position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--dsw-alias-bg-base, #101114)', overflow: 'hidden' }
      : { position: 'relative', height: 'calc(100vh - 220px)', minHeight: 520, overflow: 'hidden', borderRadius: 12, border: '1px solid color-mix(in srgb, currentColor 14%, transparent)' }}>
      <div className="ad-row" style={{ position: 'absolute', zIndex: 5, left: 12, top: 10, gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 24px)' }}>
        <button type="button" className="ad-btn" onClick={compact}>整理</button>
        <button type="button" className="ad-btn" onClick={addNote}>备注</button>
        <button type="button" className="ad-btn" onClick={addGroup}>分组</button>
        <button type="button" className="ad-btn" data-kind={connectMode ? 'primary' : undefined} onClick={() => { setConnectMode(value => !value); setConnectFrom(undefined) }}>
          {connectMode ? '点两个节点' : '连线'}
        </button>
        <button type="button" className="ad-btn" onClick={() => save(defaultDoc(props.project))}>重置布局</button>
        <button type="button" className="ad-btn" onClick={() => setFullscreen(value => !value)}>{fullscreen ? '退出全屏' : '全屏'}</button>
        <button type="button" className="ad-btn" onClick={() => setShowHelp(true)}>快捷键</button>
        <button type="button" className="ad-btn" disabled={props.busy !== '' || missingAssets.length === 0} onClick={() => { void runMissing() }}>
          补资产图{missingAssets.length > 0 ? ` ${missingAssets.length}` : ''}
        </button>
        <button type="button" className="ad-btn" disabled={props.busy !== '' || missingShots.length === 0} onClick={() => { void runShots() }}>
          补首帧
        </button>
        <button type="button" className="ad-btn" data-kind={onlyAssets ? 'primary' : undefined} onClick={() => setOnlyAssets(value => !value)}>只看资产</button>
        <button type="button" className="ad-btn" data-kind={gridSnap ? 'primary' : undefined} onClick={() => setGridSnap(value => !value)}>吸附</button>
        <span className="ad-tiny ad-muted" style={{ alignSelf: 'center' }}>{Math.round(zoom * 100)}% · {doc.nodes.length} 节点</span>
      </div>
      {libraryOpen ? (
        <div className="ad-card" style={{ position: 'absolute', zIndex: 6, left: 12, top: 54, width: 210, maxHeight: 'calc(100% - 120px)', display: 'flex', flexDirection: 'column', padding: 8, gap: 6 }}>
          <div className="ad-row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: 12 }}>资产库</b>
            <button type="button" className="ad-btn" style={{ height: 22, padding: '0 6px', fontSize: 11 }} onClick={() => setLibraryOpen(false)}>收起</button>
          </div>
          <div className="ad-row" style={{ gap: 3, flexWrap: 'wrap' }}>
            {([['all', '全部'], ['character', '角色'], ['scene', '场景'], ['prop', '道具']] as const).map(([kind, label]) => (
              <button key={kind} type="button" className="ad-btn" data-kind={libraryKind === kind ? 'primary' : undefined}
                style={{ height: 24, padding: '0 7px', fontSize: 11 }}
                onClick={() => setLibraryKind(kind)}>{label}</button>
            ))}
          </div>
          <input className="ad-input" style={{ height: 28 }} placeholder="搜索角色/场景/道具" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} />
          <div className="ad-col" style={{ gap: 3, overflow: 'auto', minHeight: 0 }}>
            {library.map((item, index) => {
              const node = doc.nodes.find(entry => entry.id === `${item.kind}:${item.id}`)
              const thumb = node === undefined ? '' : thumbOf(props.project, node)
              return (
                <button key={`${item.kind}:${item.id}`} type="button" className="ad-btn"
                  data-kind={selected === `${item.kind}:${item.id}` ? 'primary' : undefined}
                  style={{ justifyContent: 'flex-start', height: 40, gap: 7, padding: '3px 6px', textAlign: 'left' }}
                  onClick={() => locate(item.kind, item.id)}>
                  <span style={{ width: 28, height: 32, borderRadius: 4, overflow: 'hidden', background: 'color-mix(in srgb, currentColor 8%, transparent)', flex: 'none', display: 'grid', placeItems: 'center' }}>
                    {thumb === '' ? <span className="ad-tiny" style={{ opacity: .5 }}>{String(index + 1).padStart(2, '0')}</span> : <img src={props.imageUrl(thumb)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{item.name}</span>
                    <span className="ad-tiny" style={{ display: 'block', opacity: .55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.kind} · {item.sub}</span>
                  </span>
                </button>
              )
            })}
            {library.length === 0 ? <span className="ad-tiny ad-muted">没有匹配资产</span> : null}
          </div>
        </div>
      ) : (
        <button type="button" className="ad-btn" style={{ position: 'absolute', zIndex: 6, left: 12, top: 54 }} onClick={() => setLibraryOpen(true)}>资产库</button>
      )}
      {props.project.characters.length + props.project.scenes.length + props.project.props.length === 0 ? (
        <div style={{ position: 'absolute', inset: 0, zIndex: 4, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div className="ad-card" style={{ padding: 16, maxWidth: 320, textAlign: 'center' }}>
            <b style={{ fontSize: 13 }}>还没有资产</b>
            <p className="ad-tiny ad-muted" style={{ margin: '6px 0 0' }}>先导入剧本或生成角色/场景/道具，画布会自动建立节点。</p>
          </div>
        </div>
      ) : null}
      <TransformWrapper
        initialScale={0.8}
        minScale={0.2}
        maxScale={2}
        centerOnInit
        panning={{ disabled: dragging }}
        onZoom={ref => setZoom(ref.state.scale)}
      >
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: 1900, height: 2400 }}>
          <div style={{ position: 'relative', width: 1700, height: 1400, backgroundImage: 'radial-gradient(circle at 1px 1px, color-mix(in srgb, currentColor 18%, transparent) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              <defs>
                <marker id="ad-canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="currentColor" opacity="0.55" />
                </marker>
              </defs>
              {edges.map(edge => (
                <line key={edge.id} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" markerEnd="url(#ad-canvas-arrow)" />
              ))}
            </svg>
            {visibleNodes.map(node => {
              const thumb = thumbOf(props.project, node)
              return (
                <div
                  key={node.id}
                  onPointerDown={event => onPointerDown(event, node)}
                  onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setSelected(node.id); setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }) }}
                  style={{
                    position: 'absolute', left: node.x, top: node.y, width: node.w, height: node.h,
                    overflow: 'hidden',
                    borderRadius: 10, border: selected === node.id ? '1px solid var(--dsw-alias-interactive-primary, #4f8cff)' : '1px solid color-mix(in srgb, currentColor 18%, transparent)',
                    background: 'var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 6%, transparent))',
                    boxShadow: selected === node.id ? '0 0 0 2px color-mix(in srgb, #4f8cff 30%, transparent)' : '0 3px 12px rgba(0,0,0,.12)',
                    cursor: 'grab', userSelect: 'none',
                  }}
                >
                  <span title="输入/引用" style={{ position: 'absolute', left: -6, top: '50%', width: 10, height: 10, marginTop: -5, borderRadius: 5, background: 'var(--dsw-alias-bg-base, #14161c)', border: '1px solid color-mix(in srgb, currentColor 45%, transparent)' }} />
                  <span title="输出/被引用" style={{ position: 'absolute', right: -6, top: '50%', width: 10, height: 10, marginTop: -5, borderRadius: 5, background: 'var(--dsw-alias-bg-base, #14161c)', border: '1px solid color-mix(in srgb, currentColor 45%, transparent)' }} />
                  <div style={{ padding: '7px 9px 5px', display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                    <b style={{ fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', opacity: .65 }}>{node.kind}</b>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span className="ad-tiny" style={{ opacity: .6 }}>{node.refId || (node.kind === 'director' ? '3D' : '')}</span>
                      <button type="button" className="ad-btn" title="在右侧新建并连线" style={{ height: 20, padding: '0 5px', fontSize: 12 }}
                        onClick={event => { event.stopPropagation(); addChild(node) }}>＋</button>
                    </span>
                  </div>
                  {node.kind === 'group' ? (
                    <div style={{ padding: '0 10px 10px' }}>
                      <input value={node.text ?? ''} onChange={event => patchNode(node.id, { text: event.target.value })}
                        onClick={event => event.stopPropagation()}
                        style={{ width: '100%', background: 'transparent', color: 'inherit', border: '1px dashed color-mix(in srgb, currentColor 22%, transparent)', borderRadius: 6, padding: '6px 8px', fontSize: 14, fontWeight: 600 }} />
                      <div className="ad-tiny ad-muted" style={{ marginTop: 6 }}>拖到节点背后作为分组框；节点可叠放在里面</div>
                    </div>
                  ) : node.kind === 'director' ? (
                    <div style={{ padding: '0 10px 10px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{node.text}</div>
                      <div className="ad-tiny ad-muted" style={{ marginBottom: 8 }}>灰盒站位 · 机位 · 构图参考</div>
                      <button type="button" className="ad-btn" data-kind="primary" onClick={event => { event.stopPropagation(); props.onOpenDirector() }}>打开导演台</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ height: 78, background: 'color-mix(in srgb, currentColor 5%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {thumb === '' ? <span className="ad-tiny ad-muted">无参考图</span> : node.mediaType === 'video'
                          ? <video src={node.dataUrl} muted loop playsInline controls={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <img src={props.imageUrl(thumb)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </div>
                      <div style={{ padding: '6px 9px 8px', fontSize: 12, lineHeight: 1.35 }}>{node.text}</div>
                    </>
                  )}
                  {node.kind === 'note' ? (
                    <textarea
                      value={node.text ?? ''}
                      onChange={event => patchNode(node.id, { text: event.target.value })}
                      style={{ width: 'calc(100% - 18px)', margin: '0 9px 9px', minHeight: 56, resize: 'vertical', background: 'transparent', color: 'inherit', border: '1px solid color-mix(in srgb, currentColor 16%, transparent)', borderRadius: 6, padding: 6, fontSize: 12 }}
                    />
                  ) : null}
                  {selected === node.id ? (
                    <button type="button" className="ad-btn" style={{ position: 'absolute', right: 6, top: 26, padding: '1px 6px', fontSize: 11 }}
                      onClick={event => { event.stopPropagation(); save({ ...doc, nodes: doc.nodes.filter(item => item.id !== node.id), edges: doc.edges.filter(edge => edge.from !== node.id && edge.to !== node.id) }) }}>×</button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </TransformComponent>
      </TransformWrapper>
      {nodeMenu !== undefined && menu !== undefined ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenu(undefined)} />
          <div className="ad-card" style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 220), width: 180, zIndex: 21, padding: 6, display: 'grid', gap: 3 }}>
            <div className="ad-tiny ad-muted" style={{ padding: '2px 6px' }}>{nodeMenu.kind} · {nodeMenu.text || nodeMenu.refId}</div>
            {nodeMenu.kind === 'character' || nodeMenu.kind === 'scene' || nodeMenu.kind === 'prop' ? (
              <button type="button" className="ad-btn" onClick={() => {
                const name = nodeMenu.kind === 'character'
                  ? props.project.characters.find(item => item.id === nodeMenu.refId)?.name
                  : nodeMenu.kind === 'scene'
                    ? props.project.scenes.find(item => item.id === nodeMenu.refId)?.name
                    : props.project.props.find(item => item.id === nodeMenu.refId)?.name
                if (name !== undefined) void navigator.clipboard?.writeText(`@${name}`)
                setMenu(undefined)
              }}>复制 @ 引用</button>
            ) : null}
            {nodeMenu.dataUrl !== undefined && nodeMenu.mediaType !== 'video' ? (
              <button type="button" className="ad-btn" onClick={() => { setMenu(undefined); setApplyNode(nodeMenu) }}>应用到角色/场景…</button>
            ) : null}
            {nodeMenu.kind !== 'note' && nodeMenu.kind !== 'director' ? (
              <button type="button" className="ad-btn" onClick={() => { setMenu(undefined); void generateNode(nodeMenu) }}>{thumbOf(props.project, nodeMenu) === '' ? '生成参考图' : '重抽参考图'}</button>
            ) : null}
            {nodeMenu.kind === 'director' ? <button type="button" className="ad-btn" onClick={() => { setMenu(undefined); props.onOpenDirector() }}>打开 3D 导演台</button> : null}
            <button type="button" className="ad-btn" onClick={() => { setMenu(undefined); addChild(nodeMenu) }}>右侧新建并连线</button>
            <button type="button" className="ad-btn" onClick={() => { setMenu(undefined); setConnectMode(true); setConnectFrom(nodeMenu.id) }}>从这里连线</button>
            <button type="button" className="ad-btn" onClick={() => { setMenu(undefined); save({ ...doc, nodes: doc.nodes.filter(node => node.id !== nodeMenu.id), edges: doc.edges.filter(edge => edge.from !== nodeMenu.id && edge.to !== nodeMenu.id) }) }}>删除节点</button>
          </div>
        </>
      ) : null}
      <div className="ad-card" style={{ position: 'absolute', right: 12, bottom: 12, width: 168, height: 110, padding: 6, opacity: .85, zIndex: 4 }}>
        <svg width="156" height="96" viewBox="0 0 156 96">
          <rect x="0" y="0" width="156" height="96" fill="none" stroke="currentColor" strokeOpacity=".15" />
          {visibleNodes.map(node => {
            const maxX = Math.max(1200, ...visibleNodes.map(item => item.x + item.w))
            const maxY = Math.max(900, ...visibleNodes.map(item => item.y + item.h))
            return <rect key={node.id} x={(node.x / maxX) * 156} y={(node.y / maxY) * 96} width={Math.max(3, (node.w / maxX) * 156)} height={Math.max(3, (node.h / maxY) * 96)} rx="1" fill={selected === node.id ? '#4f8cff' : 'currentColor'} opacity={selected === node.id ? .9 : .42} />
          })}
        </svg>
      </div>
      {connectMode ? <div className="ad-tiny" style={{ position: 'absolute', left: 14, bottom: 10, padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,.55)', color: '#fff' }}>连线模式：点两个节点</div> : null}
      {applyNode !== undefined ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 41, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center' }} onClick={() => setApplyNode(undefined)}>
          <div className="ad-card" style={{ width: 420, maxWidth: 'calc(100% - 32px)', padding: 16 }} onClick={event => event.stopPropagation()}>
            <div className="ad-row" style={{ justifyContent: 'space-between' }}>
              <h3 className="ad-h2" style={{ margin: 0 }}>应用图片到</h3>
              <button type="button" className="ad-btn" onClick={() => setApplyNode(undefined)}>关闭</button>
            </div>
            <p className="ad-tiny ad-muted">选择角色或场景，会覆盖其主参考图。</p>
            <div className="ad-col" style={{ gap: 4, maxHeight: 320, overflow: 'auto' }}>
              {props.project.characters.map(character => (
                <button key={character.id} type="button" className="ad-btn" onClick={() => { const data = applyNode.dataUrl; setApplyNode(undefined); if (data !== undefined) void props.onApplyImage('character', character.id, data) }}>
                  角色 · {character.id} {character.name}
                </button>
              ))}
              {props.project.scenes.map(scene => (
                <button key={scene.id} type="button" className="ad-btn" onClick={() => { const data = applyNode.dataUrl; setApplyNode(undefined); if (data !== undefined) void props.onApplyImage('scene', scene.id, data) }}>
                  场景 · {scene.id} {scene.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {showHelp ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center' }} onClick={() => setShowHelp(false)}>
          <div className="ad-card" style={{ width: 420, maxWidth: 'calc(100% - 32px)', padding: 18 }} onClick={event => event.stopPropagation()}>
            <div className="ad-row" style={{ justifyContent: 'space-between' }}>
              <h3 className="ad-h2" style={{ margin: 0 }}>画布快捷键与操作</h3>
              <button type="button" className="ad-btn" onClick={() => setShowHelp(false)}>关闭</button>
            </div>
            <div className="ad-col ad-tiny" style={{ marginTop: 10, gap: 7 }}>
              <div><b>拖动节点</b>：鼠标按住卡片拖动，开启吸附后按网格对齐</div>
              <div><b>连线</b>：点「连线」→ 点起点 → 点终点</div>
              <div><b>复制 / 粘贴</b>：Ctrl/Cmd+C、Ctrl/Cmd+V</div>
              <div><b>删除</b>：Delete 或 Backspace</div>
              <div><b>全屏 / 退出</b>：全屏按钮，Esc 退出</div>
              <div><b>右键</b>：生成/重抽、复制 @引用、右侧新建、删除</div>
              <div><b>资产库</b>：搜索、类型筛选、点击定位节点</div>
              <div><b>小地图</b>：右下角，深色块为当前选中节点</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


