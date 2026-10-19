export const RESTRICTED_CODE = 11140
const RESTRICTED_TEXT = /account has been restricted due to unusual activity|账号存在异常行为/i

export class WBError extends Error {
  constructor(message, { status = 0, code = 0, restricted = false } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.restricted = restricted
  }
}

export async function call(ctx, method, url, headers, body, timeout = 20000) {
  const res = await ctx.fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await res.text()
  let env = null
  try {
    env = JSON.parse(text)
  } catch {}
  const code = Number.parseInt(env?.code, 10) || 0
  const restricted = code === RESTRICTED_CODE || (res.status === 403 && RESTRICTED_TEXT.test(text))
  if (restricted) throw new WBError("WorkBuddy 风控限制了这个账号（11140）", { status: res.status, code: RESTRICTED_CODE, restricted: true })
  if (!res.ok || code) {
    const said = env?.msg || env?.message || env?.error?.message || (env ? "" : text.replace(/<[^>]*>/g, " ").trim().slice(0, 80)) || res.statusText
    throw new WBError(`HTTP ${res.status}${code ? " code " + code : ""}${said ? " " + said : ""}`, { status: res.status, code })
  }
  return env?.data ?? null
}

export async function soft(fn, fallback) {
  try {
    return await fn()
  } catch (e) {
    if (e?.restricted) throw e
    return typeof fallback === "function" ? fallback(e) : fallback
  }
}
