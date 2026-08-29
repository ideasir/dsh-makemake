/**
 * Make Make —— 多供应商 图片/视频 生成插件（服务端编排层）。
 *
 * 职责划分：
 * - 本文件只做「编排」：注册设置、系统提示词、Web 路由、两个工具（makemake_image / makemake_video）。
 * - ./channels.ts   渠道解析 / API Key 轮询池与冷却。
 * - ./reference.ts  参考图解析（data URL / 附件 ID / http / 本地路径 → 字节 + data URL）。
 * - ./iterations.ts 图血缘迭代注册表（持久化，跨重启 / 渠道 / 会话）。
 * - ./http.ts       上游错误的人类可读归类。
 * - ./probe.ts      渠道能力探测（/test 与 /check-all 共用）。
 * - ./image-route.ts 图片路由（从 DSH attachments 读图，供生成的图片卡片展示）。
 * - ./config.ts / ./shared.ts / ./skill.ts 配置、共享常量、技能文本。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config } from './config.js'
import { IMAGE_ROUTE, VIDEO_ROUTE, VIDEO_REF_ROUTE, CREATION_NAMESPACE } from './shared.js'
import { serveImage } from './image-route.js'
import { serveVideoProxy, serveVideoRef } from './video-route.js'
import { MAKEMAKESKILL } from './skill.js'
import type { IncomingMessage } from 'node:http'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { channelCredentialRef, resolveTargetChannel, getKeyPool } from './channels.js'
import type { RuntimeSettings } from './channels.js'
import { classifyError } from './http.js'
import { resolveReferenceBytes, toDataUrl } from './reference.js'
import {
  IterationRegistry, defaultIterationPath, newLineageId, nextIteration, nextVideoIteration,
} from './iterations.js'
import type { PlannedIteration } from './iterations.js'
import { probeImageCapabilities, probeVideoCapabilities, probeModelsList, classifyModels, probeImageToImage, probeImageToVideo } from './probe.js'
import { resolveVideoLastFrame } from './video-frame.js'

export { Config } from './config.js'
export { IMAGE_ROUTE } from './shared.js'

/** Cordis plugin name. */
export const name = 'dsh-makemake'
/** Host services required by the Bundle. */
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings', 'commands', 'systemPrompt']

/**
 * 宿主上下文：Context 上的 webServer 服务来自 @deepseek-ai/dsh-host-webserver 的
 * 模块扩充；用显式交叉类型声明，避免依赖「空类型导入触发全局扩充」这种脆弱写法。
 */
type HostContext = Context & { webServer: WebServer }

/** 尺寸别名 → WIDTHxHEIGHT。 */
const SIZE_ALIAS: Record<string, string> = {
  '1K': '1024x1024', '2K': '2048x2048', '4K': '3840x2160',
  square: '1024x1024', portrait: '768x1024', landscape: '1024x768',
}

/** 把用户给的尺寸（可能带别名）解析为 WIDTHxHEIGHT；非法则抛错。 */
function resolveSize(raw: string | undefined): string {
  const sizeRaw = SIZE_ALIAS[(raw ?? '1024x1024').toLowerCase()] ?? raw ?? '1024x1024'
  const m = sizeRaw.match(/^(\d+)x(\d+)$/)
  if (!m) throw new Error(`尺寸格式错误，应为 WIDTHxHEIGHT（如 "1024x1024"），收到: ${raw}`)
  return `${m[1]}x${m[2]}`
}

/** 检测/测试路由请求体的体积上限（防止滥用撑爆内存）。 */
const MAX_BODY_BYTES = 64 * 1024

/** 校验请求是否与 DSH 同源（浏览器跨源请求应拒绝，避免被外部站点诱导做探测/SSRF）。 */
function sameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin === undefined || host === undefined) return true
  const o = Array.isArray(origin) ? origin[0] : origin
  const h = Array.isArray(host) ? host[0] : host
  if (o === undefined || h === undefined) return true
  return o === `http://${h}` || o === `https://${h}`
}

/** 读取请求体并解析为 JSON（空 body 视为 {}）；超限会抛错。 */
async function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY_BYTES) throw new Error('request too large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** 图片工具的公开返回值。 */
interface ImageResult {
  attachment: ImageAttachmentRef
  model: string
  output: string
  prompt: string
  channelName: string
  fileSize: number
  iteration?: number
}

/**
 * 处理图片生成响应：校验 → 保存附件 → 返回公开结果与输出字节。
 * 输出字节由调用方用于登记迭代血缘（成功才推进迭代号）。
 */
async function handleImageResponse(
  response: Response,
  deps: {
    ctx: Context
    model: string
    size: string
    prompt: string
    channelName: string
    iteration: number
    signal: AbortSignal
  },
): Promise<{ result: ImageResult; bytes: Uint8Array }> {
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300)
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
  const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const image = payload.data?.[0]
  if (!image) throw new Error('API 返回空结果')

  let data: Uint8Array
  let mediaType: ImageAttachmentRef['mediaType'] = 'image/png'
  if (image.b64_json) {
    const clean = image.b64_json.replace(/\s+/g, '')
    if (!clean.length) throw new Error('返回空 base64 数据')
    data = new Uint8Array(Buffer.from(clean, 'base64'))
  } else if (image.url) {
    const imgResp = await fetch(image.url, { redirect: 'follow', signal: deps.signal })
    if (!imgResp.ok) throw new Error(`图片下载失败（HTTP ${imgResp.status}）`)
    const ct = (imgResp.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    mediaType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ct)
      ? ct as ImageAttachmentRef['mediaType']
      : 'image/png'
    data = new Uint8Array(await imgResp.arrayBuffer())
  } else {
    throw new Error('返回数据格式未知')
  }

  const maxBytes = deps.ctx.attachments.imageLimits.maxImageBytes
  if (data.byteLength > maxBytes) throw new Error(`图片超出 ${maxBytes} 字节限制`)
  if (!deps.ctx.attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`不支持 ${mediaType} 格式`)
  const attachment = await deps.ctx.attachments.saveImage({ data, mediaType, name: 'generated-image' })

  return {
    result: {
      attachment, model: deps.model, output: deps.size, prompt: deps.prompt,
      channelName: deps.channelName, fileSize: data.byteLength,
      ...(deps.iteration >= 1 ? { iteration: deps.iteration } : {}),
    },
    bytes: data,
  }
}

/** 从错误信息里提取 HTTP 状态码（"HTTP 401: xxx" / "HTTP 401"）。 */
function httpCodeOf(msg: string): number {
  const m = msg.match(/HTTP (\d{3})/)
  return m ? parseInt(m[1]!, 10) : 0
}

export function apply(ctx: HostContext, config: Config = {}): void {
  const scope = ctx.settings.register(settingsNamespace(CREATION_NAMESPACE), Config, { base: config })
  let current: () => unknown = () => scope.get()
  const dshHome = process.env.DSH_HOME ?? '/root/.dsh'
  // 图血缘迭代注册表：持久化到磁盘，跨进程重启 / 渠道切换 / 会话 都能延续。
  const iterations = new IterationRegistry(defaultIterationPath(dshHome))

  // ─── 图片路由：从 DSH attachments 读图，供生成的图片卡片展示 ────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: IMAGE_ROUTE,
      handler: (req, res) => serveImage(req, res, {
        readImage: async (ref) => {
          const hash = ref.attachmentId.replace(/^sha256:/, '')
          const filePath = path.join(dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
          const data = await fs.readFile(filePath)
          return { ref, data } as never
        },
      }),
    })
    return () => {}
  }, 'dsh-makemake: image route')

  // ─── 视频代理路由：同源回传生成的视频字节，供卡片抓取后粘贴为附件（绕过 COS CORS）──────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: VIDEO_ROUTE,
      handler: (req, res) => serveVideoProxy(req, res),
    })
    return () => {}
  }, 'dsh-makemake: video route')

  // ─── 视频引用路由：把生成视频落到 .uploads/，返回 [f:文件名] 方形标签 ──────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: VIDEO_REF_ROUTE,
      handler: (req, res) => serveVideoRef(req, res),
    })
    return () => {}
  }, 'dsh-makemake: video-ref route')

  // ─── 渠道检测路由（单渠道探测，服务端确认连通性）─────────────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: '/plugins/dsh-makemake/test',
      handler: async (req, res) => {
        if (!sameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'origin-rejected' }))
          return
        }
        let body: {
          type: 'image' | 'video'; baseURL: string; model: string; apiKey: string; channelId?: string
        }
        try {
          body = await readJsonBody(req) as typeof body
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid-body', detail: e instanceof Error ? e.message : String(e) }))
          return
        }
        const { type, baseURL: rawBase, model, apiKey: rawApiKey, channelId } = body
        // 前端没传 Key 时，尝试从凭据库取第一个。
        let apiKey = rawApiKey
        if (!apiKey && channelId) {
          const cred = await ctx.credentials.resolve(channelCredentialRef(channelId)).catch(() => null)
          if (cred?.value) apiKey = cred.value.split(/[\n\r,;]+/)[0]?.trim() ?? ''
        }
        const base = (rawBase ?? '').replace(/\/+$/, '')
        const result: Record<string, unknown> = { ok: false }
        try {
          if (type === 'image') {
            const probe = await probeImageCapabilities(base, apiKey)
            result.textToImage = { ok: probe.textToImage.ok, endpoint: `${base}/images/generations`, detail: probe.textToImage.detail }
            result.imageToImage = { ok: probe.imageToImage.ok, endpoint: `${base}/images/generations`, formats: probe.imageToImage.formats }
            result.ok = probe.textToImage.ok
          } else {
            const probe = await probeVideoCapabilities(base, apiKey, model)
            // 标准化：先剥 /videos 再统一到 /v1，避免重复拼接
            let videoDisplayBase = base.replace(/\/+$/, '')
            if (videoDisplayBase.endsWith('/videos')) videoDisplayBase = videoDisplayBase.slice(0, -'/videos'.length)
            videoDisplayBase = videoDisplayBase.endsWith('/v1') ? videoDisplayBase : `${videoDisplayBase}/v1`
            result.video = { ok: probe.textToVideo.ok, endpoint: probe.textToVideo.ok ? `${videoDisplayBase}/videos` : '未检测到视频端点' }
            result.videoToImage = { ok: probe.imageToVideo.ok, endpoint: probe.imageToVideo.ok ? `${videoDisplayBase}/videos` : '未检测到图生视频端点' }
            result.ok = probe.textToVideo.ok || probe.imageToVideo.ok
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

  // ─── 智能检测路由（遍历所有渠道）───────────────────────────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: '/plugins/dsh-makemake/check-all',
      handler: async (req, res) => {
        if (!sameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'origin-rejected' }))
          return
        }
        const settings = current() as unknown as RuntimeSettings
        const imgChs = settings.imageChannels ?? []
        const vidChs = settings.videoChannels ?? []
        const probeChannel = async (ch: NonNullable<RuntimeSettings['imageChannels']>[number], type: 'image' | 'video') => {
          const cred = await ctx.credentials.resolve(channelCredentialRef(ch.id)).catch(() => null)
          const base = ch.baseURL.replace(/\/+$/, '')
          const apiKey = cred?.value?.split(/[\n\r,;]+/)[0]?.trim() ?? ''
          const entry: Record<string, unknown> = {
            name: ch.name, type, baseURL: ch.baseURL, model: ch.model, keyConfigured: !!apiKey,
          }
          if (!apiKey) return { ...entry, error: '未配置 API Key' }
          if (type === 'image') {
            const probe = await probeImageCapabilities(base, apiKey)
            entry.textToImage = probe.textToImage
            entry.imageToImage = probe.imageToImage
          } else {
            const probe = await probeVideoCapabilities(base, apiKey, ch.model)
            entry.textToVideo = probe.textToVideo
            entry.imageToVideo = probe.imageToVideo
          }
          return entry
        }
        const results: Array<Record<string, unknown>> = []
        for (const ch of imgChs) results.push(await probeChannel(ch, 'image'))
        for (const ch of vidChs) results.push(await probeChannel(ch, 'video'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, results }))
      },
    })
    return () => {}
  }, 'dsh-makemake: check-all route')

  // ─── 模型列表路由（支持 channelId 从凭据库取 Key）────────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: '/plugins/dsh-makemake/models',
      handler: async (req, res) => {
        if (!sameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'origin-rejected' }))
          return
        }
        let body: { baseURL: string; apiKey: string; channelId?: string }
        try { body = await readJsonBody(req) as typeof body } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid-body' }))
          return
        }
        let base = (body.baseURL ?? '').replace(/\/+$/, '')
        let apiKey = body.apiKey ?? ''
        if (!apiKey && body.channelId) {
          const cred = await ctx.credentials.resolve(channelCredentialRef(body.channelId)).catch(() => null)
          if (cred?.value) apiKey = cred.value.split(/[\n\r,;]+/)[0]?.trim() ?? ''
        }
        // 标准化：剥掉 /videos 路径后缀
        if (base.endsWith('/videos')) base = base.slice(0, -'/videos'.length)
        if (!base) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'baseURL 不能为空' }))
          return
        }
        const models = await probeModelsList(base, apiKey)
        const classified = classifyModels(models)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, models, classified }))
      },
    })
    return () => {}
  }, 'dsh-makemake: models route')

  // ─── 逐端点检测路由（每个能力只报一行，找到就停）──────────────
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact', path: '/plugins/dsh-makemake/check-endpoints',
      handler: async (req, res) => {
        if (!sameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'origin-rejected' }))
          return
        }
        let body: { type: 'image' | 'video'; baseURL: string; model: string; apiKey: string; channelId?: string }
        try { body = await readJsonBody(req) as typeof body } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid-body' }))
          return
        }
        const { type, baseURL: rawBase, model, apiKey: rawApiKey, channelId } = body
        let apiKey = rawApiKey
        if (!apiKey && channelId) {
          const cred = await ctx.credentials.resolve(channelCredentialRef(channelId)).catch(() => null)
          if (cred?.value) apiKey = cred.value.split(/[\n\r,;]+/)[0]?.trim() ?? ''
        }
        let base = (rawBase ?? '').replace(/\/+$/, '')
        // 标准化：剥掉 /videos 路径后缀（候选路径已含 /v1 前缀）
        if (base.endsWith('/videos')) base = base.slice(0, -'/videos'.length)
        const result: Record<string, unknown> = { ok: false, endpoints: [] }

        async function tryEndpoint(path: string, body: object): Promise<{ ok: boolean; status?: number; warn?: boolean }> {
          try {
            const r = await fetch(`${base}${path}`, {
              method: 'POST', redirect: 'error',
              headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(5000),
            })
            const ok = r.status !== 404
            return { ok, status: r.status, warn: r.status === 401 }
          } catch { return { ok: false } }
        }

        try {
          if (type === 'image') {
            // 文生图：试 /v1/images/generations → /images/generations，找到就停
            const ep = result.endpoints as Array<Record<string, unknown>>
            let textToImagePath = ''
            for (const p of ['/v1/images/generations', '/images/generations']) {
              const r = await tryEndpoint(p, {})
              if (r.ok) { textToImagePath = p; break }
            }
            if (textToImagePath) {
              const finalR = await tryEndpoint(textToImagePath, {})
              ep.push({ name: '文生图', ok: true, warn: finalR.warn, path: textToImagePath, status: finalR.status })
            } else {
              ep.push({ name: '文生图', ok: false, reason: '未找到可用端点' })
            }
            // 图生图：复用文生图端点，试格式
            if (textToImagePath) {
              const fmts = await probeImageToImage(base.replace(/\/+$/, ''), apiKey)
              ep.push({ name: '图生图', ok: fmts.ok, formats: fmts.formats, path: textToImagePath })
            } else {
              ep.push({ name: '图生图', ok: false, reason: '依赖文生图端点' })
            }
            result.ok = ep.some(e => e.ok)
          } else {
            // 视频：试 /v1/videos → /videos → /v1/video/generations，找到就停
            const ep = result.endpoints as Array<Record<string, unknown>>
            const videoBody = { model, prompt: 'test', n: 1 }
            let submitPath = ''
            for (const p of ['/v1/videos', '/videos', '/v1/video/generations', '/video/generations', '/v1/tasks', '/tasks']) {
              const r = await tryEndpoint(p, videoBody)
              if (r.ok) { submitPath = p; break }
            }
            if (submitPath) {
              // 找到了，只 push 最终结果
              const finalR = await tryEndpoint(submitPath, videoBody)
              ep.push({ name: '视频提交', ok: true, warn: finalR.warn, path: submitPath, status: finalR.status })
            } else {
              ep.push({ name: '视频提交', ok: false, reason: '未找到可用端点' })
            }
            // 图生视频：复用提交端点，试带图片
            if (submitPath) {
              const i2v = await probeImageToVideo(base, apiKey, model)
              ep.push({ name: '图生视频', ok: i2v.ok, detail: i2v.detail })
            } else {
              ep.push({ name: '图生视频', ok: false, reason: '依赖视频提交端点' })
            }
            // 任务轮询：用提交端点发真实请求，看返回结构
            if (submitPath) {
              const realResp = await fetch(`${base}${submitPath}`, {
                method: 'POST', redirect: 'error',
                headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
                body: JSON.stringify(videoBody),
                signal: AbortSignal.timeout(8000),
              }).catch(() => null)
              if (realResp && realResp.ok) {
                try {
                  const data = await realResp.json() as Record<string, unknown>
                  const taskId = data.id || data.task_id || data.video_id
                  ep.push({
                    name: '任务轮询', ok: !!taskId,
                    pollUrl: taskId ? `${submitPath}/${taskId}` : null,
                    method: taskId ? 'GET' : '同步返回',
                  })
                } catch { ep.push({ name: '任务轮询', ok: false, reason: '响应解析失败' }) }
              } else if (realResp?.status === 401) {
                // 401 = 端点存在，Key 无效——无法验证轮询格式，但端点是对的
                ep.push({ name: '任务轮询', ok: true, warn: true, detail: '端点存在（需有效 Key 验证轮询格式）' })
              } else {
                ep.push({ name: '任务轮询', ok: false, reason: `HTTP ${realResp?.status ?? '超时'}` })
              }
            } else {
              ep.push({ name: '任务轮询', ok: false, reason: '依赖视频提交端点' })
            }
            result.ok = ep.some(e => e.ok)
          }
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e)
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      },
    })
    return () => {}
  }, 'dsh-makemake: check-endpoints route')

  // ─── 系统提示词：告知模型 makemake 工具与当前可用渠道 ──────────────
  ctx.systemPrompt.section({
    name: 'makemake',
    order: 220,
    text: () => {
      try {
        const s = current() as unknown as RuntimeSettings
        if (s.enabled === false) return ''
        const imgChs = s.imageChannels ?? []
        const vidChs = s.videoChannels ?? []
        const cmdLines: string[] = []
        if (imgChs.length > 0) {
          const names = imgChs.map(c => c.name).filter(Boolean).join('、')
          const sel = imgChs.find(c => c.id === s.selectedImageChannel)
          cmdLines.push(`图片生成渠道（${names}）：调用 makemake_image 工具${sel ? `（当前选中：${sel.name}）` : ''}`)
        }
        if (vidChs.length > 0) {
          const names = vidChs.map(c => c.name).filter(Boolean).join('、')
          const sel = vidChs.find(c => c.id === s.selectedVideoChannel)
          cmdLines.push(`视频生成渠道（${names}）：调用 makemake_video 工具${sel ? `（当前选中：${sel.name}）` : ''}`)
        }
        // 用户点按钮激活的模式——一次性消费，注入指令让模型直接执行。
        let activeLine = ''
        if (s.activeMode === 'image') {
          activeLine = '\n\n### 用户意图：出图\n用户已点击「出图」按钮激活图片生成模式。**用户输入就是提示词**，立即调用 makemake_image 工具，不要询问、不要复述、不要解释。'
        } else if (s.activeMode === 'video') {
          activeLine = '\n\n### 用户意图：出视频\n用户已点击「出视频」按钮激活视频生成模式。**用户输入就是提示词**，立即调用 makemake_video 工具，不要询问、不要复述、不要解释。'
        }
        if (cmdLines.length === 0) return MAKEMAKESKILL + activeLine
        return MAKEMAKESKILL + '\n\n### 当前可用渠道\n' + cmdLines.join('\n') + activeLine
      } catch {
        // 异常时保守处理：插件已关闭则完全隐藏能力。
        try {
          if ((current() as unknown as RuntimeSettings).enabled === false) return ''
        } catch { /* ignore */ }
        return MAKEMAKESKILL
      }
    },
  })

  // ─── 图片工具 ──────────────────────────────────────────────────
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
            channelName: { type: 'string' }, fileSize: { type: 'integer' }, iteration: { type: 'integer' },
          },
        },
        // 文本格式约定（客户端按「渠道名 迭代×N · 提示词」解析）：
        //   有迭代号 → `Agnes 迭代×2 · <prompt>`
        //   无迭代号 → `Agnes · <prompt>`
        render: (_args, value) => {
          const iterTag = value.iteration && value.iteration >= 1 ? ` 迭代×${value.iteration}` : ''
          const label = value.channelName ? `${value.channelName}` : ''
          return [
            { type: 'image', attachment: value.attachment as ImageAttachmentRef },
            { type: 'text', text: `${label}${iterTag} · ${value.prompt}` },
          ] as never
        },
        presentationMeta: (args, value) => ({
          kind: 'dsh-makemake',
          model: value.model,
          output: value.output,
          prompt: (args as { prompt: string }).prompt,
          // 不传 attachment：attachment 由 render() 的 content blocks 渲染。
        }),
      },
      async execute(args, exec): Promise<ImageResult> {
        const settings = current() as unknown as RuntimeSettings
        const channels = settings.imageChannels ?? []
        if (channels.length === 0) throw new Error('未配置图片生成渠道，请在设置页添加渠道。')
        if (settings.enabled === false) throw new Error('Make Make 插件已关闭，请在设置页重新启用。')
        const size = resolveSize(args.size)
        // 目标渠道：/渠道名 优先，其次当前选中渠道。（报错也用真实目标，不再误标成选中渠道）
        const target = resolveTargetChannel(settings, 'image', (args as { channel?: string }).channel)
        if (!target) throw new Error('未配置图片生成渠道，请在设置页添加渠道。')

        const srcImage = args.image?.trim() ?? ''
        const isImg2Img = !!srcImage

        // 迭代号：图生图按「参考图血缘」计算；文生图作为新基线（迭代 0），
        // 后续图生图从它 +1。只有生成成功后才登记/推进（失败不跳数）。
        // 参考图解析提到 Key 重试循环之外：参考图读不到不是 Key 的问题，不该换 Key 重试。
        await iterations.load()
        let planned: PlannedIteration
        let refBytes: Uint8Array | null = null
        if (isImg2Img) {
          const ref = await resolveReferenceBytes(srcImage, { dshHome, signal: exec.signal })
          refBytes = ref.bytes
          planned = nextIteration(iterations, refBytes)
        } else {
          planned = { iteration: 0, lineage: newLineageId(), refHash: null }
        }

        const cred = await ctx.credentials.resolve(channelCredentialRef(target.id))
        if (!cred?.value) throw new Error(`渠道「${target.name}」未配置 API Key`)
        const pool = getKeyPool(target.id, cred.value)

        let baseURL = target.baseURL.replace(/\/+$/, '')
        if (baseURL.endsWith('/images/generations')) baseURL = baseURL.slice(0, -'/images/generations'.length)
        const lastErr: string[] = []
        // 循环试所有 Key（一个失败自动试下一个，全部试完才报错）。
        const maxRetries = Math.max(pool.size, 1)
        for (let trial = 0; trial < maxRetries; trial++) {
          const sk = pool.next()
          if (!sk) break
          try {
            const response = await fetch(`${baseURL}/images/generations`, {
              method: 'POST', redirect: 'error', signal: exec.signal,
              headers: { authorization: `Bearer ${sk}`, 'content-type': 'application/json' },
              body: JSON.stringify(isImg2Img
                ? { model: target.model, prompt: args.prompt, size, n: 1, extra_body: { image: [toDataUrl(refBytes!)] } }
                : { model: target.model, prompt: args.prompt, size, n: 1 }),
            })
            const { result } = await handleImageResponse(response, {
              ctx, model: target.model, size, prompt: args.prompt, channelName: target.name,
              iteration: planned.iteration, signal: exec.signal,
            })
            // 生成成功后才消费 activeMode + 登记该血缘的迭代号（失败不推进）。
            void scope.update({ activeMode: null }).catch(() => {})
            // 血缘 key 用「附件实际落盘字节的内容寻址哈希」（= attachmentId 的 sha256 部分），
            // 而不是「API 返回的原始 outBytes 哈希」。原因：DSH attachment 存储会对图片做
            // 重编码/规范化，用户后续当作参考图引用的是「落盘后的字节」（也就是附件 ID 指向
            // 的对象字节），其哈希才是下一次图生图 nextIteration 算出的 refHash。若这里仍按
            // 原始 outBytes 记哈希，下次把这张图当参考图时哈希必然不匹配 → 被当作新血缘、
            // 迭代归 1，计数器就永远跳不上去。
            iterations.set(result.attachment.attachmentId.replace(/^sha256:/, ''), { iteration: planned.iteration, lineage: planned.lineage })
            await iterations.persist().catch(err => {
              // 血缘落盘是记账性操作：失败不应中断生成，但要让运维可见。
              console.warn(`[dsh-makemake] 迭代血缘落盘失败：${err instanceof Error ? err.message : String(err)}`)
            })
            return result
          } catch (e) {
            // 失败：保留 activeMode（模型可重试），不消费。
            const msg = e instanceof Error ? e.message : String(e)
            const code = httpCodeOf(msg)
            // 只对 429/限流冷却 Key（长冷却）；超时/网络抖动短冷却；其他错误不冷却。
            if (code === 429 || code === 408 || /timeout|ECONNRESET/i.test(msg)) {
              pool.fail(sk, code === 429 ? 60_000 : 10_000)
            }
            lastErr.push(`渠道「${target.name}」(${target.baseURL}): ${classifyError(code || undefined, msg)}`)
            // 不 return——继续内层循环试下一个 Key。
          }
        }
        throw new Error(`图片生成失败（渠道「${target.name}」）：${lastErr.join('\n') || '所有 Key 不可用'}`)
      },
      presentResult: (_args, result) => {
        const meta = result.meta as Record<string, unknown> | undefined
        if (meta?.kind !== 'dsh-makemake') return undefined
        return { card: 'generic', title: '已生成图片' }
      },
    }))
  }

  // ─── 视频工具 ──────────────────────────────────────────────────
  function registerVideoTool() {
    return ctx.tools.register(defineTool({
      name: 'makemake_video',
      description: 'Generate one video using the Make Make configured channel. Supports Agnes Video V2.0 and 2.5 Flash (auto-detected by model). Pass "image" for image-to-video (i2v). Pass "video" to CONTINUE an existing video — its last frame is extracted and used as the start of the new segment (视频延续 / 视频生视频).',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Complete description of the video to generate.' },
        duration: { type: 'string', description: 'Optional video duration, e.g. "5s" or "10s".' },
        channel: { type: 'string', description: 'Optional channel name to use. When the user typed /渠道名, pass the channel name here.' },
        image: { type: 'string', description: 'Optional reference image URL or path for image-to-video (i2v). When passed, the API animates the image into a video per the prompt.' },
        video: { type: 'string', description: 'Optional reference video URL/path to CONTINUE. Its last frame is extracted and used as the start frame of the new video (视频延续/视频生视频).' },
        first_frame: { type: 'string', description: 'Optional first-frame image URL/path for keyframe control. Overrides image/video as the start frame.' },
        last_frame: { type: 'string', description: 'Optional last-frame image URL/path for keyframe control (pairs with first_frame).' },
        aspect_ratio: { type: 'string', description: 'Optional aspect ratio for 2.5 Flash, e.g. "16:9", "9:16", "1:1". Defaults to "16:9".' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false, properties: {
            url: { type: 'string', required: true, description: 'URL to access the generated video.' },
            model: { type: 'string', required: true }, duration: { type: 'string', required: true }, prompt: { type: 'string', required: true },
            channelName: { type: 'string' }, size: { type: 'string' }, seconds: { type: 'string' },
            fileSize: { type: 'number' }, iteration: { type: 'number' }, videoCode: { type: 'string' },
          },
        },
        render: (_args, value) => {
          const sizeText = value.size ? `尺寸 ${value.size}` : ''
          const secsText = value.seconds ? `时长 ${value.seconds}s` : ''
          const mb = value.fileSize ? `${(value.fileSize / 1024 / 1024).toFixed(1)} MB` : ''
          const iterText = value.iteration != null && value.iteration >= 1 ? `迭代×${value.iteration}` : ''
          const meta = [sizeText, secsText, mb, iterText].filter(Boolean).join(' · ')
          return [
            { type: 'text', text: [
              `🎬 已生成视频 · ${value.channelName ?? ''} · ${value.duration}`,
              meta,
              `引用：${value.videoCode ?? ''}`,
              value.url,
              value.prompt,
            ].filter(Boolean).join('\n') },
          ]
        },
        presentationMeta: () => ({ kind: 'dsh-makemake-video' }),
      },
      async execute(args, exec): Promise<{ url: string; model: string; duration: string; prompt: string; channelName: string; size: string; seconds: string; fileSize: number; iteration: number; videoCode: string }> {
        const settings = current() as unknown as RuntimeSettings
        const channels = settings.videoChannels ?? []
        if (channels.length === 0) throw new Error('未配置视频生成渠道，请在设置页添加渠道。')
        if (settings.enabled === false) throw new Error('Make Make 插件已关闭，请在设置页重新启用。')
        const a = args as { image?: string; video?: string; first_frame?: string; last_frame?: string; aspect_ratio?: string }
        const srcVideo = a.video?.trim() ?? ''
        const srcImage = a.image?.trim() ?? ''
        const srcFirst = a.first_frame?.trim() ?? ''
        const srcLast = a.last_frame?.trim() ?? ''
        const hasMedia = !!(srcVideo || srcImage || srcFirst || srcLast)
        // 硬闸门（仅纯文字出视频）：没传任何媒体时必须点按钮才出，防止聊天误判。
        if (!hasMedia && settings.activeMode !== 'video') {
          throw new Error('未点击「出视频」按钮，无法确认出视频意图。如果你想出视频，请先点击工具栏的「出视频」按钮，再输入提示词。')
        }
        const target = resolveTargetChannel(settings, 'video', (args as { channel?: string }).channel)
        if (!target) throw new Error('未配置视频生成渠道，请在设置页添加渠道。')
        const model = target.model
        // 2.5 Flash 与 v2.0 走不同的请求/轮询格式。
        const isFlash = /flash/i.test(model)

        // 时长：v2.0 不发送该字段；flash 发送 seconds 字符串 "4"–"12"。
        const duration = args.duration ?? '5s'
        const rawSeconds = String(duration).replace(/s$/i, '')
        const secsNum = Math.max(4, Math.min(12, parseInt(rawSeconds, 10) || 5))
        const secsStr = String(secsNum)

        // 输入源 → 起始/尾帧字节。优先级：first_frame > image > video(取末帧)。
        // 注意：v2.0 的 image 接受「data: 数据 URL」，而 2.5 Flash 的 first_frame 只接受
        // 「裸 base64」（data: 前缀会被判为无效）。因此这里只保存字节，构造体时按模型取形式。
        let firstFrameBytes: Uint8Array | null = null
        let firstFrameMime = 'image/png'
        let lastFrameBytes: Uint8Array | null = null
        let lastFrameMime = 'image/png'
        let sourceVideoUrl: string | undefined
        let videoCleanup: (() => Promise<void>) | null = null
        const resolveImageBytes = async (s: string): Promise<{ bytes: Uint8Array; mime: string }> => {
          if (/^data:image\//.test(s)) {
            const dm = s.match(/^data:([^;,]+);base64,(.+)$/)
            if (dm?.[2]) return { bytes: new Uint8Array(Buffer.from(dm[2]!, 'base64')), mime: dm[1]! }
          }
          const ref = await resolveReferenceBytes(s, { dshHome, signal: exec.signal })
          return { bytes: ref.bytes, mime: ref.mime }
        }
        // 需要注册表才能解析 [视频N] 简码 → 真实视频 URL，提前一次性加载。
        await iterations.load()
        try {
          if (srcFirst) {
            const r = await resolveImageBytes(srcFirst)
            firstFrameBytes = r.bytes; firstFrameMime = r.mime
          } else if (srcImage) {
            const r = await resolveImageBytes(srcImage)
            firstFrameBytes = r.bytes; firstFrameMime = r.mime
          } else if (srcVideo) {
            // 视频延续：取上一段视频的最后一帧作为新段起始帧。
            // 支持 `[视频N]` 引用简码 → 经注册表定位真实视频 URL。
            let videoSrc = srcVideo.trim()
            if (/^\[视频\d+\]$/.test(videoSrc)) {
              const real = iterations.lookupVideoCode(videoSrc)
              if (!real) throw new Error(`找不到简码 ${videoSrc} 对应的视频，请先用「引用此视频」引用一个已生成的视频`)
              videoSrc = real
            }
            const frame = await resolveVideoLastFrame(videoSrc, { dshHome })
            firstFrameBytes = frame.bytes; firstFrameMime = frame.mime
            sourceVideoUrl = videoSrc
            videoCleanup = frame.cleanup
          }
          if (srcLast) {
            const r = await resolveImageBytes(srcLast)
            lastFrameBytes = r.bytes; lastFrameMime = r.mime
          }
        } catch (e) {
          throw new Error(`视频输入解析失败：${e instanceof Error ? e.message : String(e)}`)
        }

        // 迭代号：视频延续按「来源视频 URL」血缘；文生/图生视频起始为 1。
        await iterations.load()
        const iter = sourceVideoUrl
          ? nextVideoIteration(iterations, sourceVideoUrl)
          : { iteration: 1, lineage: newLineageId(), refHash: null }

        // 构造上游请求体（按模型走对应模式 & 媒体形式）。
        const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
        const flashCommon = { model, prompt: args.prompt, seconds: secsStr, size: '720P', aspect_ratio: a.aspect_ratio || '16:9' }
        let body: Record<string, unknown>
        if (isFlash) {
          if (firstFrameBytes && lastFrameBytes) {
            body = { model, prompt: args.prompt, mode: 'keyframe', seconds: secsStr, size: '720P', aspect_ratio: a.aspect_ratio || '16:9', first_frame: b64(firstFrameBytes), last_frame: b64(lastFrameBytes) }
          } else if (firstFrameBytes) {
            body = { ...flashCommon, mode: 'keyframe', first_frame: b64(firstFrameBytes) }
          } else {
            body = { ...flashCommon, mode: 'text' }
          }
        } else {
          const firstData = firstFrameBytes ? toDataUrl(firstFrameBytes, firstFrameMime) : undefined
          const lastData = lastFrameBytes ? toDataUrl(lastFrameBytes, lastFrameMime) : undefined
          if (firstData && lastData) {
            body = { model, prompt: args.prompt, mode: 'keyframes', extra_body: { image: [firstData, lastData], mode: 'keyframes' }, n: 1 }
          } else if (firstData) {
            body = { model, prompt: args.prompt, mode: 'ti2vid', image: firstData, n: 1 }
          } else {
            body = { model, prompt: args.prompt, n: 1 }
          }
        }

        const cred = await ctx.credentials.resolve(channelCredentialRef(target.id))
        if (!cred?.value) throw new Error(`渠道「${target.name}」未配置 API Key`)
        const pool = getKeyPool(target.id, cred.value)
        if (pool.size === 0) throw new Error(`渠道「${target.name}」未配置有效 Key`)
        let baseURL = target.baseURL.replace(/\/+$/, '')
        // 已含 /videos → 剥掉（后续拼 /videos）
        if (baseURL.endsWith('/videos')) baseURL = baseURL.slice(0, -'/videos'.length)
        const videoBase = baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`

        try {
          // 每个 Key 一次提交成功后进入冷却；一次请求最多轮询每个 Key 一遍。
          const maxKeyAttempts = Math.max(pool.size, 1)
          let submitResp: Response | null = null
          let lastSubmitErr = ''
          let usedKey = ''
          for (let ki = 0; ki < maxKeyAttempts; ki++) {
            const curSk = pool.next()
            if (!curSk) break
            usedKey = curSk
            submitResp = await fetch(`${videoBase}/videos`, {
              method: 'POST', redirect: 'error', signal: exec.signal,
              headers: { authorization: `Bearer ${curSk}`, 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (submitResp.ok) {
              pool.succeedVideo(curSk)
              break
            }
            const text = (await submitResp.text()).slice(0, 300)
            if (submitResp.status === 503 || /queue_full/i.test(text)) {
              lastSubmitErr = '队列满，Key 轮询中'
              continue
            }
            pool.fail(curSk, submitResp.status === 429 ? 60_000 : 10_000)
            lastSubmitErr = `HTTP ${submitResp.status}: ${text}`
          }
          if (!submitResp?.ok) throw new Error(`提交失败：${lastSubmitErr || '所有 Key 不可用'}`)

          const submitData = await submitResp.json() as {
            id?: string; video_id?: string; task_id?: string; status?: string; size?: string; seconds?: string
            video_url?: string; url?: string; metadata?: { url?: string }
            error?: { message?: string }
          }
          if (submitData.error) throw new Error(submitData.error.message ?? 'API 返回错误')
          const taskId = submitData.id ?? submitData.task_id ?? submitData.video_id
          if (!taskId) throw new Error('API 返回了空任务 ID')
          const videoId = submitData.video_id

          // 轮询：flash 用 agnesapi?video_id&model_name；v2.0 用 /v1/videos/<task_id>（均含 metadata.url）。
          const pollUrl = isFlash
            ? `${baseURL}/agnesapi?video_id=${encodeURIComponent(videoId ?? taskId)}&model_name=${encodeURIComponent(model)}`
            : `${videoBase}/videos/${taskId}`
          let done = false
          let videoTask: {
            size?: string; seconds?: string
            video_url?: string; url?: string; metadata?: { url?: string }
            video?: { url?: string; video_url?: string }
            error?: { message?: string }
          } | undefined
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
            videoTask = await pollResp.json() as typeof videoTask
            if (videoTask?.error) throw new Error(videoTask.error.message ?? '视频生成失败')
            const st = (videoTask as { status?: string }).status
            if (st === 'succeeded' || st === 'completed') { done = true; break }
            if (st === 'failed') throw new Error(`视频生成失败（status: ${st}）`)
          }
          if (!done && !videoTask?.metadata?.url && !videoTask?.url && !videoTask?.video_url) {
            // 超时但可能已结束，继续尝试在下方兜底取 URL。
          }

          let videoUrl = videoTask?.video_url
            || videoTask?.url
            || videoTask?.metadata?.url
            || videoTask?.video?.video_url
            || videoTask?.video?.url
            || ''
          if (!videoUrl && videoId) {
            const resultResp = await fetch(`${baseURL}/agnesapi?video_id=${encodeURIComponent(videoId)}${isFlash ? `&model_name=${encodeURIComponent(model)}` : ''}`, {
              redirect: 'error', signal: exec.signal,
              headers: { authorization: `Bearer ${usedKey}` },
            })
            if (resultResp.ok) {
              const resultData = await resultResp.json() as { url?: string; video_url?: string; metadata?: { url?: string } }
              videoUrl = resultData.url || resultData.video_url || resultData.metadata?.url || ''
            }
          }
          if (!videoUrl) {
            throw new Error(`当前「${target.name}」渠道已完成生成，但没有返回可用的视频 URL（状态响应缺少 video_url/url/metadata.url）`)
          }

          const size = videoTask?.size ?? submitData.size ?? ''
          const seconds = videoTask?.seconds ?? submitData.seconds ?? secsStr

          // 视频文件大小：HEAD 取 content-length（拿不到则省略）。
          let fileSize = 0
          try {
            const head = await fetch(videoUrl, { method: 'HEAD', redirect: 'follow', signal: exec.signal })
            const cl = head.headers.get('content-length')
            if (cl) fileSize = parseInt(cl, 10) || 0
          } catch { /* 忽略 */ }

          // 生成成功 → 消费 activeMode + 登记视频延续血缘（按本次生成 URL）+ 分配引用简码。
          void scope.update({ activeMode: null }).catch(() => {})
          const iteration = iter.iteration
          iterations.setVideo(videoUrl, { iteration, lineage: iter.lineage })
          const videoCode = iterations.registerVideoCode(videoUrl)
          await iterations.persist().catch(err => console.warn(`[dsh-makemake] 视频血缘落盘失败：${err instanceof Error ? err.message : String(err)}`))

          return { url: videoUrl, model, duration, prompt: args.prompt, channelName: target.name, size, seconds, fileSize, iteration, videoCode }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          throw new Error(`视频生成失败（渠道「${target.name}」）：${classifyError(httpCodeOf(msg) || undefined, msg)}`)
        } finally {
          await videoCleanup?.().catch(() => {})
        }
      },
      presentResult: (_args, result) => {
        const meta = result.meta as Record<string, unknown> | undefined
        if (meta?.kind !== 'dsh-makemake-video') return undefined
        return { card: 'generic', title: '已生成视频' }
      },
    }))
  }

  // ─── 动态注册/注销工具：插件关闭时工具完全消失，模型感知不到 ─────
  let disposeImage: (() => void) | null = null
  let disposeVideo: (() => void) | null = null
  const initialEnabled = (current() as unknown as RuntimeSettings).enabled !== false
  if (initialEnabled) {
    disposeImage = registerImageTool()
    disposeVideo = registerVideoTool()
  }
  const disposeWatch = scope.watch((next: RuntimeSettings, prev: RuntimeSettings) => {
    const wasEnabled = prev.enabled !== false
    const isEnabled = next.enabled !== false
    if (!isEnabled && wasEnabled) {
      // 插件关闭 → 注销工具（模型完全感知不到）。
      disposeImage?.()
      disposeVideo?.()
      disposeImage = null
      disposeVideo = null
    } else if (isEnabled && !wasEnabled) {
      // 插件重新开启 → 重新注册工具。
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