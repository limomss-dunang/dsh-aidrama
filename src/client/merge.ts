/**
 * 客户端三方合并：base=请求前项目，server=服务端操作结果，local=请求期间继续编辑的草稿。
 *
 * 目标不是做完整 CRDT，而是保证：
 * - 服务端本次操作产生的字段（媒体引用、job、ledger、生成内容）不会因为本地无关编辑而丢失；
 * - 用户请求期间的本地编辑优先；
 * - 同字段双向修改计数为冲突，交给 UI 提示“以本地为准”。
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => equal(item, b[index]))
  }
  if (typeof a === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) if (!equal(left[key], right[key])) return false
    return true
  }
  return false
}

function arrayKey(value: unknown, index: number): string {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string' && record.id !== '') return `id:${record.id}`
    if (typeof record.slot === 'string' && record.slot !== '') return `slot:${record.slot}`
    if (typeof record.at === 'number') return `at:${record.at}:${String(record.event ?? '')}:${String(record.shotId ?? '')}`
  }
  return `index:${index}`
}

function mergeArray(base: unknown[], server: unknown[], local: unknown[], stats: { conflicts: number }): unknown[] {
  if (!base.every(item => item !== null && typeof item === 'object') || !server.every(item => item !== null && typeof item === 'object') || !local.every(item => item !== null && typeof item === 'object')) {
    if (base.length === server.length && base.length === local.length) {
      return base.map((item, index) => mergeValue(item, server[index], local[index], stats))
    }
    stats.conflicts += 1
    return local
  }
  const baseMap = new Map(base.map((item, index) => [arrayKey(item, index), item]))
  const serverMap = new Map(server.map((item, index) => [arrayKey(item, index), item]))
  const result = new Map<string, unknown>(local.map((item, index) => [arrayKey(item, index), item]))
  for (const [key, baseItem] of baseMap) {
    if (!serverMap.has(key) && result.has(key) && equal(baseItem, result.get(key))) result.delete(key)
  }
  for (const [key, serverItem] of serverMap) {
    const localItem = result.get(key)
    const baseItem = baseMap.get(key)
    if (localItem === undefined) {
      result.set(key, serverItem)
    } else if (baseItem === undefined) {
      stats.conflicts += 1
    } else {
      result.set(key, mergeValue(baseItem, serverItem, localItem, stats))
    }
  }
  return [...result.values()]
}

function mergeValue(base: unknown, server: unknown, local: unknown, stats: { conflicts: number }): unknown {
  if (equal(base, server)) return local
  if (equal(base, local)) return server
  if (Array.isArray(base) && Array.isArray(server) && Array.isArray(local)) {
    return mergeArray(base, server, local, stats)
  }
  if (base !== null && server !== null && local !== null && typeof base === 'object' && typeof server === 'object' && typeof local === 'object') {
    const baseRecord = base as Record<string, unknown>
    const serverRecord = server as Record<string, unknown>
    const localRecord = local as Record<string, unknown>
    const keys = new Set([...Object.keys(baseRecord), ...Object.keys(serverRecord), ...Object.keys(localRecord)])
    const merged: Record<string, unknown> = {}
    for (const key of keys) {
      merged[key] = mergeValue(baseRecord[key], serverRecord[key], localRecord[key], stats)
    }
    return merged
  }
  stats.conflicts += 1
  return local
}

export function mergeProject(base: unknown, server: unknown, local: unknown): { project: Json, conflicts: number } {
  const stats = { conflicts: 0 }
  const project = mergeValue(base, server, local, stats) as Json
  return { project, conflicts: stats.conflicts }
}
