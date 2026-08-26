/**
 * 视频 → 最后一帧提取。
 *
 * 用途：把「上一段生成好的视频」延续下去 —— 取它的最后一帧作为下一段的起始帧，
 * 实现画面无缝衔接（这两个模型的「视频生视频」只能用这种方式落地，因为
 * agnes-video-v2.0 与 agnes-video-2.5-flash 都不接受 videos 输入）。
 *
 * 输入源与 reference.ts 保持一致：附件 ID（attachmentId=）、http(s) URL、
 * data URL（data:video/...）、本地路径 / 裸文件名。
 *
 * 实现：把源视频落到本地临时文件 → ffmpeg 用 -sseof 取末帧 → PNG 字节。
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 视频来源解析结果：统一落到本地临时文件。 */
interface LocalVideo {
  filePath: string
  tempDir: string
}

const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'] as const

/** 本地裸文件名兜底候选目录。 */
const UPLOAD_DIRS = ['/root/DSH/.uploads', '.uploads', 'uploads']

/**
 * 把「视频源」解析成本地临时文件。
 * @param src 视频源（attachmentId / http URL / data URL / 本地路径 / 裸文件名）
 * @param deps 依赖（dshHome）
 */
async function resolveToLocal(src: string, deps: { dshHome: string }): Promise<LocalVideo> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mm-video-'))
  const filePath = path.join(tempDir, 'input.mp4')
  // 0) `[f:文件名]` 会话文件标签 → 按裸文件名在上传目录解析（DSH 引用约定）。
  const ref = src.trim().match(/^\[f:(.+)\]$/)
  const original = ref ? ref[1]!.trim() : src.trim()

  // 1) 附件 ID（attachmentId=sha256:xxx）→ 读 DSH attachments 文件
  const am = original.match(/attachmentId=(sha256:[0-9a-f]+)/)
  if (am?.[1]) {
    const hash = am[1].replace(/^sha256:/, '')
    const fp = path.join(deps.dshHome, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
    await fs.copyFile(fp, filePath)
    return { filePath, tempDir }
  }

  // 2) http(s) URL → 下载
  if (/^https?:\/\//.test(original)) {
    const r = await fetch(original, { redirect: 'follow' })
    if (!r.ok) throw new Error(`参考视频读取失败（HTTP ${r.status}）`)
    const buf = Buffer.from(await r.arrayBuffer())
    await fs.writeFile(filePath, buf)
    return { filePath, tempDir }
  }

  // 3) data URL：data:video/...;base64,...
  const dataMatch = original.match(/^data:([^;,]+);base64,(.+)$/)
  if (dataMatch) {
    const buf = Buffer.from(dataMatch[2]!, 'base64')
    await fs.writeFile(filePath, buf)
    return { filePath, tempDir }
  }

  // 4) 本地路径 / 裸文件名（DSH 上传目录兜底）
  const candidates = [
    original,
    ...UPLOAD_DIRS.map(dir => path.join(dir.startsWith('/') ? '' : deps.dshHome, dir, original)),
  ]
  let lastErr: unknown = null
  for (const cand of candidates) {
    try {
      await fs.copyFile(cand, filePath)
      return { filePath, tempDir }
    } catch (e) {
      lastErr = e
    }
  }
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  throw (lastErr instanceof Error ? lastErr : new Error('找不到视频文件'))
}

/** 用 ffmpeg 取视频最后一帧为 PNG 字节。 */
async function extractLastFrame(videoPath: string): Promise<Uint8Array> {
  const outPng = path.join(path.dirname(videoPath), 'last-frame.png')
  // 先尝试「对齐到文件末尾约 0.1 秒处取 1 帧」；失败再退化为「取最后/首帧」兜底
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-sseof', '-0.1', '-i', videoPath,
      '-frames:v', '1', '-update', '1', '-f', 'image2', outPng,
    ], { timeout: 60_000 })
  } catch {
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vf', 'select=eq(n\\,1)', '-frames:v', '1', '-update', '1', '-f', 'image2', outPng,
    ], { timeout: 60_000 })
  }
  const bytes = new Uint8Array(await fs.readFile(outPng))
  return bytes
}

/** 视频取末帧结果。 */
export interface VideoFrameResult {
  /** PNG 字节。 */
  bytes: Uint8Array
  mime: 'image/png'
}

/**
 * 解析视频源并提取最后一帧为 PNG 字节。
 * 调用方负责清理临时目录（返回 cleanup）。
 */
export async function resolveVideoLastFrame(
  src: string,
  deps: { dshHome: string },
): Promise<{ bytes: Uint8Array; mime: 'image/png'; cleanup: () => Promise<void> }> {
  const local = await resolveToLocal(src, deps)
  const bytes = await extractLastFrame(local.filePath)
  const cleanup = async () => {
    await fs.rm(local.tempDir, { recursive: true, force: true }).catch(() => {})
  }
  return { bytes, mime: 'image/png', cleanup }
}

/** 视频源是否看起来是「视频」输入（用于工具按输入类型走模式）。 */
export function isVideoLike(src: string): boolean {
  const s = src.trim()
  return /^data:video\//.test(s) || /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(s)
}

/** 视频字节 → data URL（兜底用）。 */
export function videoDataUrl(bytes: Uint8Array, mime = 'video/mp4'): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

export { VIDEO_MIME }
