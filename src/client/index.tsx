/** Make Make — multi-provider image/video generation UI for DeepSeek Harness. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { Button, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginSettingsClient } from './plugin-settings.ts'

interface Channel {
  id: string
  name: string
  baseURL: string
  model: string
  keyCount?: number
  pollMode?: 'round-robin' | 'sequential'
}

interface MakemakeSettings {
  enabled?: boolean
  imageChannels?: Channel[]
  videoChannels?: Channel[]
  selectedImageChannel?: string
  selectedVideoChannel?: string
  /** 用户当前激活的生成模式（点图标切换）：'image' | 'video' | null */
  activeMode?: 'image' | 'video' | null
}

// 临时激活渠道（内存中，即时响应 UI）：点图标出现徽章，再点消失
// 同时镜像到 scope.activeMode（服务端 systemPrompt 读取，告诉模型当前模式）
// 图片/视频互斥：'image' | 'video' | null
let activeBadge: 'image' | 'video' | null = null

interface SettingsFace {
  scope: SettingsScope<MakemakeSettings>
  pluginSettings: PluginSettingsClient
}
type CardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<SettingsFace>
type ImageCardProps = PropsRuntime<'tool.call.toolview'> & InjectFace<{}>

const CREATION_NAMESPACE = 'creation'
const IMAGE_ROUTE = '/plugins/dsh-makemake/image'

function credentialRef(channelId: string): string {
  return `MAKEMAKE_CHANNEL_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

const STYLE = `
.dsh-mm-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s,background .16s;overflow:hidden}
.dsh-mm-card:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-mm-card-open{background:var(--dsw-alias-bg-layer-2,#fff);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-mm-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px}
.dsh-mm-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:-2px}
.dsh-mm-head-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-mm-name-row{display:flex;align-items:center;gap:6px}
.dsh-mm-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-mm-version-badge{font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-mm-desc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.dsh-mm-btns{display:flex;align-items:center;gap:6px;flex-shrink:0}
.dsh-mm-btn-link{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary);text-decoration:none;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;white-space:nowrap;transition:color .12s,border-color .12s,background .12s}
.dsh-mm-btn-uninstall{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:999px;padding:2px 10px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s}
.dsh-mm-btn-update{font-size:12px;line-height:18px;font-weight:500;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s}
.dsh-mm-btn-env{font-size:12px;line-height:18px}
.dsh-mm-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .14s ease-in-out}
.dsh-mm-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 14px 16px;background:var(--dsw-alias-bg-module-platform)}
.dsh-mm-master{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.dsh-mm-master-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-mm-master-note{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-mm-buttons{display:flex;gap:10px}
.dsh-mm-bigbtn{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;color:var(--dsw-alias-label-primary);transition:border-color .12s,background .12s}
.dsh-mm-bigbtn:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-mm-bigbtn.active{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-1))}
.dsh-mm-bigbtn-icon{font-size:22px;line-height:1;display:grid;place-items:center}
.dsh-mm-bigbtn-label{font-size:13px;line-height:18px;font-weight:600}
.dsh-mm-dot{width:9px;height:9px;border-radius:999px;transition:background .12s}
.dsh-mm-dot.ok{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 6px var(--dsw-alias-state-success-primary)}
.dsh-mm-dot.off{background:var(--dsw-alias-label-tertiary)}
/* 徽章避让：用 CSS 变量控制 backdrop+输入框 padding-left，避免直接改 React 内联样式 */
/* backdrop 是文字渲染层，textarea 是输入层，两者必须同步偏移才不会错位 */
.uV2eYG_backdrop,.uV2eYG_input{padding-left:var(--dsh-mm-pad,16px)!important}
.dsh-mm-badge{position:absolute;top:-6px;right:8px;font-size:10px;line-height:16px;font-weight:600;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 6px}
/* 命令高亮 */
@keyframes dsh-mm-spin{to{transform:rotate(360deg)}}
`

export const inject = ['slots', 'connection', 'remote', 'settingsScope'] as const

export function apply(ctx: Context): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<MakemakeSettings>({ namespace: CREATION_NAMESPACE as never })

  const pluginSettingsListeners = new Set<() => void>()
  const pluginSettings: PluginSettingsClient = {
    subscribe: (listener) => {
      pluginSettingsListeners.add(listener)
      return () => { pluginSettingsListeners.delete(listener) }
    },
    describe: async () => {
      try {
        const res: any = await api.settings.describe({})
        if (!res?.result?.ok) return { ok: false, error: res?.result?.error?.message ?? '读取插件设置失败' }
        return { ok: true, namespaces: res?.result?.value?.namespaces ?? [] }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '读取插件设置失败' }
      }
    },
    update: async (ns, patch) => {
      try {
        const res: any = await (api.settings as any).update({ ns, patch: patch as any })
        if (!res?.result?.ok) return { ok: false, error: res?.result?.error?.message ?? '更新插件设置失败' }
        for (const listener of pluginSettingsListeners) listener()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '更新插件设置失败' }
      }
    },
    describeCredentials: async (refs) => {
      try {
        const res: any = await api.credentials.describe({ refs })
        if (!res?.result?.ok) return { ok: false, error: res?.result?.error?.message ?? '读取插件凭据失败' }
        return { ok: true, credentials: res?.result?.value?.credentials ?? {} }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '读取插件凭据失败' }
      }
    },
    setCredential: async (ref, value) => {
      try {
        const res: any = await api.credentials.set({ ref, value })
        if (!res?.result?.ok) return { ok: false, error: res?.result?.error?.message ?? '保存插件凭据失败' }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '保存插件凭据失败' }
      }
    },
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-makemake'
    style.textContent = STYLE
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-makemake: styles')

  // 输入框渠道徽章：独立视觉指示器，不碰输入框文本
  // 点图标激活显示徽章，再点取消；图片/视频互斥切换
  // 徽章上移（不居中），小尺寸，文本从徽章右侧自然开始
  ctx.effect(() => {
    let badge: HTMLDivElement | null = null
    let lastKey = ''
    const imageSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
    const videoSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="14" height="16" rx="2" ry="2"/><path d="m16 8 4-2.5v13L16 16"/></svg>'
    const tick = () => {
      // 只读内存中的激活状态（不持久化）
      const mode = activeBadge
      const snap = scope.getSnapshot().value
      const imgChs = snap?.imageChannels ?? []
      const vidChs = snap?.videoChannels ?? []
      // 根据激活类型找对应渠道
      let label = ''
      let isVideo = false
      if (mode === 'video') {
        const sel = vidChs.find(c => c.id === snap?.selectedVideoChannel) ?? vidChs[0]
        if (sel) { label = sel.name; isVideo = true }
      } else if (mode === 'image') {
        const sel = imgChs.find(c => c.id === snap?.selectedImageChannel) ?? imgChs[0]
        if (sel) { label = sel.name; isVideo = false }
      }
      const key = `${mode}:${label}`
      if (key === lastKey) return
      lastKey = key
      const backdrop = document.querySelector('.uV2eYG_backdrop')
      const host = backdrop?.parentElement ?? document.querySelector('.uV2eYG_grow')
      if (!host) {
        badge?.remove(); badge = null
        return
      }
      if (!label) {
        badge?.remove(); badge = null
        // 恢复 padding-left（CSS 变量复位）
        document.documentElement.style.setProperty('--dsh-mm-pad', '16px')
        return
      }
      const svg = isVideo ? videoSvg : imageSvg
      if (!badge) {
        badge = document.createElement('div')
        badge.dataset.plugin = 'dsh-makemake-badge'
        badge.style.cssText = 'position:absolute;top:4px;left:16px;z-index:6;pointer-events:auto;display:flex;align-items:center;gap:4px;white-space:nowrap;' +
          'background:#2c2c2e;border:1px solid #00E5FF55;border-radius:999px;padding:1px 6px 1px 8px;height:20px;' +
          'color:#00E5FF;font-size:12px;line-height:18px;font-family:"SF Mono",Menlo,Consolas,monospace;cursor:pointer'
        host.appendChild(badge)
      }
      badge.innerHTML = svg + `<span>${label.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;color:#00E5FF88;flex-shrink:0;cursor:pointer"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
      badge.onclick = () => {
        activeBadge = null
        scope.set('activeMode', null)
      }
      // 用 CSS 变量避让文本（不碰 React 管理的 backdrop 内联样式）
      const bw = badge.offsetWidth
      document.documentElement.style.setProperty('--dsh-mm-pad', `${Math.max(16, bw + 20)}px`)
    }
    const iv = setInterval(tick, 300)
    return () => { clearInterval(iv); badge?.remove() }
  }, 'dsh-makemake: input badge')

  const register = ctx.slots.register.bind(ctx.slots) as unknown as (opts: object, comp: unknown) => () => void

  // Plugin card
  ctx.slots.inject('settings.plugin.item', () => register({
    name: 'settings.plugin.item',
    key: CREATION_NAMESPACE,
    id: CREATION_NAMESPACE,
    order: 90,
    inject: (): SettingsFace => ({ scope, pluginSettings }),
  }, MakemakePluginCard))

  // toolview slots (兼容旧会话)
  ;(['makemake_image', 'make_image', 'generate_image'] as const).forEach(key => {
    ctx.slots.inject('tool.call.toolview' as any, () => (ctx.slots.register as any)({
      name: 'tool.call.toolview',
      key,
      inject: () => ({}),
    }, ImageResultCard))
  })
  // 视频 toolview
  ;(['makemake_video'] as const).forEach(key => {
    ctx.slots.inject('tool.call.toolview' as any, () => (ctx.slots.register as any)({
      name: 'tool.call.toolview',
      key,
      inject: () => ({}),
    }, VideoResultCard))
  })

  // 快捷按钮
  ctx.slots.inject('conversation.input.left' as any, () => (ctx.slots.register as any)({
    name: 'conversation.input.left',
    id: 'dsh-makemake-btns',
    order: 90,
    inject: (): { scope: SettingsScope<MakemakeSettings> } => ({ scope }),
  }, (props: { scope: SettingsScope<MakemakeSettings> }) => <MakeMakeButtons scope={props.scope} />))

  // ─── 消息气泡前缀注入 ──────────────────────────────────
  // 用户点击「出图」按钮后，发送时自动在提示词前加「出图：」或「出视频：」
  // 这样气泡里直接显示"出图：一只猫"，模型读了也知道是出图请求
  // 同时保留 activeMode 给服务端 systemPrompt 用（备用方案）
}

function MakeMakeButtons({ scope }: { scope: SettingsScope<MakemakeSettings> }) {
  const [visible, setVisible] = useState(true)
  const [settings, setSettings] = useState<MakemakeSettings>({})
  const [contextMenu, setContextMenu] = useState<{
    type: 'image' | 'video'
    channels: Channel[]
    selectedId: string
    x: number
    y: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      const v = scope.getSnapshot()
      setVisible(v.value?.enabled !== false)
      setSettings(v.value ?? {})
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    return scope.subscribe(() => {
      try {
        const v = scope.getSnapshot()
        setVisible(v.value?.enabled !== false)
        setSettings(v.value ?? {})
      } catch { /* ignore */ }
    })
  }, [scope])
  useEffect(() => {
    if (!contextMenu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [contextMenu])

  // 发送时：渠道信息不进消息文本，只清空徽章。渠道由 selected 状态 + 工具调用传递。
  useEffect(() => {
    if (!visible) return
    const taSel = () => document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')

    // 1) Enter 发送：在提示词前加"出图："或"出视频："前缀，让气泡里直接可见
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
      const ta = taSel()
      if (!ta || document.activeElement !== ta) return
      if (!activeBadge) return
      // 注入前缀：只加一次，先检查是否已有前缀，避免重复
      const prefix = activeBadge === 'image' ? '出图：' : '出视频：'
      const cur = ta.value
      // 已带前缀（用户手动输入过）则不重复加
      if (!cur.startsWith(prefix)) {
        // 用 React 受控组件的 setter 更新值 + 触发 input 事件
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(ta, prefix + cur)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        } else {
          ta.value = prefix + cur
        }
      }
      activeBadge = null
      // 不阻止默认行为，让原 Enter 携带已修改的值发送
      // 如果模型没调工具，用户打下一条消息时会自动清空（见下方兜底检测）。
    }

    // 2) 兜底：无论用哪种方式发送（Enter 或点发送按钮），消息发出后输入框清空
    // → 若仍有激活模式，清空徽章
    let prev = ''
    const iv = setInterval(() => {
      const ta = taSel()
      if (!ta) return
      const v = ta.value
      if (prev !== '' && v === '' && activeBadge) {
        // Enter 拦截器已处理并注入前缀，不会重复；点按钮发送时这里清空徽章
        activeBadge = null
      }
      prev = v
    }, 250)

    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true); clearInterval(iv) }
  }, [visible])

  const handleLeftClick = (type: 'image' | 'video') => {
    const channels = type === 'image' ? settings.imageChannels ?? [] : settings.videoChannels ?? []
    const selectedId = type === 'image' ? settings.selectedImageChannel : settings.selectedVideoChannel
    const selected = channels.find(c => c.id === selectedId) ?? channels[0]
    if (!selected) return
    const key = type === 'image' ? 'selectedImageChannel' : 'selectedVideoChannel'
    const otherKey = type === 'image' ? 'selectedVideoChannel' : 'selectedImageChannel'
    if (activeBadge === type) {
      // 再点同一个 → 取消激活（隐藏徽章）——activeMode 清空，模型不再认为有激活渠道
      activeBadge = null
      scope.set('activeMode', null)
    } else {
      // 点不同类型 → 切换（或首次激活）
      activeBadge = type
      scope.set('activeMode', type)
      // 持久化当前渠道给模型用
      scope.set(key, selected.id)
      scope.set(otherKey, undefined)
    }
  }

  const handleRightClick = (e: React.MouseEvent, type: 'image' | 'video') => {
    e.preventDefault()
    const channels = type === 'image' ? settings.imageChannels ?? [] : settings.videoChannels ?? []
    const selectedId = type === 'image' ? settings.selectedImageChannel : settings.selectedVideoChannel
    if (channels.length === 0) return
    // 先记下鼠标位置，后续 useEffect 里根据菜单实际高度调整弹出方向
    setContextMenu({ type, channels, selectedId: selectedId ?? '', x: e.clientX, y: e.clientY })
  }

  const handleChannelSelect = async (ch: Channel) => {
    const key = contextMenu!.type === 'image' ? 'selectedImageChannel' : 'selectedVideoChannel'
    const otherKey = contextMenu!.type === 'image' ? 'selectedVideoChannel' : 'selectedImageChannel'
    await scope.set(key, ch.id)
    await scope.set(otherKey, undefined)
    // 右键选渠道后激活徽章 + 持久化 activeMode
    activeBadge = contextMenu!.type
    await scope.set('activeMode', contextMenu!.type)
    // 不注入文本，徽章会自动更新
    setContextMenu(null)
  }

  if (!visible) return null
  return (
    <>
      <button type="button" onClick={() => handleLeftClick('image')} onContextMenu={(e) => handleRightClick(e, 'image')}
        title="左键：用当前选中渠道出图 · 右键：选择渠道"
        style={{
          display: 'grid', placeItems: 'center', flex: 'none', width: 28, height: 28,
          border: 'none', borderRadius: 999, background: 'transparent', cursor: 'pointer',
          color: '#fff', opacity: 0.75,
          transition: 'color .15s, opacity .15s',
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
        </svg>
      </button>
      <button type="button" onClick={() => handleLeftClick('video')} onContextMenu={(e) => handleRightClick(e, 'video')}
        title="左键：用当前选中渠道出视频 · 右键：选择渠道"
        style={{
          display: 'grid', placeItems: 'center', flex: 'none', width: 28, height: 28,
          border: 'none', borderRadius: 999, background: 'transparent', cursor: 'pointer',
          color: '#fff', opacity: 0.75,
          transition: 'color .15s, opacity .15s',
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="14" height="16" rx="2" ry="2"/><path d="m16 8 4-2.5v13L16 16"/>
        </svg>
      </button>
      {contextMenu && (
        <div ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            // 向上弹出：菜单底部 = 鼠标点击位置上方 8px
            bottom: window.innerHeight - contextMenu.y - 8,
            zIndex: 10000,
            minWidth: 160, maxHeight: 320, overflowY: 'auto',
            background: 'var(--dsw-alias-bg-layer-3,#1e1e1e)',
            border: '1px solid var(--dsw-alias-border-l2,#333)',
            borderRadius: 8, padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-tertiary,#999)',
            padding: '6px 10px 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {contextMenu.type === 'image' ? '出图渠道' : '出视频渠道'}
          </div>
          {contextMenu.channels.map(ch => (
            <button key={ch.id} type="button" onClick={() => handleChannelSelect(ch)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13,
                border: 'none', background: contextMenu.selectedId === ch.id ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#4c78ff) 15%, transparent)' : 'transparent',
                color: 'var(--dsw-alias-label-primary,#fff)', borderRadius: 6, cursor: 'pointer',
              }}>
              <span style={{ fontWeight: contextMenu.selectedId === ch.id ? 600 : 400 }}>
                {contextMenu.selectedId === ch.id ? '✓ ' : ''}{ch.name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#999)', marginLeft: 6 }}>
                {ch.model}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function MakemakePluginCard(props: CardProps) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('0825-0.1.1-rc.2')
  const [hasUpdate, setHasUpdate] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showCheckModal, setShowCheckModal] = useState(false)
  const { scope, pluginSettings } = props

  return (
    <li className="dsh-mm-card">
      <button className="dsh-mm-head" onClick={() => setOpen(v => !v)}>
        <span className="dsh-mm-head-text">
          <div className="dsh-mm-name-row">
            <span className="dsh-mm-title">Make Make</span>
            {version && <span className="dsh-mm-version-badge">{version}</span>}
          </div>
          <span className="dsh-mm-desc">支持生成图像和视频的插件。AI 可以为你画图、生成视频。</span>
        </span>
        <span className="dsh-mm-btns">
          <a className="dsh-mm-btn-link" href="https://github.com/ideasir/dsh-makemake" target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="打开 GitHub 仓库">ideasir</a>
          <button className="dsh-mm-btn-uninstall" onClick={(e: React.MouseEvent) => { e.stopPropagation(); if (confirm('确定卸载 Make Make 插件吗？\n\n将从 DSH 中移除插件本体和全部配置。')) { setFeedback('已卸载（重启后生效）'); setTimeout(() => setFeedback(null), 3000) } }} title="卸载插件">卸载</button>
          {hasUpdate ? (
            <button className="dsh-mm-btn-update" style={{ color: 'var(--dsw-alias-state-success-primary)', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent)' }}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); window.open('https://github.com/ideasir/dsh-makemake', '_blank', 'noreferrer') }}
              title="发现新版本，点击前往仓库查看更新">有更新</button>
          ) : (
            <button className="dsh-mm-btn-update" style={{ color: 'var(--dsw-alias-label-tertiary)' }}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setVersion(v => v + ''); }}
              title="当前已是最新版本（点击重新检查）">已最新</button>
          )}
          <Button variant="outline" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowCheckModal(true) }}>{'智能检测'}</Button>
          <span className={`dsh-mm-chevron ${open ? 'dsh-mm-chevron-open' : ''}`} style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
            <IconChevronDownOutline14 />
          </span>
        </span>
      </button>
      {open && (
        <div className="dsh-mm-body">
          {feedback && (
            <p style={{ margin: 0, fontSize: 13, color: feedback.startsWith('已') ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
              {feedback}
            </p>
          )}
          <PluginBody scope={scope} pluginSettings={pluginSettings} />
        </div>
      )}
      {showCheckModal && <CheckModal pluginSettings={pluginSettings} onClose={() => setShowCheckModal(false)} />}
    </li>
  )
}

function PluginBody({ scope, pluginSettings }: { scope: SettingsScope<MakemakeSettings>; pluginSettings: PluginSettingsClient }) {
  const [enabled, setEnabled] = useState(true)
  const [openPanel, setOpenPanel] = useState<'image' | 'video' | null>(null)
  const [editing, setEditing] = useState<{ type: 'image' | 'video'; id: string } | null>(null)
  const [chName, setChName] = useState('')
  const [chBaseURL, setChBaseURL] = useState('')
  const [chModel, setChModel] = useState('')
  const [chKey, setChKey] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [chPollMode, setChPollMode] = useState<'round-robin' | 'sequential'>('round-robin')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'done' | 'error'>('idle')
  const [testResult, setTestResult] = useState<{
    textToImage?: { ok: boolean; endpoint: string; detail?: string }
    imageToImage?: { ok: boolean; endpoint: string; formats: string[] }
    video?: { ok: boolean; endpoint: string }
    error?: string
  } | null>(null)
  const [imageChannels, setImageChannels] = useState<Channel[]>([])
  const [videoChannels, setVideoChannels] = useState<Channel[]>([])
  const [selectedImageChannel, setSelectedImageChannel] = useState('')
  const [selectedVideoChannel, setSelectedVideoChannel] = useState('')

  useEffect(() => {
    const load = () => {
      try {
        const v = scope.getSnapshot()
        if (v.value?.enabled !== undefined) setEnabled(v.value.enabled)
        const imgChs = v.value?.imageChannels ?? []
        const vidChs = v.value?.videoChannels ?? []
        // 为每个渠道加载 keyCount
        const loadKeyCounts = async (chs: Channel[]) => {
          const refs = chs.map(c => credentialRef(c.id))
          if (refs.length === 0) return
          const res = await pluginSettings.describeCredentials(refs)
          if (!res.ok) return
          for (const c of chs) {
            const cred = res.credentials[credentialRef(c.id)]
            c.keyCount = cred?.configured ? 1 : 0 // 后续由 KeyPool 返回实际数量
          }
        }
        setImageChannels(imgChs)
        setVideoChannels(vidChs)
        setSelectedImageChannel(v.value?.selectedImageChannel ?? '')
        setSelectedVideoChannel(v.value?.selectedVideoChannel ?? '')
        void loadKeyCounts([...imgChs, ...vidChs])
      } catch { /* ignore */ }
    }
    load()
    return scope.subscribe(load)
  }, [])

  const toggleEnabled = async () => {
    const nextEnabled = !enabled
    await scope.set('enabled', nextEnabled)
    if (!nextEnabled) {
      // 关闭时清掉激活模式与徽章，防止重开后残留"出图意图"导致乱出图
      activeBadge = null
      await scope.set('activeMode', null)
    }
    setEnabled(nextEnabled)
  }

  const channels = openPanel === 'image' ? imageChannels : openPanel === 'video' ? videoChannels : []
  const selectedId = openPanel === 'image' ? selectedImageChannel : selectedVideoChannel

  const startEdit = (type: 'image' | 'video', ch?: Channel) => {
    const id = ch?.id ?? `new-${Date.now()}`
    setEditing({ type, id })
    // 编辑哪个渠道就自动选中哪个（让发亮状态跟随编辑面板）
    if (ch?.id) {
      void scope.set(type === 'image' ? 'selectedImageChannel' : 'selectedVideoChannel', ch.id)
    }
    setChName(ch?.name ?? '')
    setChBaseURL(ch?.baseURL ?? '')
    setChModel(ch?.model ?? '')
    setChKey('')
    setChPollMode(ch?.pollMode ?? 'round-robin')
    setKeyConfigured(false)
    setTestState('idle')
    setTestResult(null)
    setSaveMsg(null)
    if (ch) {
      void pluginSettings.describeCredentials([credentialRef(ch.id)]).then(res => {
        if (res.ok) {
          const cred = res.credentials[credentialRef(ch.id)]
          setKeyConfigured(cred?.configured ?? false)
        }
      })
    }
  }

  const saveChannel = async () => {
    if (!editing) return
    setSaveMsg(null)
    const key = editing.type === 'image' ? 'imageChannels' : 'videoChannels'
    const allChannels = editing.type === 'image' ? imageChannels : videoChannels
    const current = [...allChannels]
    const isNew = editing.id.startsWith('new-')
    try {
      if (isNew) {
        const newId = `ch-${Date.now()}`
        const newCh: Channel = { id: newId, name: chName || chModel, baseURL: chBaseURL, model: chModel, pollMode: chPollMode }
        if (chKey.trim()) {
          const cred = await pluginSettings.setCredential(credentialRef(newId), chKey.trim())
          if (!cred.ok) throw new Error(cred.error)
        }
        await scope.set(key, [...current, newCh])
      } else {
        if (chKey.trim()) {
          const cred = await pluginSettings.setCredential(credentialRef(editing.id), chKey.trim())
          if (!cred.ok) throw new Error(cred.error)
        }
        const updated = current.map((ch: any) => ch.id === editing.id ? { ...ch, name: chName, baseURL: chBaseURL, model: chModel, pollMode: chPollMode } : ch)
        await scope.set(key, updated)
      }
      setSaveMsg('✓ 已保存')
      setTimeout(() => setSaveMsg(null), 2000)
      setEditing(null)
    } catch (e) {
      setSaveMsg(`✗ ${e instanceof Error ? e.message : '保存失败'}`)
    }
  }

  const deleteChannel = async (type: 'image' | 'video', id: string) => {
    const key = type === 'image' ? 'imageChannels' : 'videoChannels'
    const allChannels = type === 'image' ? imageChannels : videoChannels
    const current = [...allChannels]
    await scope.set(key, current.filter((ch: any) => ch.id !== id))
  }

  // 渠道检测
  const testChannel = async () => {
    if (!chBaseURL || !chModel) { setSaveMsg('请先填写接口地址和模型名'); return }
    if (!chKey.trim() && !keyConfigured) { setSaveMsg('请先填写 API Key（或该渠道已有已保存的 Key）'); return }
    setTestState('testing'); setTestResult(null); setSaveMsg(null)
    try {
      const type = editing?.type ?? 'image'
      const res = await fetch('/plugins/dsh-makemake/test', {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          baseURL: chBaseURL.replace(/\/+$/, ''),
          model: chModel,
          apiKey: chKey.trim().split('\n')[0] ?? '',
          channelId: editing?.id ?? '',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTestResult(data)
      setTestState('done')
      setSaveMsg(data.ok ? '检测通过 ✓' : '检测完成，部分功能不可用，见下方详情')
    } catch (e) {
      setTestState('error')
      setSaveMsg(`检测失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const inputStyle = {
    boxSizing: 'border-box' as const, width: '100%', padding: '8px 12px',
    fontSize: 13, border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', color: 'inherit', outline: 'none',
  } as const
  const fieldStyle = { display: 'grid', gap: 6 } as const
  const labelStyle = { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } as const

  return (
    <>
      <div className="dsh-mm-master">
        <button type="button" role="switch" aria-checked={enabled} onClick={toggleEnabled}
          style={{
            flex: 'none', position: 'relative', width: 44, height: 24, borderRadius: 999,
            border: 'none', cursor: 'pointer', padding: 0,
            background: enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l3)',
            transition: 'background .18s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: enabled ? 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)' : 'none',
          }}>
          <span style={{
            position: 'absolute', top: 3, left: enabled ? 44 - 18 - 3 : 3,
            width: 18, height: 18, borderRadius: 999, background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            transition: 'left .2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }} />
        </button>
        <div>
          <div className="dsh-mm-master-label">{enabled ? 'Make Make 已开启' : 'Make Make 已关闭'}</div>
          <div className="dsh-mm-master-note">{enabled ? 'AI 可以调用 makemake_image 工具生成图片' : '关闭后 AI 无法调用图像生成工具'}</div>
        </div>
      </div>

      <div className="dsh-mm-buttons">
        <BigButton icon={<LucideImage size={22} />} label="出图模型" count={imageChannels.length}
          active={openPanel === 'image'} onClick={() => setOpenPanel(p => p === 'image' ? null : 'image')} />
        <BigButton icon={<LucideVideo size={22} />} label="出视频模型" count={videoChannels.length}
          active={openPanel === 'video'} onClick={() => setOpenPanel(p => p === 'video' ? null : 'video')} />
      </div>

      {openPanel === 'image' && (
        <VideoChannelPanel
          type="image"
          channels={channels as any[]}
          selectedId={selectedId}
          editing={editing}
          scope={scope}
          chName={chName} chBaseURL={chBaseURL} chModel={chModel} chKey={chKey} keyConfigured={keyConfigured}
          chPollMode={chPollMode} setChPollMode={setChPollMode}
          inputStyle={inputStyle} fieldStyle={fieldStyle} labelStyle={labelStyle}
          startEdit={startEdit} saveChannel={saveChannel} deleteChannel={deleteChannel}
          setChName={setChName} setChBaseURL={setChBaseURL} setChModel={setChModel} setChKey={setChKey}
          setKeyConfigured={setKeyConfigured} setEditing={setEditing} saveMsg={saveMsg}
          testChannel={testChannel} testState={testState} testResult={testResult}
        />
      )}
      {openPanel === 'video' && (
        <VideoChannelPanel
          type="video"
          channels={channels as any[]}
          selectedId={selectedId}
          editing={editing}
          scope={scope}
          chName={chName} chBaseURL={chBaseURL} chModel={chModel} chKey={chKey} keyConfigured={keyConfigured}
          chPollMode={chPollMode} setChPollMode={setChPollMode}
          inputStyle={inputStyle} fieldStyle={fieldStyle} labelStyle={labelStyle}
          startEdit={startEdit} saveChannel={saveChannel} deleteChannel={deleteChannel}
          setChName={setChName} setChBaseURL={setChBaseURL} setChModel={setChModel} setChKey={setChKey}
          setKeyConfigured={setKeyConfigured} setEditing={setEditing} saveMsg={saveMsg}
          testChannel={testChannel} testState={testState} testResult={testResult}
        />
      )}
    </>
  )
}

function VideoChannelPanel({
  type, channels, selectedId, editing, scope, chName, chBaseURL, chModel, chKey, keyConfigured,
  chPollMode, setChPollMode,
  inputStyle, fieldStyle, labelStyle, startEdit, saveChannel, deleteChannel,
  setChName, setChBaseURL, setChModel, setChKey, setKeyConfigured, setEditing, saveMsg,
  testChannel, testState, testResult,
}: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', paddingBottom: 2 }}>
        ✓ = 当前出图使用的渠道 · ✏️ 编辑配置 · 🗑 删除
      </div>
      {channels.length === 0 && !editing && (
        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' }}>暂无渠道，点击下方按钮添加</div>
      )}
      {channels.map((ch: any) => (
        <div key={ch.id} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8,
          border: selectedId === ch.id ? '2px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
          background: selectedId === ch.id ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' : 'transparent',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              {ch.name}
              {editing?.id === ch.id && (
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-brand-primary)', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent)', borderRadius: 999, padding: '0 6px', lineHeight: '18px' }}>
                  编辑中
                </span>
              )}
              {ch.keyCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 999, padding: '0 6px', lineHeight: '18px' }}>
                  {ch.keyCount} Key
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', display: 'flex', gap: 6, alignItems: 'center' }}>
              {ch.model}
              {ch.pollMode && <span style={{ color: 'var(--dsw-alias-label-caption)' }}>· {ch.pollMode === 'round-robin' ? '轮询' : '顺序'}</span>}
            </div>
          </div>
          <button type="button" onClick={() => { void scope.set(type === 'image' ? 'selectedImageChannel' : 'selectedVideoChannel', selectedId === ch.id ? '' : ch.id) }}
            style={{ background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', color: selectedId === ch.id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)' }}>
            {selectedId === ch.id ? '✓' : '○'}
          </button>
          <button type="button" onClick={() => startEdit(type, ch)}
            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', fontSize: 14, color: 'var(--dsw-alias-label-tertiary)' }}>✏️</button>
          <button type="button" onClick={() => { void deleteChannel(type, ch.id) }}
            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', fontSize: 14, color: 'var(--dsw-alias-state-error-primary)' }}>🗑</button>
        </div>
      ))}
      <button type="button" onClick={() => startEdit(type)} style={{
        fontSize: 12, color: 'var(--dsw-alias-brand-primary)', background: 'none',
        border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', alignSelf: 'flex-start',
      }}>+ 添加渠道</button>

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>渠道名称</label>
            <input style={inputStyle} value={chName} onChange={e => setChName(e.target.value)} placeholder={type === 'image' ? '如：精品出图' : '如：视频生成'} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>接口地址</label>
            <input style={inputStyle} value={chBaseURL} onChange={e => setChBaseURL(e.target.value)} placeholder={type === 'image' ? 'https://api.openai.com/v1' : 'https://api.example.com/v1'} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>模型名</label>
            <input style={inputStyle} value={chModel} onChange={e => setChModel(e.target.value)} placeholder={type === 'image' ? 'gpt-image-2' : 'sora'} />
          </div>
          <div style={fieldStyle}>
                              <label style={labelStyle}>API Key（每行一个，自动轮询）</label>
                              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} autoComplete="off" value={chKey} onChange={e => setChKey(e.target.value)}
                                placeholder={keyConfigured ? '留空保持已配置的 Key' : '每行一个 API Key\n自动轮询，429/限流自动跳过'} />
                              {keyConfigured && <span style={{ fontSize: 11, color: 'var(--dsw-alias-state-success-primary)' }}>✓ Key 已配置</span>}
                            </div>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>轮询方式</label>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" onClick={() => setChPollMode('round-robin')}
                                  style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                                    border: chPollMode === 'round-robin' ? '2px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
                                    background: chPollMode === 'round-robin' ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' : 'transparent',
                                    color: 'var(--dsw-alias-label-primary)' }}>轮询（轮流使用）</button>
                                <button type="button" onClick={() => setChPollMode('sequential')}
                                  style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                                    border: chPollMode === 'sequential' ? '2px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
                                    background: chPollMode === 'sequential' ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' : 'transparent',
                                    color: 'var(--dsw-alias-label-primary)' }}>顺序（用完再换）</button>
                              </div>
                            </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {saveMsg && (
              <span style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
                {saveMsg}
              </span>
            )}
            <button onClick={() => setEditing(null)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', cursor: 'pointer' }}>取消</button>
            <button onClick={() => { void testChannel() }} disabled={testState === 'testing'}
              style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-brand-primary)', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: testState === 'testing' ? 'wait' : 'pointer', opacity: testState === 'testing' ? 0.6 : 1 }}>
              {testState === 'testing' ? '检测中…' : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><LucideSearch size={12} /> 检测</span>
              )}
            </button>
            <button onClick={saveChannel} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--dsw-alias-state-success-primary)', color: '#fff', cursor: 'pointer' }}>保存</button>
          </div>
          {testState === 'done' && testResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
                {testResult.textToImage?.ok || testResult.video?.ok ? <span style={{ color: 'var(--dsw-alias-state-success-primary)' }}>✓</span> : <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>✗</span>}
                检测成功
              </div>
              {testResult.textToImage && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ color: testResult.textToImage.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{testResult.textToImage.ok ? '✓' : '✗'}</span>
                  <span style={{ color: 'var(--dsw-alias-label-primary)' }}>文生图</span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>POST {testResult.textToImage.endpoint}</span>
                  {testResult.textToImage.detail && (
                    <span style={{ color: testResult.textToImage.ok ? 'var(--dsw-alias-label-caption)' : 'var(--dsw-alias-state-error-primary)', fontSize: 11 }}>({testResult.textToImage.detail})</span>
                  )}
                </div>
              )}
              {testResult.imageToImage && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ color: testResult.imageToImage.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{testResult.imageToImage.ok ? '✓' : '✗'}</span>
                  <span style={{ color: 'var(--dsw-alias-label-primary)' }}>图生图</span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>POST {testResult.imageToImage.endpoint}</span>
                  {testResult.imageToImage.formats.length > 0 && (
                    <span style={{ color: 'var(--dsw-alias-label-caption)', fontSize: 11 }}>({testResult.imageToImage.formats.join('、')})</span>
                  )}
                </div>
              )}
              {testResult.video && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ color: testResult.video.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{testResult.video.ok ? '✓' : '✗'}</span>
                  <span style={{ color: 'var(--dsw-alias-label-primary)' }}>文生视频</span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>POST {testResult.video.endpoint}</span>
                </div>
              )}
              {testResult.videoToImage && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ color: testResult.videoToImage.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{testResult.videoToImage.ok ? '✓' : '✗'}</span>
                  <span style={{ color: 'var(--dsw-alias-label-primary)' }}>图生视频</span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>POST {testResult.videoToImage.endpoint}</span>
                </div>
              )}
              {testResult.error && <div style={{ fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' }}>{testResult.error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BigButton({ icon, label, tag, count, active, onClick }: {
  icon: ReactNode; label: string; tag?: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button type="button" className={`dsh-mm-bigbtn ${active ? 'active' : ''}`} onClick={onClick}>
      {tag && <span className="dsh-mm-badge">{tag}</span>}
      <span className="dsh-mm-bigbtn-icon">{icon}</span>
      <span className="dsh-mm-bigbtn-label">{label}</span>
      {count > 0 && <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1 }}>{count} 个渠道</span>}
      <span className={`dsh-mm-dot ${count > 0 ? 'ok' : 'off'}`} />
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{
        marginTop: 2, transition: 'transform .15s', transform: active ? 'rotate(180deg)' : 'none',
        color: 'var(--dsw-alias-label-tertiary)',
      }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}

function L({ d, size }: { d: ReactNode; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</g></svg>
}

const LucideImage = ({ size }: { size: number }) => (
  <L size={size} d={[<rect key="r" x="3" y="3" width="18" height="18" rx="2" ry="2" />, <circle key="c" cx="8.5" cy="8.5" r="1.5" />, <path key="p" d="m21 15-5-5L5 21" />]} />
)

const LucideVideo = ({ size }: { size: number }) => (
  <L size={size} d={[<rect key="r" x="2" y="4" width="14" height="16" rx="2" ry="2" />, <path key="p1" d="m16 8 4-2.5v13L16 16" />]} />
)

const LucideSearch = ({ size }: { size: number }) => (
  <L size={size} d={[<circle key="c" cx="11" cy="11" r="8" />, <path key="p" d="m21 21-4.3-4.3" />]} />
)

const LucideX = ({ size }: { size: number }) => (
  <L size={size} d={[<path key="p1" d="M18 6 6 18" />, <path key="p2" d="m6 6 12 12" />]} />
)

const LucideLoader = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'dsh-mm-spin 1s linear infinite' }}>
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </g>
  </svg>
)

const LucideImageCc = ({ size }: { size: number }) => (
  <L size={size} d={[<rect key="r" x="3" y="3" width="18" height="18" rx="2" ry="2" />, <circle key="c" cx="8.5" cy="8.5" r="1.5" />, <path key="p" d="m21 15-5-5L5 21" />]} />
)

const LucideFilm = ({ size }: { size: number }) => (
  <L size={size} d={[<rect key="r" x="2" y="4" width="14" height="16" rx="2" ry="2" />, <path key="p1" d="m16 8 4-2.5v13L16 16" />, <path key="p2" d="M7 8h.01" />, <path key="p3" d="M4 13h.01" />, <path key="p4" d="M7 15h.01" />]} />
)

// ─── Modal anim ──────────────────────────────────────────────────────────
const MODAL_ANIM = `
.dsh-mm-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);opacity:0;animation:dsh-mm-fadein .22s ease-out forwards}
.dsh-mm-modal.closing{animation:dsh-mm-fadeout .18s ease-in forwards}
.dsh-mm-modal-img{display:block;position:absolute;user-select:none;-webkit-user-drag:none;cursor:grab}
.dsh-mm-modal-img.dragging{cursor:grabbing}
.dsh-mm-modal-close{position:fixed;top:16px;right:16px;width:36px;height:36px;border-radius:999px;border:none;cursor:pointer;background:rgba(255,255,255,0.15);color:#fff;font-size:18px;line-height:1;display:grid;place-items:center;transition:background .15s;z-index:10}
.dsh-mm-modal-close:hover{background:rgba(255,255,255,0.3)}
.dsh-mm-modal-hint{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);color:#fff;font-size:12px;padding:5px 14px;border-radius:999px;pointer-events:none;white-space:nowrap;backdrop-filter:blur(6px);z-index:10}
@keyframes dsh-mm-fadein{from{opacity:0}to{opacity:1}}
@keyframes dsh-mm-fadeout{from{opacity:1}to{opacity:0}}
`

// ─── Image result card ──────────────────────────────────────────────────────
interface ContentBlock { type: string; text?: string; attachment?: { attachmentId: string; previewUrl?: string } }
function ImageResultCard(props: ImageCardProps) {
  const block = props.block as { content?: ContentBlock[]; isError?: boolean; error?: { code?: string; message?: string } }
  const [modalUrl, setModalUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  const openModal = (url: string) => { setModalUrl(url); setZoom(1); setOffset({ x: 0, y: 0 }); setClosing(false) }
  const closeModal = () => { setClosing(true); setTimeout(() => { setModalUrl(null); setClosing(false) }, 160) }
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.max(0.25, Math.min(10, z - e.deltaY * 0.003)))
  }
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: { ...offset } }
    setDragging(true)
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!dragRef.current) return
    setOffset({
      x: dragRef.current.startOffset.x + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startOffset.y + (e.clientY - dragRef.current.startY),
    })
  }
  const onMouseUp = () => {
    dragRef.current = null
    setDragging(false)
  }
  useEffect(() => {
    if (!modalUrl) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal() } }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [modalUrl, closing])
  useEffect(() => {
    if (!modalUrl) return
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-makemake-modal'
    style.textContent = MODAL_ANIM
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [modalUrl])
  useEffect(() => {
    if (!imgRef.current) return
    const img = imgRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const naturalW = img.naturalWidth
    const naturalH = img.naturalHeight
    const scale = Math.min(vw / naturalW, vh / naturalH, 1)
    const w = naturalW * scale
    const h = naturalH * scale
    containerRef.current = { w, h }
    img.style.left = `${(vw - w) / 2}px`
    img.style.top = `${(vh - h) / 2}px`
    img.style.width = `${w}px`
    img.style.height = `${h}px`
    img.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`
    img.style.transformOrigin = 'center center'
  }, [modalUrl, zoom])
  useEffect(() => {
    if (!imgRef.current) return
    const { w, h } = containerRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    imgRef.current.style.left = `${(vw - w) / 2 + offset.x}px`
    imgRef.current.style.top = `${(vh - h) / 2 + offset.y}px`
    imgRef.current.style.transform = `scale(${zoom})`
    imgRef.current.style.transformOrigin = 'center center'
  }, [zoom, offset])

  if (!block?.content) return null
  const imageBlocks = block.content.filter((b: any) => b.type === 'image' && b.attachment)
  const textBlocks = block.content.filter((b: any) => b.type === 'text' && b.text)

  let prompt = ''
  for (const tb of textBlocks) {
    const t = tb.text
    if (t && /已生成图片|已生成视频/.test(t)) {
      const match = t.match(/：(.+)$/)
      if (match && match[1]) prompt = match[1]
    }
  }

  if (block.isError) {
    return <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 8, marginTop: 4 }}>图片生成失败：{block.error?.message ?? '未知错误'}</div>
  }

  if (imageBlocks.length > 0) {
    const copyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // fallback：非 HTTPS 环境（SSH 隧道 localhost）clipboard API 不可用
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;left:-9999px'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, width: '100%' }}>
      {imageBlocks.map((b: any, i: number) => {
        const att = b.attachment
        const url = `${window.location.origin}/plugins/dsh-makemake/image?attachmentId=${att?.attachmentId}`
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', maxWidth: 350 }}>
            <div style={{ cursor: 'zoom-in', position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}
              onClick={() => openModal(url)}>
              <img src={url} alt="generated"
                style={{ maxWidth: 350, maxHeight: 350, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', display: 'block', objectFit: 'contain' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            {/* 图片信息 + 操作按钮 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 350, alignItems: 'flex-start', alignSelf: 'flex-start' }}>
              {att && (
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', maxWidth: '100%', flexWrap: 'nowrap' }}>
                  {/* 引用 + 尺寸 + 提示词 + 复制（全部一行） */}
                  {/* 引用按钮 */}
                  <button onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      const resp = await fetch(url)
                      if (!resp.ok) throw new Error('load-failed')
                      const blob = await resp.blob()
                      const file = new File([blob], 'reference.png', { type: blob.type || 'image/png' })
                      const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')
                      if (!ta) return
                      const dt = new DataTransfer()
                      dt.items.add(file)
                      const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
                      ta.dispatchEvent(pasteEvent)
                      void navigator.clipboard.writeText(url)
                    } catch { void navigator.clipboard.writeText(url) }
                  }}
                    title="引用此图到对话框"
                    style={{ flex: 'none', width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--dsw-alias-brand-primary)', transition: 'background .12s' }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'transparent' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    </svg>
                  </button>
                  {/* 分辨率 + 大小 */}
                  <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {att.width}×{att.height} · {(att.bytes / 1024).toFixed(0)} KB
                  </span>
                  {/* 渠道名 + 提示词 */}
                  {prompt && (
                    <span style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary)', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'default' }}
                      title={prompt}>{prompt}</span>
                  )}
                  {/* 复制 */}
                  <button id={`copy-btn-${i}`} onClick={(e) => {
                    e.stopPropagation()
                    const btn = e.currentTarget
                    copyPrompt(prompt).then(() => {
                      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
                      btn.style.color = 'var(--dsw-alias-state-success-primary)'
                      setTimeout(() => {
                        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
                        btn.style.color = 'var(--dsw-alias-label-tertiary)'
                      }, 1200)
                    })
                  }}
                    style={{ flex: 'none', width: 22, height: 22, borderRadius: 5, border: 'none',
                      background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center',
                      color: 'var(--dsw-alias-label-tertiary)', transition: 'background .12s', padding: 0 }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'var(--dsw-alias-bg-hover)'; (e.target as HTMLButtonElement).style.color = 'var(--dsw-alias-label-primary)' }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'transparent'; (e.target as HTMLButtonElement).style.color = 'var(--dsw-alias-label-tertiary)' }}
                    title="复制提示词">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
      {textBlocks.length > 0 && !prompt && <p style={{ margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 }}>{textBlocks.map((b: any) => b.text).join('')}</p>}
      {modalUrl && (
        <div className={`dsh-mm-modal ${dragging ? 'dragging' : ''} ${closing ? 'closing' : ''}`} onClick={closeModal}>
          <button className="dsh-mm-modal-close" onClick={closeModal}><LucideX size={18} /></button>
          <img ref={imgRef} src={modalUrl} alt="大图"
            className={`dsh-mm-modal-img ${dragging ? 'dragging' : ''}`}
            onWheel={handleWheel}
            onMouseDown={onMouseDown}
          />
          <div className="dsh-mm-modal-hint">{Math.round(zoom * 100)}% · 滚轮缩放 · 拖拽移动 · ESC 关闭</div>
        </div>
      )}
    </div>
  }

  return null
}

function VideoResultCard(props: ImageCardProps) {
  const block = props.block as { content?: ContentBlock[]; isError?: boolean; error?: { code?: string; message?: string } }
  const [modalUrl, setModalUrl] = useState<string | null>(null)

  if (!block?.content) return null
  const textBlocks = block.content.filter((b: any) => b.type === 'text' && b.text)

  if (block.isError) {
    return <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 8, marginTop: 4 }}>视频生成失败：{block.error?.message ?? '未知错误'}</div>
  }

  // 从 text 里提取视频 URL
  const fullText = textBlocks.map((b: any) => b.text).join('\n')
  const urlMatch = fullText.match(/https?:\/\/[^\s）)\]]+/)
  const videoUrl = urlMatch ? urlMatch[0] : ''
  // 提示词描述（去掉 URL 和标题行）
  const desc = fullText
    .replace(/https?:\/\/[^\s）)\]]+/g, '')
    .replace(/🎬 已生成视频[^\n]*\n?/, '')
    .trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, maxWidth: 480, alignItems: 'flex-start' }}>
      {videoUrl ? (
        <video
          src={videoUrl}
          controls
          autoPlay
          muted
          loop
          playsInline
          onClick={() => setModalUrl(videoUrl)}
          style={{ maxWidth: 480, maxHeight: 360, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: '#000', cursor: 'zoom-in', display: 'block' }}
        />
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 }}>{fullText}</p>
      )}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', maxWidth: '100%', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--dsw-alias-label-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}><LucideFilm size={12} /> 视频</span>
        <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={desc}>{desc || '已生成'}</span>
        {videoUrl && (
          <button onClick={(e) => { e.stopPropagation(); window.open(videoUrl, '_blank', 'noreferrer') }}
            style={{ flex: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'var(--dsw-alias-bg-layer-1)' }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'transparent' }}>
            新窗口打开
          </button>
        )}
      </div>
      {modalUrl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }} onClick={() => setModalUrl(null)}>
          <video src={modalUrl} controls autoPlay playsInline style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10 }} />
        </div>
      )}
    </div>
  )
}

interface CheckResult {
  name: string; type: 'image' | 'video'; baseURL: string; model: string
  keyConfigured: boolean; textToImage?: { ok: boolean; detail?: string }
  imageToImage?: { ok: boolean; formats: string[] }
  textToVideo?: { ok: boolean; detail?: string }
  imageToVideo?: { ok: boolean; detail?: string }
  error?: string
}
interface CheckResponse { ok: boolean; results: CheckResult[] }

function CheckModal({ pluginSettings, onClose }: { pluginSettings: PluginSettingsClient; onClose: () => void }) {
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/plugins/dsh-makemake/check-all', { method: 'POST', redirect: 'error' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: CheckResponse = await res.json()
        if (!cancelled) { setResults(data.results); setLoading(false) }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) }
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const statusBadge = (ok: boolean | undefined) => ok ? (
    <span style={{ color: 'var(--dsw-alias-state-success-primary)', fontWeight: 600, marginRight: 4 }}>✓</span>
  ) : (
    <span style={{ color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600, marginRight: 4 }}>✗</span>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--dsw-alias-bg-layer-3,#1e1e1e)', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2,#333)', maxWidth: 640, width: '90%', maxHeight: '80vh', overflowY: 'auto', padding: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' }}>
            <LucideSearch size={18} />
            智能检测
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dsw-alias-label-tertiary)', padding: 4, display: 'grid', placeItems: 'center' }}>
            <LucideX size={16} />
          </button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, fontSize: 14, color: 'var(--dsw-alias-label-tertiary)' }}>
            <div style={{ marginBottom: 12, color: 'var(--dsw-alias-brand-primary)' }}>
              <LucideLoader size={32} />
            </div>
            正在检测所有渠道，请稍候…
          </div>
        )}

        {error && (
          <div style={{ padding: 16, background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8, border: '1px solid var(--dsw-alias-state-error-primary)', fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' }}>
            检测失败：{error}
          </div>
        )}

        {results && results.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>
            暂无渠道配置，请在设置页添加渠道后重试。
          </div>
        )}

        {results && results.map((r, i) => (
          <div key={i} style={{ marginBottom: 12, padding: 14, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2,#333)', background: 'var(--dsw-alias-bg-layer-2,#252525)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: r.type === 'image' ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent)', color: r.type === 'image' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-success-primary)' }}>
              {r.type === 'image' ? <LucideImageCc size={12} /> : <LucideFilm size={12} />}
              {r.type === 'image' ? '出图' : '视频'}
            </span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{r.name}</span>
              <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto' }}>{r.model}</span>
            </div>
            <div style={{ fontSize: 12, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              {statusBadge(r.keyConfigured)}
              <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>API Key</span>
              {r.error && <span style={{ color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 }}>{r.error}</span>}
            </div>
            {r.type === 'image' && r.textToImage && (
              <div style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                {statusBadge(r.textToImage.ok)}
                <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>文生图</span>
                {r.textToImage.detail && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({r.textToImage.detail})</span>}
              </div>
            )}
            {r.type === 'image' && r.imageToImage && (
              <div style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                {statusBadge(r.imageToImage.ok)}
                <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>图生图</span>
                {r.imageToImage.formats.length > 0 && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({r.imageToImage.formats.join('、')})</span>}
              </div>
            )}
            {r.type === 'video' && r.textToVideo && (
              <div style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                {statusBadge(r.textToVideo.ok)}
                <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>文生视频</span>
                {r.textToVideo.detail && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({r.textToVideo.detail})</span>}
              </div>
            )}
            {r.type === 'video' && r.imageToVideo && (
              <div style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                {statusBadge(r.imageToVideo.ok)}
                <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>图生视频</span>
                {r.imageToVideo.detail && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({r.imageToVideo.detail})</span>}
              </div>
            )}
          </div>
        ))}

        {results && results.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' }}>
            检测完成，共 {results.length} 个渠道
          </div>
        )}
      </div>
    </div>
  )
}