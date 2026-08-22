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
}

interface MakemakeSettings {
  enabled?: boolean
  imageChannels?: Channel[]
  videoChannels?: Channel[]
  selectedImageChannel?: string
  selectedVideoChannel?: string
}

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
.dsh-mm-badge{position:absolute;top:-6px;right:8px;font-size:10px;line-height:16px;font-weight:600;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 6px}
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

  // 只给 /make 命令高亮亮蓝色，其他命令保持默认颜色
  ctx.effect(() => {
    let mo: MutationObserver | null = null
    const paint = () => {
      document.querySelectorAll<HTMLElement>('mark[data-decoration="token"]').forEach(el => {
        const text = el.textContent ?? ''
        if (text.startsWith('/make')) {
          el.style.color = '#00d4ff'
          el.style.textShadow = '0 0 10px rgba(0,212,255,0.5)'
        } else {
          // 非 /make 命令：清除内联样式，恢复 DSH 默认高亮色
          el.style.color = ''
          el.style.textShadow = ''
        }
      })
    }
    // 初始执行
    paint()
    // 监听 backdrop 区域变化
    const target = document.querySelector('.uV2eYG_backdrop') || document.querySelector('[class*="backdrop"]')
    if (target) {
      mo = new MutationObserver(paint)
      mo.observe(target, { childList: true, subtree: true, characterData: true })
    }
    // fallback: 每 500ms 检查一次
    const iv = setInterval(paint, 500)
    return () => { mo?.disconnect(); clearInterval(iv) }
  }, 'dsh-makemake: hl-color')

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

  // 快捷按钮
  ctx.slots.inject('conversation.input.left' as any, () => (ctx.slots.register as any)({
    name: 'conversation.input.left',
    id: 'dsh-makemake-btns',
    order: 90,
    inject: (): { scope: SettingsScope<MakemakeSettings> } => ({ scope }),
  }, (props: { scope: SettingsScope<MakemakeSettings> }) => <MakeMakeButtons scope={props.scope} />))
}

function MakeMakeButtons({ scope }: { scope: SettingsScope<MakemakeSettings> }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    try {
      const v = scope.getSnapshot()
      setVisible(v.value?.enabled !== false)
    } catch { /* ignore */ }
  }, [])
  if (!visible) return null
  const inject = (cmd: string) => {
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')
    if (!ta) return
    ta.focus()
    const nativeInput = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    nativeInput?.set?.call(ta, ta.value + cmd)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return (
    <>
      <button type="button" onClick={() => inject('/make出图 ')}
        title="点击填入出图命令"
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
      <button type="button" onClick={() => inject('/make视频 ')}
        title="点击填入出视频命令"
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
    </>
  )
}

function MakemakePluginCard(props: CardProps) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('0.1.1-rc.2')
  const [hasUpdate, setHasUpdate] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
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
          <Button variant="outline" size="sm" onClick={(e: React.MouseEvent) => e.stopPropagation()}>{'环境检测'}</Button>
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
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [imageChannels, setImageChannels] = useState<Channel[]>([])
  const [videoChannels, setVideoChannels] = useState<Channel[]>([])
  const [selectedImageChannel, setSelectedImageChannel] = useState('')
  const [selectedVideoChannel, setSelectedVideoChannel] = useState('')

  useEffect(() => {
    const load = () => {
      try {
        const v = scope.getSnapshot()
        if (v.value?.enabled !== undefined) setEnabled(v.value.enabled)
        setImageChannels(v.value?.imageChannels ?? [])
        setVideoChannels(v.value?.videoChannels ?? [])
        setSelectedImageChannel(v.value?.selectedImageChannel ?? '')
        setSelectedVideoChannel(v.value?.selectedVideoChannel ?? '')
      } catch { /* ignore */ }
    }
    load()
    return scope.subscribe(load)
  }, [])

  const toggleEnabled = async () => {
    await scope.set('enabled', !enabled)
    setEnabled(v => !v)
  }

  const channels = openPanel === 'image' ? imageChannels : openPanel === 'video' ? videoChannels : []
  const selectedId = openPanel === 'image' ? selectedImageChannel : selectedVideoChannel

  const startEdit = (type: 'image' | 'video', ch?: Channel) => {
    const id = ch?.id ?? `new-${Date.now()}`
    setEditing({ type, id })
    setChName(ch?.name ?? '')
    setChBaseURL(ch?.baseURL ?? '')
    setChModel(ch?.model ?? '')
    setChKey('')
    setKeyConfigured(false)
    if (ch) {
      void pluginSettings.describeCredentials([credentialRef(ch.id)]).then(res => {
        if (res.ok) setKeyConfigured(res.credentials[credentialRef(ch.id)]?.configured ?? false)
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
        const newCh: Channel = { id: newId, name: chName || chModel, baseURL: chBaseURL, model: chModel }
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
        const updated = current.map((ch: any) => ch.id === editing.id ? { ...ch, name: chName, baseURL: chBaseURL, model: chModel } : ch)
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
          inputStyle={inputStyle} fieldStyle={fieldStyle} labelStyle={labelStyle}
          startEdit={startEdit} saveChannel={saveChannel} deleteChannel={deleteChannel}
          setChName={setChName} setChBaseURL={setChBaseURL} setChModel={setChModel} setChKey={setChKey}
          setKeyConfigured={setKeyConfigured} setEditing={setEditing} saveMsg={saveMsg}
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
          inputStyle={inputStyle} fieldStyle={fieldStyle} labelStyle={labelStyle}
          startEdit={startEdit} saveChannel={saveChannel} deleteChannel={deleteChannel}
          setChName={setChName} setChBaseURL={setChBaseURL} setChModel={setChModel} setChKey={setChKey}
          setKeyConfigured={setKeyConfigured} setEditing={setEditing} saveMsg={saveMsg}
        />
      )}
    </>
  )
}

function VideoChannelPanel({
  type, channels, selectedId, editing, scope, chName, chBaseURL, chModel, chKey, keyConfigured,
  inputStyle, fieldStyle, labelStyle, startEdit, saveChannel, deleteChannel,
  setChName, setChBaseURL, setChModel, setChKey, setKeyConfigured, setEditing, saveMsg,
}: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
            <div style={{ fontSize: 13, fontWeight: 500 }}>{ch.name}</div>
            <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{ch.model}</div>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {saveMsg && (
              <span style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
                {saveMsg}
              </span>
            )}
            <button onClick={() => setEditing(null)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', cursor: 'pointer' }}>取消</button>
            <button onClick={saveChannel} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--dsw-alias-state-success-primary)', color: '#fff', cursor: 'pointer' }}>保存</button>
          </div>
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
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', maxWidth: '100%', flexWrap: 'wrap' }}>
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
                  {/* 分辨率 */}
                  <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {att.width}×{att.height}
                  </span>
                  {/* 大小 */}
                  <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' }}>
                    {(att.bytes / 1024).toFixed(0)} KB
                  </span>
                  {/* 提示词 */}
                  {prompt && (
                    <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'default' }}
                      title={prompt}>{prompt}</span>
                  )}
                  {/* 复制提示词 */}
                  <button onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(prompt) }}
                    style={{ flex: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
                      color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'var(--dsw-alias-bg-layer-1)' }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'transparent' }}>
                    复制提示词
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
          <button className="dsh-mm-modal-close" onClick={closeModal}>✕</button>
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

  // 视频结果：纯文字链接
  if (textBlocks.length > 0) {
    return <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.5, marginTop: 4 }}>{textBlocks.map((b: any) => b.text).join('')}</div>
  }
  return null
}