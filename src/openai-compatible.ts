/** OpenAI Images API and Volcengine Ark/Seedream response adapter. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

const ERROR_LIMIT = 4096

/** One generated raster normalized before Attachment persistence. */
export interface GeneratedCompatibleImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** Generate an image from an OpenAI-compatible endpoint. */
export async function generateOpenAICompatibleImage(input: {
  provider: 'openai' | 'seedream'
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  size: string
  maxBytes: number
  signal: AbortSignal
}): Promise<GeneratedCompatibleImage> {
  const response = await fetch(imageEndpoint(input.baseURL), {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, size: input.size, ...(input.provider === 'seedream' ? { response_format: 'url' } : {}) }),
  })
  const text = await readBoundedText(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT)
  if (!response.ok) throw new Error(`${input.provider} image generation failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error(`${input.provider} image generation returned invalid JSON`) }
  const image = firstImage(payload)
  if (image === undefined) throw new Error(`${input.provider} image generation returned no image: ${text.slice(0, ERROR_LIMIT)}`)
  if (image.b64_json !== undefined) return { data: decodeBase64(image.b64_json, input.provider), mediaType: 'image/png' }
  return downloadImage(image.url, input)
}

function imageEndpoint(baseURL: string): string {
  try { return new URL('images/generations', baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString() } catch { throw new Error('Image generation endpoint must be an absolute URL') }
}

function firstImage(value: unknown): { b64_json?: string; url?: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const data = (value as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return undefined
  const candidate = data[0]
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
  const item = candidate as { b64_json?: unknown; url?: unknown }
  return typeof item.b64_json === 'string' ? { b64_json: item.b64_json } : typeof item.url === 'string' ? { url: item.url } : undefined
}

async function downloadImage(url: string | undefined, input: Parameters<typeof generateOpenAICompatibleImage>[0]): Promise<GeneratedCompatibleImage> {
  if (url === undefined) throw new Error(`${input.provider} image generation returned no image data`)
  const response = await fetch(url, { redirect: 'follow', signal: input.signal })
  if (!response.ok) throw new Error(`${input.provider} image download failed (${response.status})`)
  const mediaType = imageMediaType(response.headers.get('content-type'))
  if (mediaType === undefined) throw new Error(`${input.provider} image download returned unsupported content type`)
  return { data: await readBoundedBytes(response, input.maxBytes), mediaType }
}

function decodeBase64(value: string, provider: string): Uint8Array {
  const clean = value.replace(/\s+/g, '')
  if (clean.length === 0) throw new Error(`${provider} image generation returned invalid base64 image data`)
  const decoded = Buffer.from(clean, 'base64')
  if (decoded.length === 0) throw new Error(`${provider} image generation returned invalid base64 image data`)
  return new Uint8Array(decoded)
}

function imageMediaType(value: string | null): ImageMediaType | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif' ? mediaType : undefined
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> { return new TextDecoder().decode(await readBoundedBytes(response, maxBytes)) }

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0
  try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > maxBytes) throw new Error(`Image response exceeded ${String(maxBytes)} bytes`); chunks.push(next.value) } } finally { reader.releaseLock() }
  const joined = new Uint8Array(bytes); let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}