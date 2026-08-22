/** Make Make — image generation bundle for DeepSeek Harness.
 * Multi-channel: each channel = one OpenAI-compatible endpoint (universal).
 * The currently selected channel (per type) drives generation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config } from './config.js'
import { CREATION_NAMESPACE } from './shared.js'

export { Config } from './config.js'

/** Cordis plugin name. */
export const name = 'dsh-makemake'
/** Host services required by the Bundle. */
export const inject = ['tools', 'attachments', 'credentials', 'settings']

interface GeneratedValue {
  attachment: ImageAttachmentRef
  model: string
  output: string
  prompt: string
}

interface Channel {
  id: string
  name: string
  baseURL: string
  model: string
}

/** Generate credential ref for one channel (matches client logic). */
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

/** Resolve the channel to use for a type. */
function resolveChannel(settings: RuntimeSettings, type: 'image' | 'video'): Channel | undefined {
  const channels = type === 'image' ? settings.imageChannels : settings.videoChannels
  const selectedId = type === 'image' ? settings.selectedImageChannel : settings.selectedVideoChannel
  if (!Array.isArray(channels) || channels.length === 0) return undefined
  const selected = channels.find(c => c.id === selectedId)
  return selected ?? channels[0]
}

/** Register settings and the model-callable tool. */
export function apply(ctx: Context, config: Config = {}): void {
  const scope = ctx.settings.register(settingsNamespace(CREATION_NAMESPACE), Config, { base: config })
  let current: () => Config = () => scope.get()

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one image using the configured channel. Use when the user asks to create, draw, or generate an image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      size: { type: 'string', description: 'Optional image size, e.g. "1024x1024" or "2K".' },
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
        attachment: value.attachment,
        model: value.model,
        output: value.output,
        prompt: (args as { prompt: string }).prompt,
      }),
    },
    async execute(args, exec): Promise<GeneratedValue> {
      // Read the LIVE settings (channel list + selection) from the scope.
      const settings = current() as unknown as RuntimeSettings
      const channel = resolveChannel(settings, 'image')
      if (channel === undefined) throw new Error('generate_image 未配置图片渠道，请在设置页添加渠道。')
      const credential = await ctx.credentials.resolve(channelCredentialRef(channel.id))
      if (credential === undefined || credential.value.length === 0) throw new Error(`generate_image 渠道「${channel.name}」未配置 API Key。`)
      const baseURL = channel.baseURL.replace(/\/+$/, '')
      const model = channel.model
      const size = args.size ?? '1024x1024'
      const response = await fetch(`${baseURL}/images/generations`, {
        method: 'POST', redirect: 'error', signal: exec.signal,
        headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: args.prompt, size, n: 1 }),
      })
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
        if (clean.length === 0) throw new Error('图片生成返回了空 base64 数据')
        data = new Uint8Array(Buffer.from(clean, 'base64'))
        mediaType = 'image/png'
      } else if (image.url) {
        const imgResp = await fetch(image.url, { redirect: 'follow', signal: exec.signal })
        if (!imgResp.ok) throw new Error(`图片下载失败（HTTP ${imgResp.status}）`)
        const ct = (imgResp.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
        mediaType = ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/webp' || ct === 'image/gif' ? ct as ImageAttachmentRef['mediaType'] : 'image/png'
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
      const attachment = meta.attachment as ImageAttachmentRef | undefined
      if (!attachment || typeof attachment.attachmentId !== 'string') return undefined
      return { card: 'generic' as const, title: '已生成图片', content: [{ type: 'image' as const, attachment }] }
    },
  }))
}