/**
 * HTTP / 上游服务错误的人类可读归类。
 */

/** 把 HTTP 状态码/错误文本归类为人类可读的错误类型，方便快速定位。 */
export function classifyError(status: number | undefined, text: string): string {
  const upper = (text ?? '').toUpperCase()
  if (status === 401 || /UNAUTHORIZED|INVALID.*KEY|API_KEY|AUTHENTICATION|403/.test(upper)) {
    return 'API Key 无效或已过期（检查渠道配置的 Key 是否正确）'
  }
  if (status === 429 || /RATE.?LIMIT|TOO MANY|QUOTA|LIMIT/.test(upper)) {
    return '请求过于频繁（触发限流/配额，稍后重试或换一个 Key）'
  }
  if (status === 404 || /NOT FOUND|NO SUCH|ENDPOINT/.test(upper)) {
    return '端点不存在（检查接口地址 baseURL 与模型名是否匹配）'
  }
  if (status === 400 || /BAD REQUEST|INVALID|MISSING|PARAMETER/.test(upper)) {
    return '请求参数错误（检查模型名、尺寸、字段格式是否正确）'
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 || /SERVER ERROR|GATEWAY/.test(upper)) {
    return '上游服务错误/不可用（服务端故障，稍后重试）'
  }
  if (status === 408 || /TIMEOUT|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|NETWORK|FETCH FAILED|UND_ERR/.test(upper)) {
    return '网络连接失败（检查服务器能否访问该接口地址）'
  }
  return `未分类错误（HTTP ${status ?? '无'}）：${text}`.slice(0, 300)
}