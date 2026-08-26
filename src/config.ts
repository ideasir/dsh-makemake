/** User-facing configuration — multi-channel support.
 * The backend uses OpenAI-compatible protocol (the most universal format). */
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  enabled?: boolean
  imageChannels?: Array<{
    id: string
    name: string
    baseURL: string
    model: string
  }>
  videoChannels?: Array<{
    id: string
    name: string
    baseURL: string
    model: string
  }>
  selectedImageChannel?: string
  selectedVideoChannel?: string
  /** 用户当前激活的生成模式（点工具栏图标切换）：'image' | 'video' | null */
  activeMode?: 'image' | 'video' | null
}

const channelSchema = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  baseURL: Schema.string().required(),
  model: Schema.string().required(),
  adapt: Schema.any(),
})

/** Cordis configuration schema — must match all fields written by the client. */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  imageChannels: Schema.array(channelSchema).default([]),
  videoChannels: Schema.array(channelSchema).default([]),
  selectedImageChannel: Schema.string().default(''),
  selectedVideoChannel: Schema.string().default(''),
  activeMode: Schema.any(),
})