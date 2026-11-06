/** 共享的小控件与纯函数（避免每个面板重复）。 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Finding, Project } from '../shared/types.ts'
import { tt } from './locale.ts'

export type Mutate = (fn: (draft: Project) => void) => void
export type Toast = { kind: 'ok' | 'error' | 'info', text: string }
export type AssetKind = 'character' | 'scene' | 'prop' | 'style'
export type Selection = { kind: AssetKind, id: string } | { kind: 'shot', id: string } | undefined

export const PLATFORM_LABEL: Record<string, string> = {
  douyin: '抖音', kuaishou: '快手', wechat: '视频号', xiaohongshu: '小红书', youtube: 'YouTube Shorts',
}

export const GENRE_LABEL: Record<string, string> = {
  urban: '都市逆袭', costume: '古装权谋', xianxia: '仙侠武侠', suspense: '悬疑惊悚',
  scifi: '科幻赛博', realism: '现实主义', family: '家庭情感', sweet: '甜宠', comedy: '喜剧',
}

export const SIZE_OPTIONS = ['establishing', 'wide', 'medium', 'close', 'extreme-close']
export const BEAT_FUNCTIONS = ['hook', 'goal', 'obstacle', 'twist', 'choice', 'cliff']
export const BEAT_FUNCTION_LABELS: Record<string, string> = {
  hook: '钩子',
  goal: '目标',
  obstacle: '阻碍',
  twist: '反转',
  choice: '选择',
  cliff: '悬念',
}
export const REF_STATES = ['ref', 'plan', 'missing', 't2v']
export const REF_ROLES = ['identity', 'look', 'geo', 'composition', 'scale', 'effect', 'first', 'last', 'style']
export const PROP_FUNCTIONS = ['evidence', 'identity', 'countdown', 'keepsake', 'obstacle']

export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

export function errorOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function Btn(props: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
}) {
  // 主按钮不依赖主题的 brand token（桌面端深色主题里它可能解析成白色），
  // 固定用可读性确定的蓝底白字。
  const style = props.kind === 'primary'
    ? { background: '#3b6ef6', color: '#ffffff', borderColor: 'transparent' }
    : props.kind === 'danger'
      ? { color: '#ff6b6b' }
      : undefined
  return (
    <button type="button" className="ad-btn" data-kind={props.kind} onClick={props.onClick}
      disabled={props.disabled ?? false} title={props.title} style={style}>
      {props.children}
    </button>
  )
}

export function Field(props: { label: string, children: ReactNode }) {
  return <label className="ad-label"><span>{props.label}</span>{props.children}</label>
}

export function Input(props: { value: string, onChange: (value: string) => void, placeholder?: string, disabled?: boolean }) {
  return <input className="ad-input" value={props.value} placeholder={props.placeholder} disabled={props.disabled ?? false}
    onChange={event => props.onChange(event.target.value)} />
}

export function Area(props: { value: string, onChange: (value: string) => void, rows?: number, placeholder?: string, disabled?: boolean }) {
  return <textarea className="ad-textarea" style={{ minHeight: `${(props.rows ?? 3) * 22}px` }} value={props.value}
    placeholder={props.placeholder} disabled={props.disabled ?? false}
    onChange={event => props.onChange(event.target.value)} />
}

export function Select(props: { value: string, options: Array<{ value: string, label: string }>, onChange: (value: string) => void }) {
  return (
    <select className="ad-select" value={props.value} onChange={event => props.onChange(event.target.value)}
      style={{
        colorScheme: 'dark',
        minWidth: 120,
        background: 'var(--dsw-alias-bg-layer-2, #2a2a2a)',
        color: 'var(--dsw-alias-label-primary, #f5f5f5)',
      }}>
      {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

/** 点击图片打开全屏预览；再点背景或右上角关闭。 */
export function ZoomImage(props: { src: string, alt: string, style?: CSSProperties, className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <img className={props.className} src={props.src} alt={props.alt}
        style={{ cursor: 'zoom-in', ...props.style }} onClick={() => setOpen(true)} />
      {open ? (
        <div role="dialog" aria-label={props.alt}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setOpen(false)}>
          <button type="button" aria-label="关闭预览" onClick={() => setOpen(false)}
            style={{ position: 'fixed', top: 18, right: 24, fontSize: 28, lineHeight: 1, color: '#fff', background: 'transparent', border: 0, cursor: 'pointer' }}>×</button>
          <img src={props.src} alt={props.alt}
            style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', cursor: 'zoom-out', boxShadow: '0 8px 40px rgba(0,0,0,.6)' }}
            onClick={event => { event.stopPropagation(); setOpen(false) }} />
        </div>
      ) : null}
    </>
  )
}

export function Badge(props: { level?: 'error' | 'warn' | 'ok' | 'info', children: ReactNode }) {
  return <span className="ad-badge" data-level={props.level ?? 'info'}>{props.children}</span>
}

export function SectionTitle(props: { title: string, hint?: string, actions?: ReactNode }) {
  return (
    <div className="ad-row" style={{ marginBottom: 10 }}>
      <div>
        <h2 className="ad-h1">{props.title}</h2>
        {props.hint === undefined ? null : <p className="ad-sub" style={{ marginBottom: 0 }}>{props.hint}</p>}
      </div>
      <div className="ad-spacer" />
      {props.actions}
    </div>
  )
}

export function Findings(props: { findings: Finding[], onSelect?: (finding: Finding) => void }) {
  if (props.findings.length === 0) return <p className="ad-muted">{tt('noFindings')}</p>
  return (
    <div className="ad-findings">
      {props.findings.map((finding, index) => (
        <div key={`${finding.ruleId}-${index}`} className="ad-finding" data-level={finding.level}
          style={props.onSelect === undefined ? undefined : { cursor: 'pointer' }}
          onClick={() => props.onSelect?.(finding)}>
          <Badge level={finding.level}>{finding.level}</Badge>
          <div style={{ minWidth: 0 }}>
            <div><span className="ad-rule">{finding.ruleId}</span> {finding.message}</div>
            {finding.shotId === undefined ? null : <div className="ad-tiny ad-muted">{finding.episodeId} · {finding.shotId}{finding.field === undefined ? '' : ` · ${finding.field}`}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function renderLock(character: Project['characters'][number]): string {
  const s = character.slots
  return [
    s.ageGender && `年龄性别：${s.ageGender}`,
    s.face && `脸型五官：${s.face}`,
    s.hair && `发型发色：${s.hair}`,
    s.body && `体型身高：${s.body}`,
    s.outfit && `服装：${s.outfit}`,
    s.accessories && `配饰：${s.accessories}`,
    s.temperament && `气质：${s.temperament}`,
    s.forbidden && `禁改：${s.forbidden}`,
    s.lightBaseline && `光线基准：${s.lightBaseline}`,
  ].filter((item): item is string => typeof item === 'string' && item !== '').join('；')
}
