/** Make Make — multi-provider image generation UI for DeepSeek Harness. */
import { useEffect, useState, type FormEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  CREATION_NAMESPACE,
  IMAGE_ROUTE,
  type ImageProvider,
} from '../shared.js'

type Provider = ImageProvider

interface ImageSettings {
  provider?: Provider
  googleModel?: string
  googleEndpoint?: string
  openaiBaseURL?: string
  openaiModel?: string
  seedreamBaseURL?: string
  seedreamModel?: string
}

interface SettingsFace {
  scope: SettingsScope<ImageSettings>
  credentials: ConnectionHandle['api']['credentials']
}
interface ImageCardFace {}
type SettingsCardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<SettingsFace>
type ImageCardProps = PropsRuntime<'tool.call.toolview'> & InjectFace<ImageCardFace>

const KEY_REF: Record<Provider, string> = {
  google: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  seedream: 'ARK_API_KEY',
}

const DICT = {
  zh: {
    title: '图像生成',
    description: '选择厂商并配置生图模型。',
    provider: '提供商',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI / 中转站',
    providerSeedream: '字节 Seedream',
    apiKeyLabel: '{provider} API Key',
    apiKeyPlaceholder: '留空即可保留已配置的 Key',
    apiKeyHint: '安全保存为 {key}；页面不会读回明文。',
    endpoint: '接口地址',
    reset: '重置',
    resetTitle: '重置为默认官方地址',
    endpointHintGoogle: 'Google 官方地址或反代端点（全路径）。',
    endpointHintOpenAI: '中转站请填其 OpenAI 兼容的 /v1 地址。',
    endpointHintSeedream: '火山方舟兼容的 /api/v3 地址。',
    model: '模型',
    saving: '保存中…',
    save: '保存',
    saved: '已保存',
    checkingKey: '正在检查 API Key…',
    keyConfigured: '已配置 API Key',
    keyNotConfigured: '尚未配置 API Key',
    generatedTitle: '已生成图片',
    generating: '正在生成图片…',
    loading: '正在加载图片…',
    loadFailed: '图片读取失败 ({status})',
    copyImg: '复制图片',
    download: '下载图片',
    openNewTab: '新标签页打开',
    copiedImage: '已复制图片',
    copyFailed: '复制失败',
  },
  en: {
    title: 'Image Generation',
    description: 'Select provider and configure image generation models.',
    provider: 'Provider',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI / Relay',
    providerSeedream: 'ByteDance Seedream',
    apiKeyLabel: '{provider} API Key',
    apiKeyPlaceholder: 'Leave empty to keep configured key',
    apiKeyHint: 'Securely saved as {key}; never read back in plaintext.',
    endpoint: 'Endpoint / Base URL',
    reset: 'Reset',
    resetTitle: 'Reset to official default URL',
    endpointHintGoogle: 'Official Google endpoint or reverse proxy (full path).',
    endpointHintOpenAI: 'OpenAI-compatible /v1 base URL for relays.',
    endpointHintSeedream: 'Volcengine Ark compatible /api/v3 base URL.',
    model: 'Model',
    saving: 'Saving…',
    save: 'Save',
    saved: 'Saved',
    checkingKey: 'Checking API Key…',
    keyConfigured: 'API Key configured',
    keyNotConfigured: 'API Key not configured',
    generatedTitle: 'Generated image',
    generating: 'Generating image…',
    loading: 'Loading image…',
    loadFailed: 'Failed to load image ({status})',
    copyImg: 'Copy Image',
    download: 'Download Image',
    openNewTab: 'Open in new tab',
    copiedImage: 'Image copied',
    copyFailed: 'Copy failed',
  },
} as const

type DictKey = keyof typeof DICT.zh

const STYLE = `
.dsh-mm-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s,background .16s;overflow:hidden}
.dsh-mm-card:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-mm-card-open{background:var(--dsw-alias-bg-layer-2,#fff);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-mm-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-mm-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:-2px}
.dsh-mm-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-mm-title{display:block;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.dsh-mm-desc{display:block;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b)}
.dsh-mm-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#7b818b);transition:transform .16s;display:inline-flex;align-items:center}
.dsh-mm-chevron-open{transform:rotate(180deg)}
.dsh-mm-body{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:0 16px 16px}
.dsh-mm-field{display:grid;gap:6px;margin-top:14px}
.dsh-mm-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
.dsh-mm-input{box-sizing:border-box;width:100%;padding:8px 12px;font-size:13px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit;outline:none;transition:border-color .15s}
.dsh-mm-input:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff)}
.dsh-mm-input-group{display:flex;gap:8px;align-items:center}
.dsh-mm-btn-reset{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.dsh-mm-btn-reset:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-mm-hint,.dsh-mm-status{margin:0;color:var(--dsw-alias-label-tertiary,#7b818b);font-size:12px;line-height:1.4}
.dsh-mm-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,#eee)}
.dsh-mm-save{appearance:none;border:0;border-radius:8px;padding:6px 16px;background:var(--dsw-alias-label-primary,#111827);color:var(--dsw-alias-bg-layer-3,#fff);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s}
.dsh-mm-save:disabled{opacity:.4;cursor:default}

.dsh-mm-result{display:grid;gap:10px;max-width:520px}
.dsh-mm-result-title{font-size:14px;font-weight:600}
.dsh-mm-container{position:relative;display:inline-block;width:fit-content;max-width:100%;justify-self:start;border-radius:12px;overflow:hidden;line-height:0}
.dsh-mm-container:hover .dsh-mm-toolbar{opacity:1;pointer-events:auto}
.dsh-mm-toolbar{position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:8px;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:10;line-height:1}
.dsh-mm-tool-btn{appearance:none;border:0;background:transparent;color:#fff;padding:5px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s}
.dsh-mm-tool-btn:hover{background:rgba(255,255,255,0.25)}
.dsh-mm-toast{position:absolute;top:100%;left:0;margin-top:5px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;white-space:nowrap;pointer-events:none;z-index:20}
.dsh-mm-image{display:block;max-width:100%;max-height:520px;border-radius:12px;background:#f2f3f5;cursor:pointer}
@keyframes dsh-mm-fade{from{opacity:0}to{opacity:1}}
.dsh-mm-error{color:var(--dsw-alias-label-error,#d33);font-size:13px}
.dsh-mm-loading{color:var(--dsw-alias-label-tertiary,#7b818b);font-size:13px}
.dsh-mm-lightbox-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;animation:dsh-mm-fade .15s ease-out}
.dsh-mm-lightbox-img-wrap{max-width:86vw;max-height:78vh;display:flex;align-items:center;justify-content:center;cursor:default}
.dsh-mm-lightbox-img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,0.7);user-select:none}
`

export const inject = ['slots', 'connection', 'remote', 'settingsScope'] as const

export function apply(ctx: Context): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<ImageSettings>({ namespace: CREATION_NAMESPACE as never })

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-makemake'
    style.textContent = STYLE
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-makemake: styles')

  const register = ctx.slots.register.bind(ctx.slots) as unknown as (options: object, component: unknown) => () => void

  // 1. Settings item
  ctx.slots.inject('settings.plugin.item', () => register({
    name: 'settings.plugin.item',
    key: CREATION_NAMESPACE,
    id: CREATION_NAMESPACE,
    order: 100,
    inject: (): SettingsFace => ({ scope, credentials: api.credentials }),
  }, ImageGenerationSettingsCard))

  // 2. Tool result view card in chat stream
  ctx.slots.inject('tool.call.toolview', () => register({
    name: 'tool.call.toolview',
    key: 'generate_image',
    inject: (): ImageCardFace => ({}),
  }, GeneratedImageCard))
}

function imageRef(block: unknown): ImageAttachmentRef | undefined {
  const b = block as { meta?: Record<string, unknown>; resultView?: { meta?: Record<string, unknown> }; call?: { args?: { prompt?: string } } }
  const meta = b.meta ?? b.resultView?.meta
  if (!meta?.attachment) return undefined
  const ref = meta.attachment as ImageAttachmentRef
  if (ref && typeof ref.attachmentId === 'string') return ref
  return undefined
}

/** Edit provider settings and its write-only API credential. */
function ImageGenerationSettingsCard(props: SettingsCardProps) {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState(() => props.scope.getSnapshot())
  const [provider, setProvider] = useState<Provider>('google')
  const [model, setModel] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [key, setKey] = useState('')
  const [configured, setConfigured] = useState<boolean | undefined>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => props.scope.subscribe(() => { setSnapshot(props.scope.getSnapshot()) }), [props.scope])

  useEffect(() => {
    const value = snapshot.value
    const next = value?.provider ?? 'google'
    setProvider(next)
    setModel(modelOf(next, value))
    setBaseURL(baseURLOf(next, value))
  }, [snapshot])

  useEffect(() => {
    let active = true
    void props.credentials.describe({ refs: [KEY_REF[provider]] }).then(response => {
      if (active) setConfigured(response.result.ok ? response.result.value.credentials[KEY_REF[provider]]?.configured ?? false : undefined)
    }).catch(() => { if (active) setConfigured(undefined) })
    return () => { active = false }
  }, [props.credentials, provider])

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await props.scope.set('provider', provider)
      await props.scope.set(provider === 'google' ? 'googleModel' : provider === 'openai' ? 'openaiModel' : 'seedreamModel', model)
      await props.scope.set(provider === 'google' ? 'googleEndpoint' : provider === 'openai' ? 'openaiBaseURL' : 'seedreamBaseURL', baseURL)
      if (key.trim().length > 0) {
        const response = await props.credentials.set({ ref: KEY_REF[provider], value: key.trim() })
        if (!response.result.ok) throw new Error(response.result.error.message)
        setKey('')
        setConfigured(true)
      }
      setMessage('已保存')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally { setSaving(false) }
  }

  const providerLabels: Record<Provider, string> = {
    google: 'Google Gemini',
    openai: 'OpenAI / 中转站',
    seedream: '字节 Seedream',
  }

  const keyStatus = configured === undefined ? '正在检查 API Key…' : configured ? '已配置 API Key' : '尚未配置 API Key'

  return (
    <li className={`dsh-mm-card ${open ? 'dsh-mm-card-open' : ''}`}>
      <button type="button" className="dsh-mm-head" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className="dsh-mm-head-text">
          <span className="dsh-mm-title">图像生成</span>
          <span className="dsh-mm-desc">选择厂商并配置生图模型。</span>
        </span>
        <span className={`dsh-mm-chevron ${open ? 'dsh-mm-chevron-open' : ''}`} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>
        </span>
      </button>
      {open ? (
        <form className="dsh-mm-body" onSubmit={(event) => { void save(event) }}>
          <label className="dsh-mm-field">
            <span className="dsh-mm-label">提供商</span>
            <select className="dsh-mm-input" value={provider} onChange={event => { const next = event.target.value as Provider; setProvider(next); setModel(modelOf(next, snapshot.value)); setBaseURL(baseURLOf(next, snapshot.value)); setKey('') }}>
              <option value="google">Google Gemini</option>
              <option value="openai">OpenAI / 中转站</option>
              <option value="seedream">字节 Seedream</option>
            </select>
          </label>
          <label className="dsh-mm-field">
            <span className="dsh-mm-label">{providerLabels[provider]} API Key</span>
            <input className="dsh-mm-input" type="password" autoComplete="off" value={key} onChange={event => { setKey(event.target.value) }} placeholder={configured ? '留空即可保留已配置的 Key' : ''} />
            <span className="dsh-mm-hint">安全保存为 {KEY_REF[provider]}；页面不会读回明文。</span>
          </label>
          <label className="dsh-mm-field">
            <span className="dsh-mm-label">接口地址</span>
            <div className="dsh-mm-input-group">
              <input className="dsh-mm-input" type="url" value={baseURL} onChange={event => { setBaseURL(event.target.value) }} required />
              <button type="button" className="dsh-mm-btn-reset" title="重置为默认官方地址" onClick={() => { setBaseURL(DEFAULT_BASE_URLS[provider]) }}>重置</button>
            </div>
            <span className="dsh-mm-hint">
              {provider === 'google' ? 'Google 官方地址或反代端点（全路径）。'
               : provider === 'openai' ? '中转站请填其 OpenAI 兼容的 /v1 地址。'
               : '火山方舟兼容的 /api/v3 地址。'}
            </span>
          </label>
          <label className="dsh-mm-field">
            <span className="dsh-mm-label">模型</span>
            <input className="dsh-mm-input" value={model} onChange={event => { setModel(event.target.value) }} required />
          </label>
          <div className="dsh-mm-actions">
            <p className="dsh-mm-status" role="status">{message || keyStatus}</p>
            <button className="dsh-mm-save" type="submit" disabled={saving || !snapshot.writable}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

function modelOf(provider: Provider, value?: ImageSettings): string {
  if (!value) return DEFAULT_MODELS[provider]
  if (provider === 'google') return value.googleModel ?? DEFAULT_MODELS.google
  if (provider === 'openai') return value.openaiModel ?? DEFAULT_MODELS.openai
  return value.seedreamModel ?? DEFAULT_MODELS.seedream
}

function baseURLOf(provider: Provider, value?: ImageSettings): string {
  if (!value) return DEFAULT_BASE_URLS[provider]
  if (provider === 'google') return value.googleEndpoint ?? DEFAULT_BASE_URLS.google
  if (provider === 'openai') return value.openaiBaseURL ?? DEFAULT_BASE_URLS.openai
  return value.seedreamBaseURL ?? DEFAULT_BASE_URLS.seedream
}

/** Render the durable attachment referenced by a completed image tool call. */
function GeneratedImageCard(props: ImageCardProps) {
  const attachment = imageRef(props.block)
  const [url, setUrl] = useState<string>()
  const [blob, setBlob] = useState<Blob>()
  const [error, setError] = useState<string>()
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (attachment === undefined) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    void fetch(IMAGE_ROUTE, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attachment }),
    }).then(async response => {
      if (!response.ok) throw new Error(`图片读取失败 (${response.status})`)
      const resBlob = await response.blob()
      if (controller.signal.aborted) return
      setBlob(resBlob)
      objectUrl = URL.createObjectURL(resBlob)
      setUrl(objectUrl)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment?.attachmentId])

  useEffect(() => {
    if (!previewOpen) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [previewOpen])

  if (attachment === undefined) return null
  return (
    <section className="dsh-mm-result" aria-label="已生成图片">
      <div className="dsh-mm-result-title">已生成图片</div>
      {error !== undefined ? <div className="dsh-mm-error">{error}</div> : null}
      {url === undefined && error === undefined ? <div className="dsh-mm-loading">正在加载图片…</div> : null}
      {url !== undefined ? (
        <div className="dsh-mm-container">
          <img className="dsh-mm-image" src={url} alt="Generated image" onClick={() => { setPreviewOpen(true) }} />
          {/* preview */}
          {previewOpen && url !== undefined ? (
            <div className="dsh-mm-lightbox-backdrop" onClick={() => { setPreviewOpen(false) }}>
              <div className="dsh-mm-lightbox-img-wrap" onClick={(e) => { e.stopPropagation() }}>
                <img className="dsh-mm-lightbox-img" src={url} alt="Generated image" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}