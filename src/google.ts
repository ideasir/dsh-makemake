/** Google Gemini Interactions API adapter. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { AspectRatio, ImageSize } from './config.js'

const ERROR_LIMIT = 4096
const REQUESTED_MEDIA_TYPE = 'image/jpeg'

/** Image bytes returned before Attachment persistence. */
export interface GeneratedImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** Send one native Google image request and validate its inline image response. */
export async function generateGoogleImage(input: {
  apiKey: string
  endpoint: string
  model: string
  prompt: string
  aspectRatio: AspectRatio
  imageSize: ImageSize
  maxBytes: number
  signal: AbortSignal
}): Promise<GeneratedImage> {
  const response = await fetch(input.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: input.signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': input.apiKey },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      response_format: {
        type: 'image',
        mime_type: REQUESTED_MEDIA_TYPE,
        aspect_ratio: input.aspectRatio,
        image_size: input.imageSize,
      },
    }),
  })
  const text = await readBoundedText(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT)
  if (!response.ok) throw new Error(`Google image generation failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Google image generation returned invalid JSON')
  }
  const image = outputImage(payload)
  if (image === undefined) throw new Error(`Google image generation returned no image: ${text.slice(0, ERROR_LIMIT)}`)
  const mediaType = mediaTypeOf(image.mime_type ?? REQUESTED_MEDIA_TYPE)
  if (mediaType === undefined) throw new Error(`Google image generation returned unsupported media type ${JSON.stringify(image.mime_type)}`)
  const data = decodeBase64(image.data)
  if (data.byteLength > input.maxBytes) throw new Error(`Google image generation exceeded the ${String(input.maxBytes)} byte image limit`)
  return { data, mediaType }
}

function outputImage(value: unknown): { data: string; mime_type?: unknown } | undefined {
  const interaction = record(value)
  if (interaction === undefined) return undefined
  const direct = imageContent(interaction.output_image, false)
  if (direct !== undefined) return direct
  if (!Array.isArray(interaction.steps)) return undefined
  for (const step of interaction.steps) {
    const modelOutput = record(step)
    if (modelOutput?.type !== 'model_output' || !Array.isArray(modelOutput.content)) continue
    for (const content of modelOutput.content) {
      const image = imageContent(content, true)
      if (image !== undefined) return image
    }
  }
  return undefined
}

function imageContent(value: unknown, requiresImageType: boolean): { data: string; mime_type?: unknown } | undefined {
  const image = record(value)
  if (image === undefined || (requiresImageType && image.type !== 'image') || typeof image.data !== 'string') return undefined
  return { data: image.data, mime_type: image.mime_type }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function mediaTypeOf(value: unknown): ImageMediaType | undefined {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif' ? value : undefined
}

function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/\s+/g, '')
  if (clean.length === 0) throw new Error('Google image generation returned invalid base64 image data')
  const decoded = Buffer.from(clean, 'base64')
  if (decoded.length === 0) throw new Error('Google image generation returned invalid base64 image data')
  return new Uint8Array(decoded)
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) throw new Error(`Response exceeded ${String(maxBytes)} bytes`)
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}