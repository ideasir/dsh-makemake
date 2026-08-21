/** Same-origin HTTP bridge from the Web result card to the Attachment service. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { IMAGE_ROUTE } from './shared.js'

export { IMAGE_ROUTE } from './shared.js'
const MAX_BODY_BYTES = 4096

/** Dependencies required by the image route. */
export interface ImageRouteDeps {
  readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment>
}

/** Serve one verified durable image reference to a same-origin browser request. */
export async function serveImage(req: IncomingMessage, res: ServerResponse, deps: ImageRouteDeps): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'method-not-allowed')
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return jsonError(res, 415, 'json-required')
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin !== undefined && host !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
    return jsonError(res, 403, 'origin-rejected')
  }
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return jsonError(res, 400, 'invalid-request')
  }
  const attachment = attachmentFromRequest(body)
  if (attachment === undefined) return jsonError(res, 400, 'invalid-attachment')
  try {
    const stored = await deps.readImage(attachment)
    res.writeHead(200, {
      'content-type': stored.ref.mediaType,
      'content-length': String(stored.data.byteLength),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(stored.data)
  } catch {
    jsonError(res, 404, 'image-unavailable')
  }
}

/** Validate the persisted reference carried by a tool presentation. */
export function imageAttachmentFromMeta(meta: unknown): ImageAttachmentRef | undefined {
  const value = record(meta)
  if (value?.kind !== 'dsh-makemake') return undefined
  return imageAttachment(value.attachment)
}

function attachmentFromRequest(value: unknown): ImageAttachmentRef | undefined {
  return imageAttachment(record(value)?.attachment)
}

function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  const ref = record(value)
  if (ref === undefined) return undefined
  if (typeof ref.attachmentId !== 'string' || !mediaType(ref.mediaType) || typeof ref.bytes !== 'number' || typeof ref.width !== 'number' || typeof ref.height !== 'number') return undefined
  if (ref.name !== undefined && typeof ref.name !== 'string') return undefined
  return ref as unknown as ImageAttachmentRef
}

function mediaType(value: unknown): value is ImageAttachmentRef['mediaType'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY_BYTES) throw new Error('request too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function jsonError(res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: code }))
}