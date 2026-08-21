/** Make Make — multi-provider image generation bundle for DeepSeek Harness. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import { Config, resolveProvider, type AspectRatio, type ImageProvider, type ImageSize } from './config.js'
import { generateGoogleImage } from './google.js'
import { IMAGE_ROUTE, imageAttachmentFromMeta, serveImage } from './image-route.js'
import { generateOpenAICompatibleImage } from './openai-compatible.js'
import { CREATION_NAMESPACE } from './shared.js'

export { Config } from './config.js'
export { IMAGE_ROUTE, imageAttachmentFromMeta } from './image-route.js'

/** Cordis plugin name. */
export const name = 'dsh-makemake'
/** Host services required by the Bundle. */
export const inject = ['tools', 'attachments', 'credentials', 'webServer']

interface GeneratedValue {
  attachment: ImageAttachmentRef
  provider: ImageProvider
  model: string
  output: string
}

/** Register settings, the image route, and the model-callable tool. */
export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, settingsNamespace(CREATION_NAMESPACE), Config, config, {
    setSource: source => { current = source }, onChange: () => {},
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: IMAGE_ROUTE,
    handler: (req, res) => serveImage(req, res, { readImage: ref => ctx.attachments.readImage(ref) }),
  }), 'dsh-makemake: image route')

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one image with the configured provider. Use when the user asks to create, draw, or generate an image. Give a complete visual prompt including subject, composition, style, lighting, and any exact text that should appear. A successful image is already attached directly to the conversation and has no local file path; do not call read, glob, or other tools to locate it.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      aspect_ratio: { type: 'string', enum: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], description: 'Optional output aspect ratio for Google Gemini.' },
      image_size: { type: 'string', enum: ['1K', '2K', '4K'], description: 'Optional output resolution for Google Gemini.' },
      size: { type: 'string', description: 'Optional dimensions or size tier for OpenAI or Seedream.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          attachment: { type: 'object', required: true, additionalProperties: false, properties: {
            attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' },
          } },
          provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Generated one image with ${value.provider}/${value.model} (${value.output}). It is already attached to the conversation with no local file path; respond to the user without reading or searching for it.` }],
      presentationMeta: (args, value) => ({
        kind: 'dsh-makemake',
        attachment: value.attachment,
        provider: value.provider,
        model: value.model,
        output: value.output,
        prompt: (args as { prompt: string }).prompt,
      }),
    },
    async execute(args, exec): Promise<GeneratedValue> {
      const active = resolveProvider(current())
      const credential = await ctx.credentials.resolve(credentialRef(active.apiKeyEnv))
      if (credential === undefined || credential.value.length === 0) throw new Error(`generate_image requires the ${active.apiKeyEnv} credential; configure it in Settings > Plugins > Image generation.`)
      if (active.provider === 'google') {
        const aspectRatio = (args.aspect_ratio ?? active.aspectRatio) as AspectRatio
        const imageSize = (args.image_size ?? active.imageSize) as ImageSize
        const generated = await generateGoogleImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, aspectRatio, imageSize, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, active.provider, active.model, `${aspectRatio}, ${imageSize}`)
      }
      const size = args.size ?? active.imageSize
      const generated = await generateOpenAICompatibleImage({ provider: active.provider, apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
      return saveGenerated(ctx, generated, active.provider, active.model, size)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))
}

async function saveGenerated(ctx: Context, generated: { data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }, provider: ImageProvider, model: string, output: string): Promise<GeneratedValue> {
  if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) throw new Error(`This DSH deployment does not accept ${generated.mediaType} generated images`)
  const attachment = await ctx.attachments.saveImage({ data: generated.data, mediaType: generated.mediaType, name: 'generated-image' })
  return { attachment, provider, model, output }
}

function imagePresentation(result: ToolResult) {
  const attachment = imageAttachmentFromMeta(result.meta)
  return attachment === undefined ? undefined : { card: 'generic' as const, title: 'Generated image', content: [{ type: 'image' as const, attachment }] }
}