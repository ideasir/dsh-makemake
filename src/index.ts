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
import { MAKEMAKE_SKILL } from './skill.js'
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

interface RuntimeSettings {
  imageChannels?: Channel[]
  videoChannels?: Channel[]
  selectedImageChannel?: string
  selectedVideoChannel?: string
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
          baseURL: string; model: string; apiKey: string
        }
        const { type, baseURL: rawBase, model, apiKey } = body
        const base = rawBase.replace(/\/+$/, '')
        const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
        const result: { ok: boolean; textToImage?: { ok: boolean; endpoint: string; detail?: string }; imageToImage?: { ok: boolean; endpoint: string; formats: string[] }; video?: { ok: boolean; endpoint: string }; error?: string } = { ok: false }

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
              // 非 404 = 格式被接受（400/503 表示服务器识别了 image 字段但缺其他参数）
              if (aResp.status !== 404) { img2imgFormats.push('顶层 image 字段'); img2imgOk = true }
            } catch {}

            // 格式 B: extra_body.image 数组（Agnes 格式）
            try {
              const bResp = await fetch(`${base}/images/generations`, {
                method: 'POST', redirect: 'error', headers: probeHeaders,
                body: JSON.stringify({ extra_body: { image: [`data:image/png;base64,${tinyPngBase64}`] } }),
                signal: AbortSignal.timeout(8_000),
              })
              if (bResp.status !== 404) { img2imgFormats.push('extra_body.image 数组'); img2imgOk = true }
            } catch {}

            // 格式 C: /images/edits + FormData
            try {
              const cForm = new FormData()
              cForm.append('image', new Blob([Buffer.from(tinyPngBase64, 'base64')], { type: 'image/png' }), 'ref.png')
              const cResp = await fetch(`${base}/images/edits`, {
                method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${apiKey}` }, body: cForm,
                signal: AbortSignal.timeout(8_000),
              })
              if (cResp.status !== 404) { img2imgFormats.push('/images/edits'); img2imgOk = true }
            } catch {}

            result.imageToImage = { ok: img2imgOk, endpoint: `${base}/images/generations`, formats: img2imgFormats }
            result.ok = ttiOk
          } else {
            // 视频测试
            // 尝试 /v1/videos (Agnes) 和 /videos/generations
            let videoOk = false
            let videoEndpoint = ''

            // 先试 POST /v1/videos 看是否 404
            const videoBase = base.endsWith('/v1') ? base : `${base}/v1`
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
              // 尝试 GET /v1/videos 看端点是否存在
              try {
                const vGet = await fetch(`${videoBase}/videos`, { method: 'GET', redirect: 'error', headers, signal: AbortSignal.timeout(8_000) })
                if (vGet.status !== 404) {
                  videoOk = true
                  videoEndpoint = `${videoBase}/videos`
                }
              } catch {}
            }

            result.video = { ok: videoOk, endpoint: videoEndpoint || '未检测到视频端点' }
            result.ok = videoOk
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

  // 注册命令让 DSH 识别 /make 前缀（命令名必须为英文小写）
  ctx.effect(() => {
    const commands = ctx.get('commands') as { register: (def: { name: string; description: string; handler: () => { kind: string } }) => void } | undefined
    if (!commands) return () => {}
    commands.register({ name: 'make-image', description: 'Generate an image', handler: () => ({ kind: 'success' as const }) })
    commands.register({ name: 'make-video', description: 'Generate a video', handler: () => ({ kind: 'success' as const }) })
    return () => {}
  }, 'dsh-makemake: commands')

  // 注册系统提示词，让模型知道 makemake 工具
  ctx.systemPrompt.section({
    name: 'makemake',
    order: 220,
    text: MAKEMAKE_SKILL,
  })

  // ─── Image tool ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'makemake_image',
    description: 'Generate one image using the Make Make configured channel. Use when the user asks to create, draw, or generate an image. Pass "image" (URL or path) to do image-to-image (img2img) transformation based on a reference image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      size: { type: 'string', description: 'Optional image size, e.g. "1024x1024" or "2K".' },
      image: { type: 'string', description: 'Optional reference image URL or path for image-to-image (img2img). When passed, the API uses it as the source image and transforms it per the prompt.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          attachment: { type: 'object', required: true, additionalProperties: false, properties: {
            attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' },
          } },
          model: { type: 'string', required: true }, output: { type: 'string', required: true }, prompt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'image', attachment: value.attachment },
        { type: 'text', text: `已生成图片（${value.model}，${value.output}）：${value.prompt}` },
      ],
      presentationMeta: (args, value) => ({
        kind: 'dsh-makemake',
        model: value.model,
        output: value.output,
        prompt: (args as { prompt: string }).prompt,
        // 注意：不传 attachment，attachment 由 render() 的 content blocks 渲染
      }),
    },
    async execute(args, exec): Promise<{ attachment: ImageAttachmentRef; model: string; output: string; prompt: string }> {
          const settings = current() as unknown as RuntimeSettings
          const channels: Channel[] = settings.imageChannels ?? []
          if (channels.length === 0) throw new Error('未配置图片生成渠道，请在设置页添加渠道。')
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
          const srcImage = normalizeImageUrl(args.image?.trim() ?? '')

          // 按「已选渠道优先，其次其余渠道」排序
          const selectedId = settings.selectedImageChannel
          const sorted = selectedId
            ? [...channels].sort((a, b) => (a.id === selectedId ? 0 : 1))
            : channels

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
                        async function handleResponse(r: Response): Promise<{ attachment: ImageAttachmentRef; model: string; output: string; prompt: string }> {
                          if (!r.ok) {
                            const text = (await r.text()).slice(0, 300)
                            throw new Error(`HTTP ${r.status}: ${text}`)
                          }
                          const payload = await r.json() as { data?: Array<{ b64_json?: string; url?: string }> }
                          const image = payload.data?.[0]
                          if (!image) throw new Error('API 返回空结果')
                          let data: Uint8Array; let mediaType: ImageAttachmentRef['mediaType'] = 'image/png'
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
                          return { attachment, model, output: resolvedSize, prompt: args.prompt }
                        }

                        if (srcImage) {
                                                  // 解析参考图（仅支持附件 ID 或 http(s) URL；本地路径不存在时报错，不降级）
                                                  let refBytes: Uint8Array
                                                  let refType = 'image/png'
                                                  const am = srcImage.match(/attachmentId=(sha256:[0-9a-f]+)/)
                                                  if (am?.[1]) {
                                                    const hash = am[1].replace(/^sha256:/, '')
                                                    const fp = path.join(dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
                                                    refBytes = new Uint8Array(await fs.readFile(fp))
                                                  } else if (/^https?:\/\//.test(srcImage)) {
                                                    const r2 = await fetch(srcImage, { redirect: 'follow', signal: exec.signal })
                                                    if (!r2.ok) throw new Error(`参考图读取失败（HTTP ${r2.status}）`)
                                                    refBytes = new Uint8Array(await r2.arrayBuffer())
                                                    const ct = (r2.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
                                                    if (['image/png','image/jpeg','image/webp','image/gif'].includes(ct)) refType = ct
                                                  } else {
                                                    // 本地路径：读不到直接报错（不降级文生图）
                                                    refBytes = new Uint8Array(await fs.readFile(srcImage))
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
            return await handleResponse(response)
            } catch (e) {
              lastErr.push(`渠道「${ch.name}」(${ch.baseURL}): ${e instanceof Error ? e.message : String(e)}`)
            }
          }
          // 全部失败
          const detail = lastErr.join('\n')
          throw new Error(
            `图片生成失败：所有 ${channels.length} 个渠道均不可用。\n` +
            `当前选中: ${selectedId ? `「${channels.find(c=>c.id===selectedId)?.name}」` : '未指定'}\n\n` +
            `详细错误：\n${detail}`
          )
        },
    presentResult: (_args, result) => {
      const meta = result.meta as Record<string, unknown> | undefined
      if (meta?.kind !== 'dsh-makemake') return undefined
      return { card: 'generic', title: '已生成图片' }
    },
  }))

  // ─── Video tool ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'makemake_video',
    description: 'Generate one video using the Make Make configured channel. Use when the user asks to create, generate, or render a video.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the video to generate.' },
      duration: { type: 'string', description: 'Optional video duration, e.g. "5s" or "10s".' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          url: { type: 'string', required: true, description: 'URL to access the generated video.' },
          model: { type: 'string', required: true }, duration: { type: 'string', required: true }, prompt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `🎬 已生成视频（${value.model}，时长 ${value.duration}）\n${value.prompt}\n${value.url}` },
      ],
      presentationMeta: () => ({ kind: 'dsh-makemake-video' }),
    },
    async execute(args, exec): Promise<{ url: string; model: string; duration: string; prompt: string }> {
      const settings = current() as unknown as RuntimeSettings
      const channels: Channel[] = settings.videoChannels ?? []
      if (channels.length === 0) throw new Error('未配置视频生成渠道，请在设置页添加渠道。')
      const selectedId = settings.selectedVideoChannel
      const sorted = selectedId ? [...channels].sort((a, b) => (a.id === selectedId ? 0 : 1)) : channels
      const duration = args.duration ?? '5s'
      const lastErr: string[] = []

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
              body: JSON.stringify({ model: ch.model, prompt: args.prompt, duration: parseInt(duration, 10) || 5, n: 1 }),
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
          return { url: videoUrl, model: ch.model, duration, prompt: args.prompt }
        } catch (e) {
          lastErr.push(`渠道「${ch.name}」(${ch.baseURL}): ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      throw new Error(`视频生成失败：所有 ${channels.length} 个渠道均不可用。\n详细：${lastErr.join('\n')}`)
    },
    presentResult: (_args, result) => {
      const meta = result.meta as Record<string, unknown> | undefined
      if (meta?.kind !== 'dsh-makemake-video') return undefined
      return { card: 'generic', title: '已生成视频' }
    },
  }))
}