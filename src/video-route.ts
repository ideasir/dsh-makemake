/** Same-origin HTTP bridge for serving generated videos. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const VIDEO_ROUTE = '/plugins/dsh-makemake/video'

export interface VideoRouteDeps {
  dshHome: string
}

export async function serveVideo(req: IncomingMessage, res: ServerResponse, deps: VideoRouteDeps): Promise<void> {
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
  const hash = attachmentId.replace(/^sha256:/, '')
  const filePath = path.join(deps.dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
  try {
    const data = await readFile(filePath)
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': String(data.byteLength),
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'video-unavailable' }))
  }
}