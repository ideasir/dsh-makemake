/**
 * 渠道能力探测。
 * /test 和 /check-all 两个路由共用同一套「文生图 / 图生图 / 文生视频 / 图生视频」探测，
 * 在这里收敛，避免两个路由各写一遍 fetch + 结果判断。
 */

/** 1x1 透明 PNG，用于「只探测端点是否存在、不真实生成」的请求。 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const PROBE_TIMEOUT_MS = 8_000

interface ProbeResult {
  ok: boolean
  detail?: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
}

/** 失败的 fetch 统一返回 null；探测失败视为「连接失败」。 */
async function safeFetch(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  } catch {
    return null
  }
}

/** 端点「存在」判定：只有 404 表示端点不存在；400/401/403 说明端点通了（参数或权限问题）。 */
function endpointExists(status: number | undefined): boolean {
  return status !== undefined && status !== 404
}

// ─── 自动探测：模型列表 ─────────────────────────────────────

/** 查询 /v1/models，返回可用模型 id 列表（失败返回空数组）。 */
export async function probeModelsList(base: string, apiKey: string): Promise<string[]> {
  const normalized = (base ?? '').replace(/\/+$/, '')
  // 尝试两种常见路径
  for (const path of ['/v1/models', '/models']) {
    const r = await safeFetch(`${normalized}${path}`, {
      method: 'GET',
      headers: authHeaders(apiKey),
    })
    if (r && r.ok) {
      try {
        const data = await r.json() as { data?: Array<{ id: string }> }
        if (Array.isArray(data?.data)) {
          return data.data.map(m => m.id).filter(Boolean)
        }
      } catch { /* ignore */ }
    }
  }
  return []
}

/** 从模型列表里智能识别出图/出视频候选模型（按关键词匹配）。 */
export function classifyModels(models: string[]): { image: string[]; video: string[] } {
  const imageKeywords = ['image', 'img', 'dall', 'flux', 'sd', 'stable', 'agnes-image', 'vision']
  const videoKeywords = ['video', 'sora', 'runway', 'kling', 'veo', 'agnes-video', 'step-video']
  const image: string[] = []
  const video: string[] = []
  for (const m of models) {
    const lower = m.toLowerCase()
    if (videoKeywords.some(k => lower.includes(k))) video.push(m)
    else if (imageKeywords.some(k => lower.includes(k))) image.push(m)
    // 既不像图也不像视频的不归类（保持干净）
  }
  return { image, video }
}

// ─── 自动探测：Base URL ─────────────────────────────────────

/** 给定一个可能带或不带 /v1 的 base，尝试探测 /v1/models 是否通。 */
async function probeBaseWorking(base: string, apiKey: string): Promise<boolean> {
  const r = await safeFetch(`${base}/v1/models`, {
    method: 'GET',
    headers: authHeaders(apiKey),
  })
  if (r && (r.ok || r.status === 401)) return true // 401=通了但 Key 不对，也算 base 有效
  const r2 = await safeFetch(`${base}/models`, {
    method: 'GET',
    headers: authHeaders(apiKey),
  })
  return !!(r2 && (r2.ok || r2.status === 401))
}

/**
 * 自动探测可用的 base URL：用户填了就用用户填的，没填就从常见候选里找。
 * 返回 { baseURL, discovered } —— discovered 表示是系统自动找到的。
 */
export async function autoDetectBase(
  userBase: string,
  apiKey: string,
): Promise<{ baseURL: string; discovered: boolean }> {
  const normalized = (userBase ?? '').replace(/\/+$/, '').replace(/\/v1$/, '')
  if (normalized) {
    return { baseURL: normalized, discovered: false }
  }
  // 用户没填 → 常见候选列表（按优先级）
  const candidates = [
    'https://api.openai.com',               // OpenAI 官方
    'https://api.agpt.co',                   // 社区聚合
    'https://api.together.xyz',              // Together
    'https://openrouter.ai/api',             // OpenRouter
    'http://127.0.0.1:18080',               // 本机 AxonHub
  ]
  for (const c of candidates) {
    if (await probeBaseWorking(c, apiKey)) {
      return { baseURL: c, discovered: true }
    }
  }
  return { baseURL: '', discovered: false }
}

// ─── 原有能力探测 ────────────────────────────────────────────

/** 文生图端点探测。 */
export async function probeTextToImage(base: string, apiKey: string): Promise<ProbeResult> {
  const r = await safeFetch(`${base}/images/generations`, {
    method: 'POST',
    redirect: 'error',
    headers: authHeaders(apiKey),
    body: JSON.stringify({}),
  })
  if (r === null) return { ok: false, detail: '连接失败' }
  if (r.status === 404) return { ok: false, detail: '端点不存在' }
  // 401 = 端点通了，Key 无效
  if (r.status === 401) return { ok: true, detail: '端点存在（API Key 无效）' }
  return { ok: true, detail: '可用' }
}

/** 图生图格式探测：尝试「顶层 image 字段 / extra_body.image 数组 / /images/edits」三种格式。 */
export async function probeImageToImage(base: string, apiKey: string): Promise<{ ok: boolean; formats: string[] }> {
  const formats: string[] = []
  const probeFormat = async (body: unknown, label: string): Promise<void> => {
    const r = await safeFetch(`${base}/images/generations`, {
      method: 'POST',
      redirect: 'error',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    })
    if (endpointExists(r?.status)) formats.push(label)
  }
  const dataUrl = `data:image/png;base64,${TINY_PNG_BASE64}`
  await probeFormat({ image: dataUrl }, '顶层 image')
  await probeFormat({ extra_body: { image: [dataUrl] } }, 'extra_body.image')
  try {
    const cForm = new FormData()
    cForm.append('image', new Blob([Buffer.from(TINY_PNG_BASE64, 'base64')], { type: 'image/png' }), 'ref.png')
    const r = await safeFetch(`${base}/images/edits`, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}` },
      body: cForm,
    })
    if (endpointExists(r?.status)) formats.push('/images/edits')
  } catch { /* ignore */ }
  return { ok: formats.length > 0, formats }
}

/** 判断是否为 2.5 Flash（其请求/模式与 v2.0 不同）。 */
function isFlash(model: string): boolean {
  return /flash/i.test(model)
}

/** 文生视频端点探测。 */
export async function probeTextToVideo(videoBase: string, apiKey: string, model: string): Promise<ProbeResult> {
  const body = isFlash(model)
    ? { model, prompt: 'test', mode: 'text', seconds: '5', size: '720P', aspect_ratio: '16:9' }
    : { model, prompt: 'test', n: 1 }
  const r = await safeFetch(`${videoBase}/videos`, {
    method: 'POST',
    redirect: 'error',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (r === null) return { ok: false, detail: '连接失败' }
  if (r.status === 401) return { ok: true, detail: '端点存在（API Key 无效）' }
  if (r.status === 404) return { ok: false, detail: '端点不存在' }
  if (r.status === 429) return { ok: true, detail: '可用（触发限流，实际支持）' }
  if (!r.ok) return { ok: false, detail: `请求参数或模型不支持（HTTP ${r.status}）` }
  return { ok: true, detail: '可用' }
}

/** 图生视频 / 关键帧探测。 */
export async function probeImageToVideo(videoBase: string, apiKey: string, model: string): Promise<ProbeResult> {
  // flash 的 first_frame 只接受「裸 base64」；v2.0 的 image 接受「data: 数据 URL」。
  const image = isFlash(model) ? TINY_PNG_BASE64 : `data:image/png;base64,${TINY_PNG_BASE64}`
  const body = isFlash(model)
    ? { model, prompt: 'test', mode: 'keyframe', first_frame: image, seconds: '5', size: '720P', aspect_ratio: '16:9' }
    : { model, prompt: 'test', mode: 'ti2vid', image, n: 1 }
  const r = await safeFetch(`${videoBase}/videos`, {
    method: 'POST',
    redirect: 'error',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (r === null) return { ok: false, detail: '连接失败' }
  if (r.status === 401) return { ok: true, detail: '端点存在（API Key 无效）' }
  if (r.status === 404) return { ok: false, detail: '不支持图生视频' }
  if (!r.ok) return { ok: false, detail: `请求参数或模式不支持（HTTP ${r.status}）` }
  return { ok: true, detail: '可用' }
}

/** 组合探测：图（文生图 + 图生图）。 */
export async function probeImageCapabilities(base: string, apiKey: string): Promise<{
  ok: boolean
  textToImage: ProbeResult
  imageToImage: { ok: boolean; formats: string[] }
}> {
  const textToImage = await probeTextToImage(base, apiKey)
  const imageToImage = await probeImageToImage(base, apiKey)
  return { ok: textToImage.ok, textToImage, imageToImage }
}

/** 标准化视频 base URL：剥掉已有的 /videos 和 /v1 后缀，统一到 /v1。 */
function normalizeVideoBase(base: string): string {
  let b = base.replace(/\/+$/, '')
  // 已含 /videos → 剥掉，后续再拼
  if (b.endsWith('/videos')) b = b.slice(0, -'/videos'.length)
  // 统一到 /v1
  if (b.endsWith('/v1')) return b
  return `${b}/v1`
}

/** 组合探测：视频（文生视频 + 图生视频）。 */
export async function probeVideoCapabilities(base: string, apiKey: string, model: string): Promise<{
  ok: boolean
  textToVideo: ProbeResult
  imageToVideo: ProbeResult
}> {
  const videoBase = normalizeVideoBase(base)
  const textToVideo = await probeTextToVideo(videoBase, apiKey, model)
  const imageToVideo = await probeImageToVideo(videoBase, apiKey, model)
  return { ok: textToVideo.ok || imageToVideo.ok, textToVideo, imageToVideo }
}
