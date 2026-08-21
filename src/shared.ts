/** Values shared by the Host and browser Bundle faces. */

/** Browser route used by the generated-image card. */
export const IMAGE_ROUTE = '/plugins/dsh-makemake/image'

/** Namespace persisted through DSH Settings. */
export const CREATION_NAMESPACE = 'creation'

/** Supported providers. */
export const IMAGE_PROVIDERS = ['google', 'openai', 'seedream'] as const
export type ImageProvider = typeof IMAGE_PROVIDERS[number]

/** Default endpoints and base URLs. */
export const DEFAULT_GOOGLE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_SEEDREAM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** Default model names. */
export const DEFAULT_GOOGLE_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_OPENAI_MODEL = 'gpt-image-2'
export const DEFAULT_SEEDREAM_MODEL = 'doubao-seedream-5-0-260128'

export const DEFAULT_MODELS: Record<ImageProvider, string> = {
  google: DEFAULT_GOOGLE_MODEL,
  openai: DEFAULT_OPENAI_MODEL,
  seedream: DEFAULT_SEEDREAM_MODEL,
}

export const DEFAULT_BASE_URLS: Record<ImageProvider, string> = {
  google: DEFAULT_GOOGLE_ENDPOINT,
  openai: DEFAULT_OPENAI_BASE_URL,
  seedream: DEFAULT_SEEDREAM_BASE_URL,
}