/** Make Make — multi-provider image/video generation UI for DeepSeek Harness. */
import { useEffect, useState } from 'react'
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
interface ImageCardFace {}
type CardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<SettingsFace>
type ImageCardProps = PropsRuntime<'tool.call.toolview'> & InjectFace<ImageCardFace>

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

  // Build pluginSettings client (use DSH core connection API, not looklook remote)
  const pluginSettingsListeners = new Set<() => void>()
  const pluginSettings: PluginSettingsClient = {
    subscribe: (listener) => {
      pluginSettingsListeners.add(listener)
      return () => { pluginSettingsListeners.delete(listener) }
    },
    describe: async () => {
      try {
        const res: any = await api.settings.describe({})
        // DSH returns { rpcId, result: { ok, value } }
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

  const register = ctx.slots.register.bind(ctx.slots) as unknown as (opts: object, comp: unknown) => () => void

  // Plugin card
  ctx.slots.inject('settings.plugin.item', () => register({
    name: 'settings.plugin.item',
    key: CREATION_NAMESPACE,
    id: CREATION_NAMESPACE,
    order: 90,
    inject: (): SettingsFace => ({ scope, pluginSettings }),
  }, MakemakePluginCard))

  // Printer toggle
  ctx.slots.inject('conversation.input.right' as any, () => (ctx.slots.register as any)({
    name: 'conversation.input.right',
    id: 'dsh-makemake-printer',
    order: 100,
    inject: (sessionId: string): { scope: SettingsScope<MakemakeSettings> } => ({ scope }),
  }, PrinterToggle))
}

// ─── Plugin Card ──────────────────────────────────────────────────────────

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
          <span className="dsh-mm-desc">支持生成图像和视频的插件。AI 可以为你画图、生成视频，后续支持文档生成。</span>
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

// ─── Plugin body ───────────────────────────────────────────────────────────

function PluginBody({ scope, pluginSettings }: { scope: SettingsScope<MakemakeSettings>; pluginSettings: PluginSettingsClient }) {
  const [enabled, setEnabled] = useState(true)
  const [openPanel, setOpenPanel] = useState<'image' | 'video' | null>(null)
  // Edit form state
  const [editing, setEditing] = useState<{ type: 'image' | 'video'; id: string } | null>(null)
  const [chName, setChName] = useState('')
  const [chBaseURL, setChBaseURL] = useState('')
  const [chModel, setChModel] = useState('')
  const [chKey, setChKey] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    try {
      const v = scope.getSnapshot()
      if (v.value?.enabled !== undefined) setEnabled(v.value.enabled)
    } catch { /* ignore */ }
    return scope.subscribe(() => {
      try {
        const v = scope.getSnapshot()
        if (v.value?.enabled !== undefined) setEnabled(v.value.enabled)
      } catch { /* ignore */ }
    })
  }, [])

  const toggleEnabled = async () => {
    await scope.set('enabled', !enabled)
    setEnabled(v => !v)
  }

  const channels = openPanel === 'image'
    ? (scope.getSnapshot().value?.imageChannels ?? [])
    : openPanel === 'video'
    ? (scope.getSnapshot().value?.videoChannels ?? [])
    : []

  const selectedId = openPanel === 'image'
    ? scope.getSnapshot().value?.selectedImageChannel
    : scope.getSnapshot().value?.selectedVideoChannel

  const startEdit = (type: 'image' | 'video', ch?: Channel) => {
    const id = ch?.id ?? `new-${Date.now()}`
    setEditing({ type, id })
    setChName(ch?.name ?? '')
    setChBaseURL(ch?.baseURL ?? '')
    setChModel(ch?.model ?? '')
    setChKey('')
    setKeyConfigured(false)
    // Check if key is configured for existing channel
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
    const current = [...(scope.getSnapshot().value?.[key] ?? [])]
    const isNew = editing.id.startsWith('new-')

    try {
      if (isNew) {
        const newId = `ch-${Date.now()}`
        const newCh: Channel = { id: newId, name: chName || chModel, baseURL: chBaseURL, model: chModel }
        // Save API key to credentials
        if (chKey.trim()) {
          const cred = await pluginSettings.setCredential(credentialRef(newId), chKey.trim())
          if (!cred.ok) throw new Error(cred.error)
        }
        await scope.set(key, [...current, newCh])
      } else {
        // Update existing
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
    const current = [...(scope.getSnapshot().value?.[key] ?? [])]
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
          <div className="dsh-mm-master-note">{enabled ? 'AI 可以调用 generate_image 工具生成图片' : '关闭后 AI 无法调用图像生成工具'}</div>
        </div>
      </div>

      <div className="dsh-mm-buttons">
        <BigButton icon={<LucideImage size={22} />} label="出图模型" configured={true}
          active={openPanel === 'image'} onClick={() => setOpenPanel(p => p === 'image' ? null : 'image')} />
        <BigButton icon={<LucideVideo size={22} />} label="视频模型" tag="待开发" configured={false}
          active={openPanel === 'video'} onClick={() => setOpenPanel(p => p === 'video' ? null : 'video')} />
      </div>

      {openPanel === 'image' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(channels as any[]).length === 0 && !editing && (
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', padding: '8px 0' }}>暂无渠道，点击下方按钮添加</div>
          )}
          {(channels as any[]).map((ch: any) => (
            <div key={ch.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8,
              border: selectedId === ch.id ? '2px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
              background: selectedId === ch.id ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' : 'transparent',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{ch.name}</div>
                <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{ch.model}</div>
              </div>
              <button type="button" onClick={() => { void scope.set('selectedImageChannel', ch.id) }}
                style={{ background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', color: selectedId === ch.id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)' }}>
                {selectedId === ch.id ? '✓' : '○'}
              </button>
              <button type="button" onClick={() => startEdit('image', ch)}
                style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', fontSize: 14, color: 'var(--dsw-alias-label-tertiary)' }}>✏️</button>
              <button type="button" onClick={() => { void deleteChannel('image', ch.id) }}
                style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', fontSize: 14, color: 'var(--dsw-alias-state-error-primary)' }}>🗑</button>
            </div>
          ))}
          <button type="button" onClick={() => startEdit('image')} style={{
            fontSize: 12, color: 'var(--dsw-alias-brand-primary)', background: 'none',
            border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', alignSelf: 'flex-start',
          }}>+ 添加渠道</button>

          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>渠道名称</label>
                <input style={inputStyle} value={chName} onChange={e => setChName(e.target.value)} placeholder="如：精品出图" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>接口地址</label>
                <input style={inputStyle} value={chBaseURL} onChange={e => setChBaseURL(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>模型名</label>
                <input style={inputStyle} value={chModel} onChange={e => setChModel(e.target.value)} placeholder="gpt-image-2" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>API Key</label>
                <input style={inputStyle} type="password" autoComplete="off" value={chKey} onChange={e => setChKey(e.target.value)}
                  placeholder={keyConfigured ? '留空保持已配置的 Key' : '输入 API Key'} />
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
      )}
    </>
  )
}

// ─── Big button ────────────────────────────────────────────────────────────

function BigButton({ icon, label, tag, configured, active, onClick }: {
  icon: ReactNode; label: string; tag?: string; configured: boolean; active: boolean; onClick: () => void
}) {
  return (
    <button type="button" className={`dsh-mm-bigbtn ${active ? 'active' : ''}`} onClick={onClick}>
      {tag && <span className="dsh-mm-badge">{tag}</span>}
      <span className="dsh-mm-bigbtn-icon">{icon}</span>
      <span className="dsh-mm-bigbtn-label">{label}</span>
      <span className={`dsh-mm-dot ${configured ? 'ok' : 'off'}`} />
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{
        marginTop: 2, transition: 'transform .15s', transform: active ? 'rotate(180deg)' : 'none',
        color: 'var(--dsw-alias-label-tertiary)',
      }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}

// ─── Printer toggle in input area ────────────────────────────────────────
// Behavior matches LookLook's eye icon:
// - Plugin disabled in settings → button disappears entirely
// - Button visible → click toggles per-session on/off (icon dims)
// - Permanent on/off controlled by settings page only
//
function PrinterToggle({ scope }: { scope: SettingsScope<MakemakeSettings> }) {
  // visible: controlled by settings page master switch (enabled field)
  const [visible, setVisible] = useState(true)
  // active: local temporary toggle (click to dim/brighten, NOT persisted)
  const [active, setActive] = useState(true)

  useEffect(() => {
    const loadState = () => {
      try {
        const v = scope.getSnapshot().value
        setVisible(v?.enabled !== false)
        // Sync active with master switch on load (start fresh each page)
        setActive(v?.enabled !== false)
      } catch { /* ignore */ }
    }
    loadState()
    return scope.subscribe(loadState)
  }, [])

  // Hidden when plugin is disabled in settings (same as eye icon)
  if (!visible) return null

  const toggle = () => {
    // Local toggle only - does NOT touch settings
    // This is a temporary per-session toggle, like LookLook's eye
    setActive(v => !v)
  }

  return (
    <button type="button" onClick={toggle}
      title={active ? '临时关闭生成工具' : '临时开启生成工具'}
      style={{
        display: 'grid', placeItems: 'center', flex: 'none', width: 28, height: 28,
        border: 'none', borderRadius: 999, background: 'transparent', cursor: 'pointer',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)',
        opacity: active ? 0.7 : 0.3,
        transition: 'color .15s, opacity .15s',
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
        {active === false && <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  )
}

// ─── Lucide icons ──────────────────────────────────────────────────────────

function L({ d, size }: { d: ReactNode; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</g></svg>
}

const LucideImage = ({ size }: { size: number }) => (
  <L size={size} d={[<rect key="r" x="3" y="3" width="18" height="18" rx="2" ry="2" />, <circle key="c" cx="8.5" cy="8.5" r="1.5" />, <path key="p" d="m21 15-5-5L5 21" />]} />
)

const LucideVideo = ({ size }: { size: number }) => (
  <L size={size} d={[<rect key="r" x="2" y="4" width="14" height="16" rx="2" ry="2" />, <path key="p1" d="m16 8 4-2.5v13L16 16" />]} />
)