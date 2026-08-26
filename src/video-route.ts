/**
 * Same-origin HTTP bridge so the video card can fetch a generated video's bytes
 * and paste them into the composer as a file attachment.
 *
 * Generated videos live on a remote COS bucket whose responses carry no
 * Access-Control-Allow-Origin header, so a browser `fetch(videoUrl)` is
 * blocked by CORS. Proxying the bytes through this same-origin route lets the
 * card fetch them, build a `video/mp4` File, and dispatch a paste event — the
 * same path the image card already uses.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

/** Only allow proxying the exact bucket the plugin generates videos from. */
const ALLOWED_HOST = 'cos-platform-outputs.agnes-ai.cn'

/** Directory where referenced videos are persisted as `[f:xxx]` files. */
const UPLOAD_DIR = '/root/DSH/.uploads'

/** In-memory cache: url -> bytes, so repeated references don't re-download. */
const cache = new Map<string, { bytes: Buffer; mediaType: string }>()

/** Download a generated-video URL (server-side, no CORS) and persist it to .uploads. */
async function persistVideo(src: string): Promise<string> {
  const parsed = new URL(src)
  if (parsed.hostname !== ALLOWED_HOST || !/\.mp4$/i.test(parsed.pathname)) {
    throw new Error('origin-rejected')
  }
  const up = await fetch(parsed.toString())
  if (!up.ok) throw new Error('upstream-failed')
  const buf = Buffer.from(await up.arrayBuffer())
  const name = `video_${crypto.createHash('sha1').update(parsed.toString()).digest('hex').slice(0, 12)}.mp4`
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf)
  return name
}

/** Persist a generated video to .uploads/ and return its `[f:file]` reference tag. */
export async function serveVideoRef(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const src = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('url') ?? ''
  if (!src) {
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'missing-url' })); return
  }
  try {
    const name = await persistVideo(src)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ file: name, ref: `[f:${name}]` }))
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'persist-failed' }))
  }
}

export async function serveVideoProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const src = url.searchParams.get('url')
  if (!src) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing-url' }))
    return
  }
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'bad-url' }))
    return
  }
  // 仅允许代理本插件生成视频所用 COS bucket 的 mp4，避免成为开放代理。
  if (parsed.hostname !== ALLOWED_HOST || !/\.mp4$/i.test(parsed.pathname)) {
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'origin-rejected' }))
    return
  }
  try {
    let entry = cache.get(parsed.toString())
    if (!entry) {
      const up = await fetch(parsed.toString())
      if (!up.ok) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'upstream-failed' }))
        return
      }
      const mediaType = (up.headers.get('content-type') ?? 'video/mp4').split(';')[0]?.trim() || 'video/mp4'
      const bytes = Buffer.from(await up.arrayBuffer())
      cache.set(parsed.toString(), { bytes, mediaType })
      if (cache.size > 64) cache.delete(cache.keys().next().value!) // 简单上限
      entry = { bytes, mediaType }
    }
    res.writeHead(200, {
      'content-type': entry.mediaType,
      'content-length': String(entry.bytes.byteLength),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    })
    res.end(entry.bytes)
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'upstream-failed' }))
  }
}
