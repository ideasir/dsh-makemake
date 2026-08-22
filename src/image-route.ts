/** Same-origin HTTP bridge from the Web result card to the Attachment service. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'

export { IMAGE_ROUTE } from './shared.js'
const MAX_BODY_BYTES = 4096

/** Dependencies required by the image route. */
export interface ImageRouteDeps {
  readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment>
}

/** Serve one verified durable image reference to a same-origin browser request. */
export async function serveImage(req: IncomingMessage, res: ServerResponse, deps: ImageRouteDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const attachmentId = url.searchParams.get('attachmentId')
  if (!attachmentId) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing-attachment-id' }))
    return
  }
  const attachment: ImageAttachmentRef = { attachmentId, mediaType: 'image/png', bytes: 0, width: 0, height: 0 }
  try {
    const stored = await deps.readImage(attachment)
    res.writeHead(200, {
      'content-type': stored.ref.mediaType,
      'content-length': String(stored.data.byteLength),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    })
    res.end(stored.data)
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'image-unavailable' }))
  }
}