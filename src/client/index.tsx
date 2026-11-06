/**
 * 浏览器半边入口：侧边栏「会话 / 短剧」入口 + 中栏工作台接管。
 *
 * 与 dsh-imagegen / dsh-video-replica 同一形态，不注册 conversation.view，
 * 不改变会话头部的 View 标签。
 *
 * 失败策略：任何 DOM/挂载错误只记录告警，绝不向宿主冒泡——client 插件
 * apply 抛错会让整个 Web 壳启动失败。
 */

import { DramaApi } from './api.ts'
import { applyLocale, tt } from './locale.ts'
import { mountWorkbench } from './mount.tsx'

interface LocaleLike {
  getLocale?: () => { active?: string }
  subscribe?: (listener: () => void) => () => void
}

interface ClientContext {
  effect: (run: () => () => void, label?: string) => unknown
  get?: (name: string) => unknown
  locale?: LocaleLike
}

export const inject = ['locale']

function safeEffect(ctx: ClientContext, label: string, run: () => () => void): void {
  try {
    ctx.effect(() => {
      try {
        return run()
      } catch (error) {
        console.warn(`[dsh-aidrama] ${label} 执行失败：`, error)
        return () => {}
      }
    }, label)
  } catch (error) {
    console.warn(`[dsh-aidrama] ${label} 注册失败：`, error)
  }
}

export function apply(ctx: ClientContext): void {
  try {
    activate(ctx)
  } catch (error) {
    console.warn('[dsh-aidrama] 激活失败（已忽略以避免阻断 Web 启动）：', error)
  }
}

function activate(ctx: ClientContext): void {
  safeEffect(ctx, 'dsh-aidrama: locale', () => {
    const locale = ctx.locale
    try {
      applyLocale(locale?.getLocale?.()?.active ?? 'zh-CN')
    } catch {
      applyLocale('zh-CN')
    }
    try {
      const unsubscribe = locale?.subscribe?.(() => {
        try {
          applyLocale(locale.getLocale?.()?.active ?? 'zh-CN')
        } catch {
          applyLocale('zh-CN')
        }
      })
      return typeof unsubscribe === 'function' ? unsubscribe : () => {}
    } catch {
      return () => {}
    }
  })

  safeEffect(ctx, 'dsh-aidrama: workbench', () => {
    const pickDirectory = async (): Promise<string | null> => {
      try {
        const ui = ctx.get?.('uiWorkspace') as { pickDirectory?: () => Promise<string | null> } | undefined
        const picked = await ui?.pickDirectory?.()
        return typeof picked === 'string' && picked !== '' ? picked : null
      } catch (error) {
        console.warn('[dsh-aidrama] 目录选择器不可用：', error)
        return null
      }
    }
    return mountWorkbench(new DramaApi(), pickDirectory)
  })
}

// 视图名称保留给外部诊断/测试读取。
export const VIEW_LABEL = (): string => tt('nav')
