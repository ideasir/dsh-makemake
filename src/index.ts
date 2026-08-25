/** Make Make — image + video generation bundle for DeepSeek Harness.
 * Multi-channel: each channel = one OpenAI-compatible endpoint (universal). */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config } from './config.js'
import { IMAGE_ROUTE } from './shared.js'
import { serveImage } from './image-route.js'
import { CREATION_NAMESPACE } from './shared.js'
import { MAKEMAKESKILL } from './skill.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export { Config } from './config.js'
export { IMAGE_ROUTE } from './shared.js'

/** Cordis plugin name. */
export const name = 'dsh-makemake'
/** Host services required by the Bundle. */
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings', 'commands', 'systemPrompt']

interface Channel {
  id: string
  name: string
  baseURL: string
  model: string
}

function channelCredentialRef(channelId: string): string {
  return `MAKEMAKE_CHANNEL_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** 把 HTTP 状态码/错误文本归类为人类可读的错误类型，方便用户快速定位 */
function classifyError(status: number | undefined, text: string): string {
  const upper = (text ?? '').toUpperCase()
  if (status === 401 || /UNAUTHORIZED|INVALID.*KEY|API_KEY|AUTHENTICATION|403/.test(upper)) {
    return 'API Key 无效或已过期（检查渠道配置的 Key 是否正确）'
  }
  if (status === 429 || /RATE.?LIMIT|TOO MANY|QUOTA|LIMIT/.test(upper)) {
    return '请求过于频繁（触发限流/配额，稍后重试或换一个 Key）'
  }
  if (status === 404 || /NOT FOUND|NO SUCH|ENDPOINT/.test(upper)) {
    return '端点不存在（检查接口地址 baseURL 与模型名是否匹配）'
  }
  if (status === 400 || /BAD REQUEST|INVALID|MISSING|PARAMETER/.test(upper)) {
    return '请求参数错误（检查模型名、尺寸、字段格式是否正确）'
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 || /SERVER ERROR|GATEWAY/.test(upper)) {
    return '上游服务错误/不可用（服务端故障，稍后重试）'
  }
  if (status === 408 || /TIMEOUT|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|NETWORK|FETCH FAILED|UND_ERR/.test(upper)) {
    return '网络连接失败（检查服务器能否访问该接口地址）'
  }
  return `未分类错误（HTTP ${status ?? '无'}）：${text}`.slice(0, 300)
}

interface RuntimeSettings {
  imageChannels?: Channel[]
  videoChannels?: Channel[]
  selectedImageChannel?: string
  selectedVideoChannel?: string
  activeMode?: 'image' | 'video' | null
  enabled?: boolean
}

function resolveChannel(settings: RuntimeSettings, type: 'image' | 'video'): Channel | undefined {
  const channels = type === 'image' ? settings.imageChannels : settings.videoChannels
  const selectedId = type === 'image' ? settings.selectedImageChannel : settings.selectedVideoChannel
  if (!Array.isArray(channels) || channels.length === 0) return undefined
  const selected = channels.find(c => c.id === selectedId)
  return selected ?? channels[0]
}

/** Multi-key pool: round-robin + auto-skip on 429/busy keys. */
class KeyPool {
  private keys: string[] = []
  private idx = 0
  /** Keys currently rate-limited (429) — skipped until timestamp passes. */
  private cooldown = new Map<string, number>()

  constructor(raw: string) {
    // 拆分：支持换行、逗号、分号、空格分隔；去重、去空
    const parts = raw.split(/[\n\r,;\s]+/).map(s => s.trim()).filter(s => s.length > 0)
    this.keys = [...new Set(parts)]
  }

  get size(): number { return this.keys.length }

  /** Take next available key. Returns null if all are cooling down. */
  next(): string | null {
    if (this.keys.length === 0) return null
    const now = Date.now()
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.idx + i) % this.keys.length]
      if (!k) continue
      const until = this.cooldown.get(k) ?? 0
      if (now >= until) {
        this.idx = (this.idx + i + 1) % this.keys.length
        return k
      }
    }
    return null
  }

  /** Mark a key as failed (429 / busy) for a while. */
  fail(key: string, ms = 60_000): void {
    this.cooldown.set(key, Date.now() + ms)
  }
}

/** 每个渠道持久化一个 KeyPool（按渠道 id 缓存） */
const keyPools = new Map<string, KeyPool>()

function getKeyPool(channelId: string, raw: string): KeyPool {
  let pool = keyPools.get(channelId)
  if (!pool) {
    pool = new KeyPool(raw)
    keyPools.set(channelId, pool)
  }
  return pool
}

export function apply(ctx: Context, config: Config = {}): void {
  const scope = ctx.settings.register(settingsNamespace(CREATION_NAMESPACE), Config, { base: config })
  let current: () => Config = () => scope.get()
  const dshHome = process.env.DSH_HOME ?? '/root/.dsh'

  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: IMAGE_ROUTE,
      handler: (req, res) => serveImage(req, res, {
        readImage: async (ref) => {
          const hash = ref.attachmentId.replace(/^sha256:/, '')
          const filePath = path.join(dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
          const data = await fs.readFile(filePath)
          return { ref, data } as any
        },
      }),
    })
    return () => {}
  }, 'dsh-makemake: image route')

  // ─── 渠道检测路由 ──────────────────────────────────────────────────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: '/plugins/dsh-makemake/test',
      handler: async (req, res) => {
        // 读取请求体（Node IncomingMessage 是流）
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const raw = Buffer.concat(chunks).toString('utf8')
        const body = JSON.parse(raw || '{}') as {
          type: 'image' | 'video'
          baseURL: string; model: string; apiKey: string; channelId?: string
        }
        const { type, baseURL: rawBase, model, apiKey: rawApiKey, channelId } = body
        // 如果前端没传 Key，尝试从凭据库取
        let apiKey = rawApiKey
        if (!apiKey && channelId) {
          const cred = await ctx.credentials.resolve(channelCredentialRef(channelId)).catch(() => null)
          if (cred?.value) {
            // 取第一个 Key（多 Key 时取第一个）
            apiKey = cred.value.split(/[\n\r,;]+/)[0]?.trim() ?? ''
          }
        }
        const base = rawBase.replace(/\/+$/, '')
        const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
        const result: { ok: boolean; textToImage?: { ok: boolean; endpoint: string; detail?: string }; imageToImage?: { ok: boolean; endpoint: string; formats: string[] }; video?: { ok: boolean; endpoint: string }; videoToImage?: { ok: boolean; endpoint: string }; error?: string } = { ok: false }

        try {
          if (type === 'image') {
            // ── 探测法（不真实生成，毫秒级返回）──
            // 空参数请求：503=端点存在(缺模型)、404=端点不存在、401=Key无效
            const probeHeaders = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }

            // 1. 文生图端点探测
            let ttiOk = false
            let ttiDetail = ''
            try {
              const p = await fetch(`${base}/images/generations`, {
                method: 'POST', redirect: 'error', headers: probeHeaders,
                body: JSON.stringify({}), signal: AbortSignal.timeout(8_000),
              })
              if (p.status === 401) { ttiDetail = 'API Key 无效' }
              else if (p.status === 404) { ttiDetail = '端点不存在' }
              else { ttiOk = true; ttiDetail = '端点可用' }
            } catch { ttiDetail = '连接失败' }
            result.textToImage = { ok: ttiOk, endpoint: `${base}/images/generations`, detail: ttiDetail }

            // 2. 图生图格式探测（快速探针：故意缺 model 名，看返回码判断格式是否被接受，不等生成）
            const img2imgFormats: string[] = []
            let img2imgOk = false
            const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

            // 格式 A: 顶层 image 字段（OpenAI 标准）
            try {
              const aResp = await fetch(`${base}/images/generations`, {
                method: 'POST', redirect: 'error', headers: probeHeaders,
                body: JSON.stringify({ image: `data:image/png;base64,${tinyPngBase64}` }),
                signal: AbortSignal.timeout(8_000),
              })
              // 非 404/401/403 = 格式被接受（400/503 表示服务器识别了 image 字段但缺其他参数）
              if (aResp.status !== 404 && aResp.status !== 401 && aResp.status !== 403) { img2imgFormats.push('顶层 image 字段'); img2imgOk = true }
            } catch {}

            // 格式 B: extra_body.image 数组（Agnes 格式）
            try {
              const bResp = await fetch(`${base}/images/generations`, {
                method: 'POST', redirect: 'error', headers: probeHeaders,
                body: JSON.stringify({ extra_body: { image: [`data:image/png;base64,${tinyPngBase64}`] } }),
                signal: AbortSignal.timeout(8_000),
              })
              if (bResp.status !== 404 && bResp.status !== 401 && bResp.status !== 403) { img2imgFormats.push('extra_body.image 数组'); img2imgOk = true }
            } catch {}

            // 格式 C: /images/edits + FormData
            try {
              const cForm = new FormData()
              cForm.append('image', new Blob([Buffer.from(tinyPngBase64, 'base64')], { type: 'image/png' }), 'ref.png')
              const cResp = await fetch(`${base}/images/edits`, {
                method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${apiKey}` }, body: cForm,
                signal: AbortSignal.timeout(8_000),
              })
              if (cResp.status !== 404 && cResp.status !== 401 && cResp.status !== 403) { img2imgFormats.push('/images/edits'); img2imgOk = true }
            } catch {}

            result.imageToImage = { ok: img2imgOk, endpoint: `${base}/images/generations`, formats: img2imgFormats }
            result.ok = ttiOk
          } else {
            // 视频测试
            const videoBase = base.endsWith('/v1') ? base : `${base}/v1`
            let videoOk = false
            let videoEndpoint = ''
            let i2vOk = false
            let i2vEndpoint = ''

            // 文生视频探测：POST /v1/videos 空 body 看端点是否存在
            try {
              const vResp = await fetch(`${videoBase}/videos`, {
                method: 'POST', redirect: 'error', headers,
                body: JSON.stringify({ model, prompt: 'test', n: 1 }),
                signal: AbortSignal.timeout(8_000),
              })
              if (vResp.status !== 404 && vResp.status !== 400) {
                videoOk = true
                videoEndpoint = `${videoBase}/videos`
              }
            } catch {}

            if (!videoOk) {
              try {
                const vGet = await fetch(`${videoBase}/videos`, { method: 'GET', redirect: 'error', headers, signal: AbortSignal.timeout(8_000) })
                if (vGet.status !== 404) {
                  videoOk = true
                  videoEndpoint = `${videoBase}/videos`
                }
              } catch {}
            }

            // 图生视频探测：POST /v1/videos 带顶层 image 字段
            try {
              const tinyPngUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
              const i2vResp = await fetch(`${videoBase}/videos`, {
                method: 'POST', redirect: 'error', headers,
                body: JSON.stringify({ model, prompt: 'test', image: tinyPngUrl, n: 1 }),
                signal: AbortSignal.timeout(8_000),
              })
              if (i2vResp.status !== 404 && i2vResp.status !== 400 && i2vResp.status !== 401 && i2vResp.status !== 403) {
                i2vOk = true
                i2vEndpoint = `${videoBase}/videos`
              }
            } catch {}

            result.video = { ok: videoOk, endpoint: videoEndpoint || '未检测到视频端点' }
            result.videoToImage = { ok: i2vOk, endpoint: i2vEndpoint || '未检测到图生视频端点' }
            result.ok = videoOk || i2vOk
          }
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e)
        }

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      },
    })
    return () => {}
  }, 'dsh-makemake: test route')

  // ─── 智能检测路由 ──────────────────────────────────────────────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: '/plugins/dsh-makemake/check-all',
      handler: async (_req, res) => {
        const settings = current() as unknown as RuntimeSettings
        const imgChs = settings.imageChannels ?? []
        const vidChs = settings.videoChannels ?? []
        const results: Array<{
          name: string; type: 'image' | 'video'; baseURL: string; model: string
          keyConfigured: boolean; textToImage?: { ok: boolean; detail?: string }
          imageToImage?: { ok: boolean; formats: string[] }
          textToVideo?: { ok: boolean; detail?: string }
          imageToVideo?: { ok: boolean; detail?: string }
          error?: string
        }> = []

        const probeChannel = async (ch: Channel, type: 'image' | 'video'): Promise<typeof results[0]> => {
          const cred = await ctx.credentials.resolve(channelCredentialRef(ch.id)).catch(() => null)
          const base = ch.baseURL.replace(/\/+$/, '')
          const apiKey = cred?.value?.split(/[\n\r,;]+/)[0]?.trim() ?? ''
          const entry: typeof results[0] = { name: ch.name, type, baseURL: ch.baseURL, model: ch.model, keyConfigured: !!apiKey }
          if (!apiKey) { entry.error = '未配置 API Key'; return entry }
          const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }

          if (type === 'image') {
            // 文生图
            try {
              const p = await fetch(`${base}/images/generations`, {
                method: 'POST', redirect: 'error', headers,
                body: JSON.stringify({}), signal: AbortSignal.timeout(8_000),
              })
              if (p.status === 401) entry.textToImage = { ok: false, detail: 'API Key 无效' }
              else if (p.status === 404) entry.textToImage = { ok: false, detail: '端点不存在' }
              else entry.textToImage = { ok: true, detail: '可用' }
            } catch { entry.textToImage = { ok: false, detail: '连接失败' } }

            // 图生图 3 种格式
            const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            const formats: string[] = []
            const probeFormat = async (body: any, label: string) => {
              try {
                const r = await fetch(`${base}/images/generations`, {
                  method: 'POST', redirect: 'error', headers,
                  body: JSON.stringify(body), signal: AbortSignal.timeout(8_000),
                })
                if (r.status !== 404 && r.status !== 401 && r.status !== 403) formats.push(label)
              } catch {}
            }
            await probeFormat({ image: `data:image/png;base64,${tinyPngBase64}` }, '顶层 image')
            await probeFormat({ extra_body: { image: [`data:image/png;base64,${tinyPngBase64}`] } }, 'extra_body.image')
            try {
              const cForm = new FormData()
              cForm.append('image', new Blob([Buffer.from(tinyPngBase64, 'base64')], { type: 'image/png' }), 'ref.png')
              const r = await fetch(`${base}/images/edits`, {
                method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${apiKey}` }, body: cForm,
                signal: AbortSignal.timeout(8_000),
              })
              if (r.status !== 404 && r.status !== 401 && r.status !== 403) formats.push('/images/edits')
            } catch {}
            entry.imageToImage = { ok: formats.length > 0, formats }
          } else {
            // 视频
            const videoBase = base.endsWith('/v1') ? base : `${base}/v1`
            // 文生视频
            try {
              const v = await fetch(`${videoBase}/videos`, {
                method: 'POST', redirect: 'error', headers,
                body: JSON.stringify({ model: ch.model, prompt: 'test', n: 1 }),
                signal: AbortSignal.timeout(8_000),
              })
              if (v.status === 401) entry.textToVideo = { ok: false, detail: 'API Key 无效' }
              else if (v.status === 404) entry.textToVideo = { ok: false, detail: '端点不存在' }
              else entry.textToVideo = { ok: true, detail: '可用' }
            } catch { entry.textToVideo = { ok: false, detail: '连接失败' } }

            // 图生视频
            try {
              const tinyPngUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
              const i2v = await fetch(`${videoBase}/videos`, {
                method: 'POST', redirect: 'error', headers,
                body: JSON.stringify({ model: ch.model, prompt: 'test', image: tinyPngUrl, n: 1 }),
                signal: AbortSignal.timeout(8_000),
              })
              if (i2v.status === 401) entry.imageToVideo = { ok: false, detail: 'API Key 无效' }
              else if (i2v.status === 404) entry.imageToVideo = { ok: false, detail: '不支持图生视频' }
              else entry.imageToVideo = { ok: true, detail: '可用' }
            } catch { entry.imageToVideo = { ok: false, detail: '连接失败' } }
          }
          return entry
        }

        for (const ch of imgChs) results.push(await probeChannel(ch, 'image'))
        for (const ch of vidChs) results.push(await probeChannel(ch, 'video'))

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, results }))
      },
    })
    return () => {}
  }, 'dsh-makemake: check-all route')

  // ─── 命令注册已移除 ────────────────────────────────────────────────────
  // 2026-08-23 决定：不向 DSH 注册 /agent /gpt 等命令。
  // 原因：DSH 原生命令高亮会把 /agent 渲染成青色胶囊 + 自带图标，与输入框左侧的
  // [SVG图标+渠道名] 徽章重叠冲突，且用户明确不要撇儿（/）。
  // 现在渠道名由输入框徽章（客户端 React 插槽外绝对定位）呈现，命令文本仍在
  // backdrop 中保留（模型解析用），但被不透明徽章盖住，视觉上只剩徽章+提示词。

  // 注册系统提示词，让模型知道 makemake 工具
  // 渠道名是动态的：每次组装 prompt 时从当前设置读取，让模型知道 /<渠道名> 对应哪个渠道
  ctx.systemPrompt.section({
    name: 'makemake',
    order: 220,
    text: (): string => {
      try {
        const s = scope.get() as unknown as RuntimeSettings
        // 插件关闭：完全隐藏能力，模型不知道有出图出视频工具
        if (s.enabled === false) return ''
        const imgChs = s.imageChannels ?? []
        const vidChs = s.videoChannels ?? []
        const imgCmdNames = imgChs.map(c => c.name).filter(Boolean)
        const vidCmdNames = vidChs.map(c => c.name).filter(Boolean)
        const cmdLines: string[] = []
        if (imgCmdNames.length > 0) {
          cmdLines.push(`图片生成渠道（${imgCmdNames.join('、')}）：调用 makemake_image 工具` + (() => {
            const sel = imgChs.find(c => c.id === s.selectedImageChannel)
            return sel ? `（当前选中：${sel.name}）` : ''
          })())
        }
        if (vidCmdNames.length > 0) {
          cmdLines.push(`视频生成渠道（${vidCmdNames.join('、')}）：调用 makemake_video 工具` + (() => {
            const sel = vidChs.find(c => c.id === s.selectedVideoChannel)
            return sel ? `（当前选中：${sel.name}）` : ''
          })())
        }
        // 用户已激活的模式（点工具栏图标切换）——一次性消费，注入指令让模型直接执行
        let activeLine = ''
        if (s.activeMode === 'image') activeLine = '\n\n### 用户意图：出图\n用户已点击「出图」按钮激活图片生成模式。**用户输入就是提示词**，立即调用 makemake_image 工具，不要询问、不要复述、不要解释。'
        else if (s.activeMode === 'video') activeLine = '\n\n### 用户意图：出视频\n用户已点击「出视频」按钮激活视频生成模式。**用户输入就是提示词**，立即调用 makemake_video 工具，不要询问、不要复述、不要解释。'
        if (cmdLines.length === 0) return MAKEMAKESKILL + activeLine
        return MAKEMAKESKILL + '\n\n### 当前可用渠道\n' + cmdLines.join('\n') + activeLine
      } catch {
        // 异常时保守处理：若插件已关闭则完全隐藏
        try {
          const s2 = scope.get() as unknown as RuntimeSettings
          if (s2.enabled === false) return ''
        } catch { /* ignore */ }
        return MAKEMAKESKILL
      }
    },
  })

  // ─── Image tool ────────────────────────────────────────────────────────
  function registerImageTool() {
  return ctx.tools.register(defineTool({
    name: 'makemake_image',
    description: 'Generate one image using the Make Make configured channel. Use when the user asks to create, draw, or generate an image. Pass "image" (URL or path) to do image-to-image (img2img) transformation based on a reference image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      size: { type: 'string', description: 'Optional image size, e.g. "1024x1024" or "2K".' },
      image: { type: 'string', description: 'Optional reference image URL or path for image-to-image (img2img). When passed, the API uses it as the source image and transforms it per the prompt.' },
      channel: { type: 'string', description: 'Optional channel name to use. When the user typed /渠道名, pass the channel name here.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          attachment: { type: 'object', required: true, additionalProperties: false, properties: {
            attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' },
          } },
          model: { type: 'string', required: true }, output: { type: 'string', required: true }, prompt: { type: 'string', required: true },
          channelName: { type: 'string' }, fileSize: { type: 'integer' },
        },
      },
      render: (_args, value) => {
        const sizeLabel = value.fileSize < 1024 ? `${value.fileSize} B` : value.fileSize < 1048576 ? `${(value.fileSize / 1024).toFixed(0)} KB` : `${(value.fileSize / 1048576).toFixed(1)} MB`
        return [
          { type: 'image', attachment: value.attachment },
          { type: 'text', text: `${value.output.replace('x', '×')} · ${sizeLabel} · ${value.channelName ?? ''}\n${value.prompt}` },
        ]
      },
      presentationMeta: (args, value) => ({
        kind: 'dsh-makemake',
        model: value.model,
        output: value.output,
        prompt: (args as { prompt: string }).prompt,
        // 注意：不传 attachment，attachment 由 render() 的 content blocks 渲染
      }),
    },
    async execute(args, exec): Promise<{ attachment: ImageAttachmentRef; model: string; output: string; prompt: string; channelName: string; fileSize: number }> {
          const settings = current() as unknown as RuntimeSettings
          const channels: Channel[] = settings.imageChannels ?? []
          if (channels.length === 0) throw new Error('未配置图片生成渠道，请在设置页添加渠道。')
          // ── 总闸门：插件已关闭则不执行 ──
          if (settings.enabled === false) throw new Error('Make Make 插件已关闭，请在设置页重新启用。')
          const srcImage = args.image?.trim() ?? ''
          // ── 硬闸门（仅纯文字出图）：没传图时必须点按钮才出，防止聊天误判 ──
          if (!srcImage && settings.activeMode !== 'image') {
            throw new Error('未点击「出图」按钮，无法确认出图意图。如果你想出图，请先点击工具栏的「出图」按钮，再输入提示词。')
          }
          // 注意：这里不消费 activeMode！必须等生成成功才清空（见下方 return），
          // 否则 API 失败时模型重试会被硬闸门拒绝。
          const sizeAlias: Record<string, string> = {
            '1K': '1024x1024', '2K': '2048x2048', '4K': '3840x2160',
            'square': '1024x1024', 'portrait': '768x1024', 'landscape': '1024x768',
          }
          const sizeRaw = sizeAlias[(args.size ?? '1024x1024').toLowerCase()] ?? args.size ?? '1024x1024'
          const sizeMatch = sizeRaw.match(/^(\d+)x(\d+)$/)
          if (!sizeMatch) throw new Error(`尺寸格式错误，应为 WIDTHxHEIGHT（如 "1024x1024"），收到: ${args.size}`)
          const resolvedSize = sizeMatch[1] + 'x' + sizeMatch[2]
          const dshUrl = new URL(`http://127.0.0.1:3080`)
          const normalizeImageUrl = (url: string) => url.replace(/^https?:\/\/[^/]+/, dshUrl.origin)
          const normalizedSrcImage = normalizeImageUrl(srcImage)

          // 纯透传：只使用当前选定的渠道，绝不遍历其他渠道
          const selectedId = settings.selectedImageChannel
          // 如果用户通过 /渠道名 指定了渠道，则优先按名称匹配
          let target: Channel | undefined
          const channelArg = (args as { channel?: string }).channel?.trim()
          if (channelArg) {
            target = channels.find(c => c.name === channelArg || `${c.name}`.includes(channelArg))
          }
          if (!target) target = channels.find(c => c.id === selectedId) ?? channels[0]
          if (!target) throw new Error('未配置图片生成渠道，请在设置页添加渠道。')
          const sorted = [target]

          const lastErr: string[] = []
          for (const ch of sorted) {
            const cred = await ctx.credentials.resolve(channelCredentialRef(ch.id))
            if (!cred?.value) { lastErr.push(`渠道「${ch.name}」未配置 API Key`); continue }
            const pool = getKeyPool(ch.id, cred.value)
            const sk = pool.next()
                        if (!sk) { lastErr.push(`渠道「${ch.name}」所有 Key 都在冷却中`); continue }
                        const baseURL = ch.baseURL.replace(/\/+$/, '')
                        const model = ch.model
                        let response: Response
                        try {
                          // 抽取响应处理逻辑，避免代码重复
                        async function handleResponse(r: Response): Promise<{ attachment: ImageAttachmentRef; model: string; output: string; prompt: string; channelName: string; fileSize: number }> {
                          let data: Uint8Array
                          let mediaType: ImageAttachmentRef['mediaType'] = 'image/png'
                          if (!r.ok) {
                                      const text = (await r.text()).slice(0, 300)
                                      throw new Error(`HTTP ${r.status}: ${text}`)
                                    }
                                    const payload = await r.json() as { data?: Array<{ b64_json?: string; url?: string }> }
                                    const image = payload.data?.[0]
                                    if (!image) throw new Error('API 返回空结果')
                          if (image.b64_json) {
                            const clean = image.b64_json.replace(/\s+/g, '')
                            if (!clean.length) throw new Error('返回空 base64 数据')
                            data = new Uint8Array(Buffer.from(clean, 'base64'))
                          } else if (image.url) {
                            const imgResp = await fetch(image.url, { redirect: 'follow', signal: exec.signal })
                            if (!imgResp.ok) throw new Error(`图片下载失败（HTTP ${imgResp.status}）`)
                            const ct = (imgResp.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
                            mediaType = ['image/png','image/jpeg','image/webp','image/gif'].includes(ct)
                              ? ct as ImageAttachmentRef['mediaType'] : 'image/png'
                            data = new Uint8Array(await imgResp.arrayBuffer())
                          } else throw new Error('返回数据格式未知')
                          const maxBytes = ctx.attachments.imageLimits.maxImageBytes
                          if (data.byteLength > maxBytes) throw new Error(`图片超出 ${maxBytes} 字节限制`)
                          if (!ctx.attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`不支持 ${mediaType} 格式`)
                          const attachment = await ctx.attachments.saveImage({ data, mediaType, name: 'generated-image' })
                          return { attachment, model, output: resolvedSize, prompt: args.prompt, channelName: ch.name, fileSize: data.byteLength }
                        }

                        if (normalizedSrcImage) {
                                                  // 解析参考图（仅支持附件 ID 或 http(s) URL；本地路径不存在时报错，不降级）
                                                  let refBytes: Uint8Array
                                                  let refType = 'image/png'
                                                  const am = normalizedSrcImage.match(/attachmentId=(sha256:[0-9a-f]+)/)
                                                  if (am?.[1]) {
                                                    const hash = am[1].replace(/^sha256:/, '')
                                                    const fp = path.join(dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
                                                    refBytes = new Uint8Array(await fs.readFile(fp))
                                                  } else if (/^https?:\/\//.test(normalizedSrcImage)) {
                                                    const r2 = await fetch(normalizedSrcImage, { redirect: 'follow', signal: exec.signal })
                                                    if (!r2.ok) throw new Error(`参考图读取失败（HTTP ${r2.status}）`)
                                                    refBytes = new Uint8Array(await r2.arrayBuffer())
                                                    const ct = (r2.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
                                                    if (['image/png','image/jpeg','image/webp','image/gif'].includes(ct)) refType = ct
                                                  } else {
                                                    // 本地路径：支持绝对路径、相对路径、裸文件名（DSH 上传目录）
                                                    const candidates = [
                                                      normalizedSrcImage,
                                                      path.join('/root/DSH/.uploads', normalizedSrcImage),
                                                      path.join(dshHome, '.uploads', normalizedSrcImage),
                                                      path.join(dshHome, 'uploads', normalizedSrcImage),
                                                    ]
                                                    let lastImgErr: unknown = null
                                                    for (const cand of candidates) {
                                                      try { refBytes = new Uint8Array(await fs.readFile(cand)); lastImgErr = null; break }
                                                      catch (e) { lastImgErr = e }
                                                    }
                                                    if (!refBytes) throw (lastImgErr instanceof Error ? lastImgErr : new Error('找不到图片文件'))
                                                  }
                                                  // 图生图：Agnes 官方文档规定图片在 extra_body.image 数组里（Data URI Base64），顶层不传 image
                                                                            const refB64 = Buffer.from(refBytes).toString('base64')
                                                                            const refDataUrl = `data:${refType};base64,${refB64}`
                                                                            response = await fetch(`${baseURL}/images/generations`, {
                                                                              method: 'POST', redirect: 'error', signal: exec.signal,
                                                                              headers: { authorization: `Bearer ${sk}`, 'content-type': 'application/json' },
                                                                              body: JSON.stringify({ model, prompt: args.prompt, size: resolvedSize, n: 1, extra_body: { image: [refDataUrl] } }),
                                                                            })
                                                                            if (!response.ok) {
                                                                              const text = (await response.text()).slice(0, 300)
                                                                              throw new Error(`图生图失败（HTTP ${response.status}）：${text}`)
                                                                            }
                                                } else {
                                                  response = await fetch(`${baseURL}/images/generations`, {
                                                    method: 'POST', redirect: 'error', signal: exec.signal,
                                                    headers: { authorization: `Bearer ${sk}`, 'content-type': 'application/json' },
                                                    body: JSON.stringify({ model, prompt: args.prompt, size: resolvedSize, n: 1 }),
                                                  })
                                                }
            // 生成成功后才消费 activeMode（handleResponse 可能抛错，失败时保留给重试）
            const result = await handleResponse(response)
            void scope.update({ activeMode: null }).catch(() => {})
            return result
            } catch (e) {
              // 失败：保留 activeMode（模型可重试），不消费
              // 标记当前 Key 冷却（429/限流场景），下次换 Key 重试
              pool.fail(sk)
              const msg = e instanceof Error ? e.message : String(e)
              // 尝试提取 HTTP 状态码（"HTTP 401: xxx" / "HTTP 401"）
              const m = msg.match(/HTTP (\d{3})/)
              lastErr.push(`渠道「${ch.name}」(${ch.baseURL}): ${classifyError(m ? parseInt(m[1], 10) : undefined, msg)}`)
            }
          }
          // 图片生成失败——只报当前渠道
          const detail = lastErr.join('\n')
          throw new Error(
            `图片生成失败（渠道「${channels.find(c=>c.id===selectedId)?.name ?? channels[0]?.name ?? '未知'}」）：${detail}`
          )
        },
    presentResult: (_args, result) => {
      const meta = result.meta as Record<string, unknown> | undefined
      if (meta?.kind !== 'dsh-makemake') return undefined
      return { card: 'generic', title: '已生成图片' }
    },
  }))
  }

  // ─── Video tool ────────────────────────────────────────────────────────
  function registerVideoTool() {
  return ctx.tools.register(defineTool({
    name: 'makemake_video',
    description: 'Generate one video using the Make Make configured channel. Use when the user asks to create, generate, or render a video. Pass "image" (URL or path) to do image-to-video (i2v) — animate a still image into a video.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the video to generate.' },
      duration: { type: 'string', description: 'Optional video duration, e.g. "5s" or "10s".' },
      channel: { type: 'string', description: 'Optional channel name to use. When the user typed /渠道名, pass the channel name here.' },
      image: { type: 'string', description: 'Optional reference image URL or path for image-to-video (i2v). When passed, the API animates the image into a video per the prompt.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          url: { type: 'string', required: true, description: 'URL to access the generated video.' },
          model: { type: 'string', required: true }, duration: { type: 'string', required: true }, prompt: { type: 'string', required: true },
          channelName: { type: 'string' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `🎬 ${value.duration} · ${value.channelName ?? ''}\n${value.prompt}` },
      ],
      presentationMeta: () => ({ kind: 'dsh-makemake-video' }),
    },
    async execute(args, exec): Promise<{ url: string; model: string; duration: string; prompt: string; channelName: string }> {
      const settings = current() as unknown as RuntimeSettings
      const channels: Channel[] = settings.videoChannels ?? []
      if (channels.length === 0) throw new Error('未配置视频生成渠道，请在设置页添加渠道。')
      // ── 总闸门：插件已关闭则不执行 ──
      if (settings.enabled === false) throw new Error('Make Make 插件已关闭，请在设置页重新启用。')
      // ── 硬闸门（仅纯文字出视频）：没传图时必须点按钮才出，防止聊天误判 ──
      const srcVideoImage = (args as { image?: string }).image?.trim() ?? ''
      if (!srcVideoImage && settings.activeMode !== 'video') {
        throw new Error('未点击「出视频」按钮，无法确认出视频意图。如果你想出视频，请先点击工具栏的「出视频」按钮，再输入提示词。')
      }
      // 注意：这里不消费 activeMode！必须等生成成功才清空（见下方 return），
      // 否则 API 失败时模型重试会被硬闸门拒绝。
      // 纯透传：只使用当前选定的视频渠道
          const selectedId = settings.selectedVideoChannel
          let target: Channel | undefined
          const channelArg = (args as { channel?: string }).channel?.trim()
          if (channelArg) {
            target = channels.find(c => c.name === channelArg || `${c.name}`.includes(channelArg))
          }
          if (!target) target = channels.find(c => c.id === selectedId) ?? channels[0]
          if (!target) throw new Error('未配置视频生成渠道，请在设置页添加渠道。')
          const sorted = [target]
          const duration = args.duration ?? '5s'
      const lastErr: string[] = []

      // 图生视频：解析参考图 → 读出字节 → 转 data URL（与图片工具一致）
      const dshUrl = new URL(`http://127.0.0.1:3080`)
      const normalizeImageUrl = (url: string) => url.replace(/^https?:\/\/[^/]+/, dshUrl.origin)
      let resolvedImage: string | undefined
      if (srcVideoImage) {
        // 1. 数据 URL（data:image/...;base64,...）直接用
        // 2. 附件 ID（attachmentId=sha256:xxx）→ 读 DSH attachments 文件
        // 3. http(s) URL → 下载 → data URL（避免上游访问不到内网/本地）
        // 4. 本地路径 → 直接读文件 → data URL
        try {
          if (/^data:image\//.test(srcVideoImage)) {
            resolvedImage = srcVideoImage
          } else {
            let refBytes: Uint8Array
            let refType = 'image/png'
            const am = srcVideoImage.match(/attachmentId=(sha256:[0-9a-f]+)/)
            if (am?.[1]) {
              const hash = am[1].replace(/^sha256:/, '')
              const fp = path.join(dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
              refBytes = new Uint8Array(await fs.readFile(fp))
            } else if (/^https?:\/\//.test(srcVideoImage)) {
              const r = await fetch(srcVideoImage, { redirect: 'follow', signal: exec.signal })
              if (!r.ok) throw new Error(`参考图读取失败（HTTP ${r.status}）`)
              refBytes = new Uint8Array(await r.arrayBuffer())
              const ct = (r.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
              if (['image/png','image/jpeg','image/webp','image/gif'].includes(ct)) refType = ct
            } else {
              // 本地路径：支持绝对路径、相对路径、裸文件名（DSH 上传目录）
              const candidates = [
                srcVideoImage,
                path.join('/root/DSH/.uploads', srcVideoImage),
                path.join(dshHome, '.uploads', srcVideoImage),
                path.join(dshHome, 'uploads', srcVideoImage),
              ]
              let lastErr2: unknown = null
              for (const cand of candidates) {
                try {
                  refBytes = new Uint8Array(await fs.readFile(cand))
                  lastErr2 = null
                  break
                } catch (e) { lastErr2 = e }
              }
              if (!refBytes) throw (lastErr2 instanceof Error ? lastErr2 : new Error('找不到图片文件'))
            }
            const refB64 = Buffer.from(refBytes).toString('base64')
            resolvedImage = `data:${refType};base64,${refB64}`
          }
        } catch (e) {
          throw new Error(`图生视频参考图解析失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }

      for (const ch of sorted) {
        const cred = await ctx.credentials.resolve(channelCredentialRef(ch.id))
        if (!cred?.value) { lastErr.push(`渠道「${ch.name}」未配置 API Key`); continue }
        const pool = getKeyPool(ch.id, cred.value)
        const sk = pool.next()
        if (!sk) { lastErr.push(`渠道「${ch.name}」所有 Key 都在冷却中`); continue }
        const baseURL = ch.baseURL.replace(/\/+$/, '')
        // 兼容带 /v1 和不带 /v1 的 baseURL
        const videoBase = baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`
        try {
          // 提交视频生成任务——队列满自动换 Key
          const maxKeyAttempts = Math.max(pool.size, 1) * 2
          let submitResp: Response | null = null
          let lastSubmitErr = ''
          let usedKey = sk
          for (let ki = 0; ki < maxKeyAttempts; ki++) {
            const curSk = pool.next()
            if (!curSk) break
            usedKey = curSk
            submitResp = await fetch(`${videoBase}/videos`, {
              method: 'POST', redirect: 'error', signal: exec.signal,
              headers: { authorization: `Bearer ${curSk}`, 'content-type': 'application/json' },
              body: JSON.stringify(resolvedImage
                ? { model: ch.model, prompt: args.prompt, image: resolvedImage, duration: parseInt(duration, 10) || 5, n: 1 }
                : { model: ch.model, prompt: args.prompt, duration: parseInt(duration, 10) || 5, n: 1 }),
            })
            if (submitResp.ok) break
            const text = (await submitResp.text()).slice(0, 300)
            // 队列满：换下一个 Key（不标记冷却）
            if (submitResp.status === 503 || /queue_full/i.test(text)) {
              lastSubmitErr = `队列满，Key 轮询中`
              continue
            }
            // 其他错误：标记 Key 冷却，换下一个
            pool.fail(curSk)
            lastSubmitErr = `HTTP ${submitResp.status}: ${text}`
            await new Promise(r => setTimeout(r, 2000))
          }
          if (!submitResp?.ok) throw new Error(`提交失败：${lastSubmitErr || '所有 Key 不可用'}`)
          const submitData = await submitResp.json() as { id?: string; error?: { message?: string } }
          if (submitData.error) {
            pool.fail(usedKey)
            throw new Error(submitData.error.message ?? 'API 返回错误')
          }
          const taskId = submitData.id
          if (!taskId) throw new Error('API 返回了空任务 ID')

          // 轮询任务状态（最多等 120 秒）
          const pollUrl = `${videoBase}/videos/${taskId}`
          let videoTask
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000))
            const pollResp = await fetch(pollUrl, {
              redirect: 'error', signal: exec.signal,
              headers: { authorization: `Bearer ${usedKey}` },
            })
            if (!pollResp.ok) {
              const text = (await pollResp.text()).slice(0, 300)
              throw new Error(`查询任务状态失败（HTTP ${pollResp.status}）：${text}`)
            }
            videoTask = await pollResp.json() as { status?: string; video_url?: string; metadata?: { url?: string }; error?: { message?: string } }
            if (videoTask.error) throw new Error(videoTask.error.message ?? '视频生成失败')
            // Agnes API 状态 completed 表示成功
            if (videoTask.status === 'succeeded' || videoTask.status === 'completed') break
            if (videoTask.status === 'failed') throw new Error(`视频生成失败（status: ${videoTask.status}）`)
          }
          // 获取视频 URL：video_url 或 metadata.url
          const videoUrl = videoTask?.video_url || videoTask?.metadata?.url || ''
          if (!videoUrl) throw new Error('视频生成完成但未返回视频 URL')
          // 生成成功 → 消费 activeMode（模型重试时有值，成功后不再残留）
          void scope.update({ activeMode: null }).catch(() => {})
          return { url: videoUrl, model: ch.model, duration, prompt: args.prompt, channelName: ch.name }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const m = msg.match(/HTTP (\d{3})/)
          throw new Error(`视频生成失败（渠道「${ch.name}」）：${classifyError(m ? parseInt(m[1], 10) : undefined, msg)}`)
        }
      }
    },
    presentResult: (_args, result) => {
      const meta = result.meta as Record<string, unknown> | undefined
      if (meta?.kind !== 'dsh-makemake-video') return undefined
      return { card: 'generic', title: '已生成视频' }
    },
  }))
  }

  // ─── 动态注册/注销工具：插件关闭时，工具完全消失，模型感知不到 ──
  let disposeImage: (() => void) | null = null
  let disposeVideo: (() => void) | null = null
  const initialEnabled = (current() as unknown as RuntimeSettings).enabled !== false
  if (initialEnabled) {
    disposeImage = registerImageTool()
    disposeVideo = registerVideoTool()
  }
  const disposeWatch = scope.watch((next, prev) => {
    const wasEnabled = prev.enabled !== false
    const isEnabled = next.enabled !== false
    if (!isEnabled && wasEnabled) {
      // 插件关闭 → 注销工具（模型完全感知不到）
      disposeImage?.()
      disposeVideo?.()
      disposeImage = null
      disposeVideo = null
    } else if (isEnabled && !wasEnabled) {
      // 插件重新开启 → 重新注册工具
      disposeImage = registerImageTool()
      disposeVideo = registerVideoTool()
    }
  })
  ctx.effect(() => {
    return () => {
      disposeWatch()
      disposeImage?.()
      disposeVideo?.()
    }
  })
}