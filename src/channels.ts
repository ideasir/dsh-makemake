/**
 * 渠道 & API Key 管理。
 * 集中处理：渠道凭据引用名、目标渠道解析、多 Key 轮询池与冷却。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** 渠道配置。 */
export interface Channel {
  id: string
  name: string
  baseURL: string
  model: string
  /** 适配结果：检测时自动写入，生成时直接用 */
  adapt?: {
    imageEndpoint?: string
    videoEndpoint?: string
    videoPollPath?: string
    videoPollMethod?: 'GET' | 'POST'
    submitBody?: Record<string, unknown>
    taskIdField?: string
    videoUrlField?: string
    statusField?: string
    doneValues?: string[]
    i2vMode?: string
    i2vImageField?: string
    i2vImageFormat?: 'raw_b64' | 'data_url' | 'url'
  }
}

/** 运行时设置快照（插件的 scope 值）。 */
export interface RuntimeSettings {
  imageChannels?: Channel[]
  videoChannels?: Channel[]
  selectedImageChannel?: string
  selectedVideoChannel?: string
  activeMode?: 'image' | 'video' | null
  enabled?: boolean
}

/** 生成某个渠道的凭据引用名（与客户端逻辑一致）。 */
export function channelCredentialRef(channelId: string): string {
  return `MAKEMAKE_CHANNEL_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * 解析本次调用要用的目标渠道。
 * - 若传了 channelArg（/渠道名），优先按名称匹配；
 * - 否则回退到「当前选中的渠道」，再回退到渠道列表第一个。
 * type: 'image' | 'video'。
 */
export function resolveTargetChannel(
  settings: RuntimeSettings,
  type: 'image' | 'video',
  channelArg: string | undefined,
): Channel | undefined {
  const channels = type === 'image' ? settings.imageChannels : settings.videoChannels
  if (!Array.isArray(channels) || channels.length === 0) return undefined
  const arg = (channelArg ?? '').trim()
  if (arg) {
    const byName = channels.find((c: Channel) => c.name === arg || `${c.name}`.includes(arg))
    if (byName) return byName
  }
  const selectedId = type === 'image' ? settings.selectedImageChannel : settings.selectedVideoChannel
  return channels.find((c: Channel) => c.id === selectedId) ?? channels[0]
}

/** 多 Key 轮询池：round-robin + 429/繁忙自动冷却跳过。 */
export class KeyPool {
  private keys: string[] = []
  private idx = 0
  /** 当前被限流的 Key（429）—— 时间戳未过则跳过。 */
  private cooldown = new Map<string, number>()

  constructor(raw: string) {
    // 拆分：支持换行、逗号、分号、空格、字面 \n 分隔；去重、去空。
    const normalized = raw.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    const parts = normalized.split(/[\n\r,;\s]+/).map(s => s.trim()).filter(s => s.length > 0)
    this.keys = [...new Set(parts)]
  }

  get size(): number { return this.keys.length }

  /** 取下一个可用 Key；全部在冷却中则返回 null。 */
  next(): string | null {
    if (this.keys.length === 0) return null
    const now = Date.now()
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.idx + i) % this.keys.length]!
      if (!k) continue
      const until = this.cooldown.get(k) ?? 0
      if (now >= until) {
        this.idx = (this.idx + i + 1) % this.keys.length
        return k
      }
    }
    return null
  }

  /** 将某个 Key 放入冷却；成功提交视频和限流失败都走同一套冷却表。 */
  cooldownKey(key: string, ms = 60_000): void {
    this.cooldown.set(key, Date.now() + ms)
  }

  /** 标记某个 Key 失败（429 / 繁忙），冷却一段时间。 */
  fail(key: string, ms = 60_000): void {
    this.cooldownKey(key, ms)
  }

  /** 视频任务成功提交后冷却该 Key，避免下一任务再次撞上单 Key 限额。 */
  succeedVideo(key: string, ms = 60_000): void {
    this.cooldownKey(key, ms)
  }
}

/** 每个渠道持久化一个 KeyPool（按渠道 id 缓存）。 */
const keyPools = new Map<string, { raw: string; pool: KeyPool }>()

/**
 * 取（或创建）某渠道的 KeyPool。
 * 若渠道凭据（raw）发生变化，自动用新 raw 重建池，免去为「改 key」而重启。
 */
export function getKeyPool(channelId: string, raw: string): KeyPool {
  const entry = keyPools.get(channelId)
  if (!entry || entry.raw !== raw) {
    const pool = new KeyPool(raw)
    keyPools.set(channelId, { raw, pool })
    return pool
  }
  return entry.pool
}