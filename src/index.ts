/** Make Make — image + video generation bundle for DeepSeek Harness.
 * Multi-channel: each channel = one OpenAI-compatible endpoint (universal). */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config } from './config.js'
import { IMAGE_ROUTE } from './shared.js'
import { serveImage } from './image-route.js'
import { CREATION_NAMESPACE } from './shared.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export { Config } from './config.js'
export { IMAGE_ROUTE } from './shared.js'

/** Cordis plugin name. */
export const name = 'dsh-makemake'
/** Host services required by the Bundle. */
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings']

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
        kind: 'dsh-makemake', attachment: value.attachment,
        model: value.model, output: value.output,
        prompt: (args as { prompt: string }).prompt,
        srcImage: (args as { image?: string }).image,
      }),
    },
    async execute(args, exec): Promise<{ attachment: ImageAttachmentRef; model: string; output: string; prompt: string }> {
      const settings = current() as unknown as RuntimeSettings
      const channel = resolveChannel(settings, 'image')
      if (!channel) throw new Error('make_image 未配置图片渠道，请在设置页添加渠道。')
      const credential = await ctx.credentials.resolve(channelCredentialRef(channel.id))
      if (!credential?.value) throw new Error(`make_image 渠道「${channel.name}」未配置 API Key。`)
      const baseURL = channel.baseURL.replace(/\/+$/, '')
      const model = channel.model
      const size = args.size ?? '1024x1024'
      const srcImage = args.image?.trim()
      // 图生图: 走 /images/edits (multipart) 或 /images/generations (带 image_url)
      let response: Response
      if (srcImage) {
        const form = new FormData()
        form.append('model', model)
        form.append('prompt', args.prompt)
        form.append('n', '1')
        form.append('size', size)
        // 支持 URL 或本地 attachment 路径
        if (/^https?:\/\//.test(srcImage)) {
          form.append('image', srcImage)
        } else {
          const imgResp = await fetch(srcImage, { redirect: 'follow', signal: exec.signal })
          if (!imgResp.ok) throw new Error(`参考图读取失败（HTTP ${imgResp.status}）`)
          const blob = await imgResp.blob()
          form.append('image', blob, 'reference.png')
        }
        response = await fetch(`${baseURL}/images/edits`, {
          method: 'POST', redirect: 'error', signal: exec.signal,
          headers: { authorization: `Bearer ${credential.value}` },
          body: form,
        })
      } else {
        response = await fetch(`${baseURL}/images/generations`, {
          method: 'POST', redirect: 'error', signal: exec.signal,
          headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt: args.prompt, size, n: 1 }),
        })
      }
      if (!response.ok) {
        const text = (await response.text()).slice(0, 500)
        throw new Error(`图片生成失败（HTTP ${response.status}）：${text}`)
      }
      const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
      const image = payload.data?.[0]
      if (!image) throw new Error('图片生成返回了空结果')
      let data: Uint8Array
      let mediaType: ImageAttachmentRef['mediaType']
      if (image.b64_json) {
        const clean = image.b64_json.replace(/\s+/g, '')
        if (!clean.length) throw new Error('图片生成返回了空 base64 数据')
        data = new Uint8Array(Buffer.from(clean, 'base64'))
        mediaType = 'image/png'
      } else if (image.url) {
        const imgResp = await fetch(image.url, { redirect: 'follow', signal: exec.signal })
        if (!imgResp.ok) throw new Error(`图片下载失败（HTTP ${imgResp.status}）`)
        const ct = (imgResp.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
        mediaType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ct)
          ? ct as ImageAttachmentRef['mediaType'] : 'image/png'
        data = new Uint8Array(await imgResp.arrayBuffer())
      } else {
        throw new Error('图片生成返回了未知格式')
      }
      const maxBytes = ctx.attachments.imageLimits.maxImageBytes
      if (data.byteLength > maxBytes) throw new Error(`图片超出 ${maxBytes} 字节限制`)
      if (!ctx.attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`不支持 ${mediaType} 格式`)
      const attachment = await ctx.attachments.saveImage({ data, mediaType, name: 'generated-image' })
      return { attachment, model, output: size, prompt: args.prompt }
    },
    presentResult: (_args, result) => {
      const meta = result.meta as Record<string, unknown> | undefined
      if (meta?.kind !== 'dsh-makemake') return undefined
      const att = meta.attachment as ImageAttachmentRef | undefined
      if (!att || typeof att.attachmentId !== 'string') return undefined
      return { card: 'generic', title: '已生成图片', content: [{ type: 'image', attachment: att }] }
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
        { type: 'text', text: `已生成视频（${value.model}，时长 ${value.duration}）：${value.prompt}` },
      ],
      presentationMeta: (args, value) => ({
        kind: 'dsh-makemake-video', url: value.url,
        model: value.model, duration: value.duration,
        prompt: (args as { prompt: string }).prompt,
      }),
    },
    async execute(args, exec): Promise<{ url: string; model: string; duration: string; prompt: string }> {
      const settings = current() as unknown as RuntimeSettings
      const channel = resolveChannel(settings, 'video')
      if (!channel) throw new Error('make_video 未配置视频渠道，请在设置页添加渠道。')
      const credential = await ctx.credentials.resolve(channelCredentialRef(channel.id))
      if (!credential?.value) throw new Error(`make_video 渠道「${channel.name}」未配置 API Key。`)
      const baseURL = channel.baseURL.replace(/\/+$/, '')
      const model = channel.model
      const duration = args.duration ?? '5s'
      const response = await fetch(`${baseURL}/videos/generations`, {
        method: 'POST', redirect: 'error', signal: exec.signal,
        headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: args.prompt, duration, n: 1 }),
      })
      if (!response.ok) {
        const text = (await response.text()).slice(0, 500)
        throw new Error(`视频生成失败（HTTP ${response.status}）：${text}`)
      }
      const payload = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> }
      const video = payload.data?.[0]
      if (!video?.url) throw new Error('视频生成返回了空结果')
      return { url: video.url, model, duration, prompt: args.prompt }
    },
    presentResult: (_args, result) => {
      const meta = result.meta as Record<string, unknown> | undefined
      if (meta?.kind !== 'dsh-makemake-video') return undefined
      const url = meta.url as string | undefined
      if (!url) return undefined
      return { card: 'generic', title: '已生成视频', content: [{ type: 'text', text: `视频链接：${url}` }] }
    },
  }))
}