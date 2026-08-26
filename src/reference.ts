/**
 * 参考图解析与规范化。
 * 图片、视频两个工具共用同一套「输入图 → 字节 + MIME → data URL」逻辑，
 * 统一在这里实现，消除之前散落在两个 execute 里重复的解析代码。
 *
 * 说明：不使用「把任意 http URL 重写到本机硬编码端口」的旧设计——那既绑死端口，
 * 又会破坏真正的外部图片 URL。这里按表单意义直接解析：
 *   附件 ID（attachmentId=sha256:...）→ 读本机 attachments 文件；
 *   其他 http(s) URL → 按原样下载（支持外部图片）；
 *   data URL → 解码；本地路径 / 裸文件名 → 走 DSH 上传目录兜底。
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** 支持的图片 MIME 类型。 */
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type ImageMime = (typeof IMAGE_MIME)[number]

const DEFAULT_MIME: ImageMime = 'image/png'
/** 本地裸文件名兜底候选目录。 */
const UPLOAD_DIRS = ['/root/DSH/.uploads', '.uploads', 'uploads']

function isImageMime(mime: string): mime is ImageMime {
  return IMAGE_MIME.includes(mime as ImageMime)
}

/** 参考图解析结果。 */
export interface ReferenceBytes {
  bytes: Uint8Array
  mime: ImageMime
}

/**
 * 解析参考图 → 字节 + MIME。
 * 依次支持：附件 ID（attachmentId=sha256:...）、http(s) URL、data URL、本地路径/裸文件名。
 * 调用方无需再重复写这些分支。
 *
 * @param image 参考图（attachmentId / http URL / data URL / 本地路径 / 裸文件名）
 * @param deps  依赖环境
 */
export async function resolveReferenceBytes(
  image: string,
  deps: { dshHome: string; signal?: AbortSignal },
): Promise<ReferenceBytes> {
  const src = image.trim()

  // 1) 附件 ID：attachmentId=sha256:xxx（可带完整 URL，只要是图片路由引用）→ 读 DSH attachments 文件
  const am = src.match(/attachmentId=(sha256:[0-9a-f]+)/)
  if (am?.[1]) {
    const hash = am[1].replace(/^sha256:/, '')
    const fp = path.join(deps.dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
    const bytes = new Uint8Array(await fs.readFile(fp))
    return { bytes, mime: DEFAULT_MIME }
  }

  // 2) http(s) URL → 按原样下载 → 字节，MIME 取响应 content-type
  if (/^https?:\/\//.test(src)) {
    const init: RequestInit = { redirect: 'follow' }
    if (deps.signal !== undefined) init.signal = deps.signal
    const r = await fetch(src, init)
    if (!r.ok) throw new Error(`参考图读取失败（HTTP ${r.status}）`)
    const bytes = new Uint8Array(await r.arrayBuffer())
    const ct = (r.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    return { bytes, mime: isImageMime(ct) ? ct : DEFAULT_MIME }
  }

  // 3) data URL：data:image/...;base64,...
  const dataMatch = src.match(/^data:([^;,]+);base64,(.+)$/)
  if (dataMatch) {
    const mime = dataMatch[1]!.toLowerCase()
    const bytes = new Uint8Array(Buffer.from(dataMatch[2]!, 'base64'))
    return { bytes, mime: isImageMime(mime) ? mime : DEFAULT_MIME }
  }

  // 4) 本地路径 / 裸文件名（DSH 上传目录兜底）
  const candidates = [
    src,
    ...UPLOAD_DIRS.map(dir => path.join(dir.startsWith('/') ? '' : deps.dshHome, dir, src)),
  ]
  let lastErr: unknown = null
  for (const cand of candidates) {
    try {
      const bytes = new Uint8Array(await fs.readFile(cand))
      return { bytes, mime: DEFAULT_MIME }
    } catch (e) {
      lastErr = e
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error('找不到图片文件'))
}

/** 字节 + MIME → data URL。 */
export function toDataUrl(bytes: Uint8Array, mime: string = DEFAULT_MIME): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}