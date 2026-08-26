/**
 * 迭代计数 —— 按「图的血缘」记录，而不是按「会话/调用」记录。
 *
 * 设计要点：
 * 1. 迭代号是「图」的属性：某张图的迭代号 = 它是从原始基线图出发被改到第几代。
 * 2. 血缘用「参考图字节的内容哈希」识别。生成一张新图时，用「该图落盘后的字节哈希」
 *    （即附件 ID 的内容寻址哈希）登记，这样下次把这张图当作参考图继续改时，
 *    参考图解析读到的字节哈希能命中同一血缘，正确算出「+1」。
 * 3. 注册表持久化到磁盘（默认 DSH_HOME/plugins/dsh-makemake/iterations.json），
 *    与进程死活、会话、渠道都无关 —— 插件重启、切渠道、失败重试都不会丢。
 * 4. 只有「真正成功产出一张新图并成为该血缘的一环」才推进迭代号（成功后才写入）。
 *
 * 局限：指纹方案要求「参考图字节 === 落盘字节」。DSH attachment 存储会重编码/规范化
 * 图片，所以我们登记的是落盘字节哈希（attachmentId），而不是 API 返回的原始字节哈希；
 * 只要用户引用的是这张图落盘后（屏幕上/下载到的）的字节，就能命中。仅当参考图被
 * 进一步重新编码（像素变化）时，才会被当作新血缘、迭代归 1。更进一步的感知哈希
 * 可作为后续增强。
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** 一张图在其血缘里的位置。 */
export interface IterationInfo {
  iteration: number
  lineage: string
}

/** 计算下一个迭代号时要用的计划值（生成成功后才登记到注册表）。 */
export interface PlannedIteration {
  iteration: number
  lineage: string
  /** 参考图内容哈希（文生图没有参考图，为 null）。 */
  refHash: string | null
}

/** 计算字节内容的 SHA-256 十六进制哈希，作为血缘的稳定标识。 */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 生成本地随机 lineage id（32 字节 hex 截断）。 */
export function newLineageId(): string {
  return createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 32)
}

/** 迭代注册表默认落盘位置。 */
export function defaultIterationPath(dshHome: string): string {
  return path.join(dshHome, 'plugins', 'dsh-makemake', 'iterations.json')
}

/**
 * 血缘迭代注册表：contentHash -> IterationInfo。
 * 惰性加载 + 成功后持久化；用 Promise 链做写入串行化，避免并发覆盖。
 */
export class IterationRegistry {
  private readonly filePath: string
  private readonly maxEntries: number
  private readonly byHash = new Map<string, IterationInfo>()
  /** 视频血缘按生成 URL 记录；视频延续按钮会再次提交该 URL。 */
  private readonly byVideoUrl = new Map<string, IterationInfo>()
  /** 视频引用简码：`视频N` -> 视频 URL（引用按钮只插短码，模型凭它定位视频）。 */
  private readonly byVideoCode = new Map<string, string>()
  /** 下一个视频简码序号（单调递增，持久化，避免跨会话/重启混淆）。 */
  private nextVideoCodeNum = 1
  private loaded = false
  private readonly loadPromise: Promise<void>
  private writeChain: Promise<void> = Promise.resolve()

  /**
   * @param filePath 注册表落盘位置
   * @param maxEntries 最多保留的血缘条目数；超过时按插入序淘汰最旧（防止文件无限膨胀）。
   *   0 表示不设上限。默认 5000（每条约 100 字节，约几百 KB）。
   */
  constructor(filePath: string, maxEntries = 5000) {
    this.filePath = filePath
    this.maxEntries = maxEntries
    // 惰性加载：把「首次读盘」缓存成单个 Promise，并发调用共享同一次加载，
    // 避免竞态导致第二个调用读到未填充完成的空注册表。
    this.loadPromise = this.doLoad()
  }

  private async doLoad(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const data = JSON.parse(raw) as { images?: Record<string, { iteration?: number; lineage?: string }>; videos?: Record<string, { iteration?: number; lineage?: string }>; videoCodes?: Record<string, string>; nextVideoCodeNum?: number }
      const images = data.images ?? {}
      for (const [hash, val] of Object.entries(images)) {
        if (val && typeof val.iteration === 'number') {
          this.byHash.set(hash, { iteration: val.iteration, lineage: val.lineage ?? '' })
        }
      }
      const videos = data.videos ?? {}
      for (const [url, val] of Object.entries(videos)) {
        if (val && typeof val.iteration === 'number') {
          this.byVideoUrl.set(url, { iteration: val.iteration, lineage: val.lineage ?? '' })
        }
      }
      const videoCodes = data.videoCodes ?? {}
      for (const [code, url] of Object.entries(videoCodes)) {
        if (typeof url === 'string' && code) this.byVideoCode.set(code, url)
      }
      if (typeof data.nextVideoCodeNum === 'number' && data.nextVideoCodeNum >= 1) {
        this.nextVideoCodeNum = data.nextVideoCodeNum
      }
      // 载入也执行容量淘汰：若磁盘文件是更高上限写的（或上限下调），
      // 立即剪到当前容量，避免 persist() 把超量条目全量写回。
      this.trimToCapacity()
    } catch {
      // 首次运行 / 文件损坏：从空开始。
    } finally {
      this.loaded = true
    }
  }

  /** 幂等加载并等待完成：首次真正读盘，后续复用同一 Promise。 */
  async load(): Promise<void> {
    await this.loadPromise
  }

  lookup(hash: string): IterationInfo | undefined {
    return this.byHash.get(hash)
  }

  set(hash: string, val: IterationInfo): void {
    this.byHash.set(hash, val)
    this.trimToCapacity()
  }

  /** 防膨胀：超过上限时按插入顺序淘汰最旧条目（0 = 不设上限）。 */
  private trimToCapacity(): void {
    if (this.maxEntries <= 0) return
    while (this.byHash.size + this.byVideoUrl.size > this.maxEntries) {
      // 优先淘汰最旧的图条目；若图为空则淘汰最旧的视频条目。
      const oldestImage = this.byHash.keys().next().value
      if (oldestImage !== undefined) {
        this.byHash.delete(oldestImage)
        continue
      }
      const oldestVideo = this.byVideoUrl.keys().next().value
      if (oldestVideo === undefined) break
      this.byVideoUrl.delete(oldestVideo)
    }
  }

  /** 视频血缘：按生成 URL 查询。 */
  lookupVideo(url: string): IterationInfo | undefined {
    return this.byVideoUrl.get(url)
  }

  /** 视频血缘：登记（生成成功后才写入）。 */
  setVideo(url: string, val: IterationInfo): void {
    this.byVideoUrl.set(url, val)
    this.trimToCapacity()
  }

  /** 为视频分配一个唯一引用简码（`视频N`，单调递增）。重复为同一 URL 登记时返回已有简码。 */
  registerVideoCode(url: string): string {
    // 已登记 → 直接复用，避免同 URL 重复分配。
    for (const [code, u] of this.byVideoCode) if (u === url) return code
    const code = `视频${this.nextVideoCodeNum}`
    this.nextVideoCodeNum++
    this.byVideoCode.set(code, url)
    return code
  }

  /** 按引用简码查视频 URL；未命中返回 undefined。 */
  lookupVideoCode(code: string): string | undefined {
    return this.byVideoCode.get(code.trim())
  }

  /** 返回同一视频血缘内已登记的最大迭代号；无则 -1。 */
  maxVideoIterationInLineage(lineage: string): number {
    let max = -1
    for (const info of this.byVideoUrl.values()) {
      if (info.lineage === lineage && info.iteration > max) max = info.iteration
    }
    return max
  }

  /** 返回同一血缘内已登记的最大迭代号；无该血缘条目时返回 -1。 */
  maxIterationInLineage(lineage: string): number {
    let max = -1
    for (const info of this.byHash.values()) {
      if (info.lineage === lineage && info.iteration > max) max = info.iteration
    }
    return max
  }

  /** 串行化落盘：同一时刻只允许一个写任务。 */
  persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const images: Record<string, IterationInfo> = {}
      for (const [hash, val] of this.byHash) images[hash] = val
      const videos: Record<string, IterationInfo> = {}
      for (const [url, val] of this.byVideoUrl) videos[url] = val
      const videoCodes: Record<string, string> = {}
      for (const [code, url] of this.byVideoCode) videoCodes[code] = url
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify({ images, videos, videoCodes, nextVideoCodeNum: this.nextVideoCodeNum }, null, 2), 'utf8')
    })
    return this.writeChain
  }
}

/**
 * 根据参考图字节，计算「下一个迭代号」应取的值。
 *
 * 计数规则（继续递增，而非相对参考图）：
 * - 命中了某个已知血缘 → 取「该血缘内当前最大迭代号 + 1」。
 *   即使这次是从血缘里的旧图分叉，计数也接着往上加，不会回退到参考图自身的迭代号 + 1。
 *   例如同一血缘已有 迭代 0/1/2/3，此时用其中的 迭代 0 那张图当参考，新图应为 迭代 4。
 * - 未命中（全新参考图/文生图走的独立血缘）→ 作为新血缘第一条派生，iteration = 1，新建 lineage。
 */
export function nextIteration(registry: IterationRegistry, refBytes: Uint8Array): PlannedIteration {
  const refHash = contentHash(refBytes)
  const prev = registry.lookup(refHash)
  // 未命中：参考图不在任何已登记血缘 → 新建血缘，从 1 开始。
  if (!prev) return { iteration: 1, lineage: newLineageId(), refHash }
  // 命中：继承参考图的 lineage，但迭代号用「血缘内最大值 + 1」，保证单调递增。
  const maxIter = registry.maxIterationInLineage(prev.lineage)
  return { iteration: Math.max(maxIter + 1, prev.iteration + 1), lineage: prev.lineage, refHash }
}

/**
 * 视频延续的迭代计数：按「上一段视频的 URL」识别血缘。
 * - 命中了某条已登记的视频血缘 → 取该血缘内最大迭代号 + 1。
 * - 未命中 → 作为新血缘第一条派生，iteration = 1。
 */
export function nextVideoIteration(registry: IterationRegistry, videoUrl: string): PlannedIteration {
  const url = (videoUrl ?? '').trim()
  const prev = url ? registry.lookupVideo(url) : undefined
  if (!prev) return { iteration: 1, lineage: newLineageId(), refHash: null }
  const maxIter = registry.maxVideoIterationInLineage(prev.lineage)
  return { iteration: Math.max(maxIter + 1, prev.iteration + 1), lineage: prev.lineage, refHash: null }
}