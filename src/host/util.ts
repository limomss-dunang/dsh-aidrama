/** 小工具：类型收窄、错误文案、ID 生成。 */

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function nowStamp(): string {
  const d = new Date()
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function newId(prefix: string): string {
  return `${prefix}-${nowStamp()}-${Math.random().toString(36).slice(2, 6)}`
}

/** 项目目录只接受安全 id，防止路径穿越。 */
export function safeProjectId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/.test(id)
}

export function safeEpisodeId(id: string): boolean {
  return /^EP\d{1,4}$/.test(id)
}

/** 把任意标题压成稳定的 Slug（保留中文会带来路径问题，这里只用时间 + 随机）。 */
export function projectSlug(): string {
  return `drama-${nowStamp()}-${Math.random().toString(36).slice(2, 6)}`
}
