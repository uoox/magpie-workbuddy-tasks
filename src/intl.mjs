import { call } from "./http.mjs"
import { dayOf, short } from "./util.mjs"

export const INTL = { origin: "https://www.workbuddy.ai" }
export const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
export const MODEL = "deepseek-v4.1-flash"
const CONVERSATIONS = INTL.origin + "/console/as/conversations/"

export function webHeaders(a) {
  return {
    Authorization: "Bearer " + a.access,
    "X-User-Id": a.uid ?? "",
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    Origin: INTL.origin,
    Referer: INTL.origin + "/app",
    "User-Agent": UA_EDGE,
  }
}

export async function openAcp(ctx, link, token) {
  const ctl = new AbortController()
  const res = await ctx.fetch(link, {
    method: "GET",
    headers: { Accept: "text/event-stream", Authorization: "Bearer " + token, "User-Agent": UA_EDGE },
    signal: ctl.signal,
  })
  if (res.status !== 200) {
    ctl.abort()
    throw new Error(`沙箱 SSE 通道返回 HTTP ${res.status}`)
  }
  const cid = res.headers.get("Acp-Connection-Id")
  if (!cid) {
    ctl.abort()
    throw new Error("沙箱 SSE 通道没有返回 Acp-Connection-Id")
  }
  let chunks = 0
  const pump = (async () => {
    const reader = res.body?.getReader()
    if (!reader) return
    const dec = new TextDecoder()
    let buf = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith("data:")) continue
        try {
          const m = JSON.parse(line.slice(5).trim())
          if (m?.method === "session/update" && m.params?.update?.sessionUpdate === "agent_message_chunk") chunks++
        } catch {}
      }
    }
  })().catch(() => {})
  return {
    async rpc(method, params, id) {
      const r = await ctx.fetch(link, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Acp-Connection-Id": cid,
          Authorization: "Bearer " + token,
          "User-Agent": UA_EDGE,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(30000),
      })
      await r.text().catch(() => "")
      if (r.status !== 200 && r.status !== 202) throw new Error(`${method} 返回 HTTP ${r.status}`)
    },
    chunks: () => chunks,
    async close() {
      ctl.abort()
      await pump
    },
  }
}

export async function dailyActive(ctx, a, { model = MODEL, prompt = "Hi", poll = 3000, reserve = 3000 } = {}) {
  const conv = await call(ctx, "POST", CONVERSATIONS, webHeaders(a), {
    prompt,
    model,
    conversationOrigin: "workbuddy-app",
    plugins: [{ name: "weixinpay", marketplace: "codebuddy-builtin" }],
  }, 30000)
  const id = conv?.id
  if (!id) throw new Error("建会话没有返回会话 id")
  const url = CONVERSATIONS + encodeURIComponent(String(id))
  const s = (await call(ctx, "GET", url + "/session", webHeaders(a), undefined, 30000)) ?? {}
  const link = s.link || s.endpoint || ""
  const token = s.token || ""
  if (!link || !token) throw new Error("云端沙箱还没就绪（没有 link/token）")
  const sessionId = s.sessionId || s.session_id || id
  const acp = await openAcp(ctx, link, token)
  try {
    await acp.rpc("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, 1)
    await acp.rpc("session/load", { sessionId, cwd: s.cwd || "/workspace", mcpServers: [] }, 2)
    await acp.rpc("session/set_model", { sessionId, modelId: model }, 3).catch(() => {})
    await acp.rpc("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] }, 4)
    let status = ""
    while (ctx.left() > reserve) {
      status = String((await call(ctx, "GET", url, webHeaders(a), undefined, 30000).catch((e) => (e?.restricted ? Promise.reject(e) : null)))?.status ?? status)
      if (status === "completed") return { conversation: id, chunks: acp.chunks() }
      if (status === "failed" || status === "error") throw new Error(`会话状态 ${status}`)
      await ctx.sleep(poll)
    }
    throw new Error(`会话没在时限内跑完（状态 ${status || "未知"}）`)
  } finally {
    await acp.close()
  }
}

export async function runIntl(ctx, a, { option = () => true, rec = {}, day = dayOf(ctx.now()) } = {}) {
  if (!option("daily-active")) return { outcome: "ineligible", message: "国际版每日活跃已在插件选项里关掉" }
  if (rec.restricted === day) return { outcome: "ineligible", message: "今天已遇到 11140 风控，不再碰这个账号" }
  if (rec.intl === day) return { outcome: "done", message: "今天的每日活跃会话已跑完" }
  try {
    const r = await dailyActive(ctx, a)
    rec.intl = day
    return { outcome: "claimed", message: `每日活跃会话已跑完（${r.chunks} 段输出），30/50 积分包由 WorkBuddy 稍后发放` }
  } catch (e) {
    if (e?.restricted) {
      rec.restricted = day
      return { outcome: "ineligible", message: "WorkBuddy 以 11140 风控限制了这个账号，今天不再碰它；需在 WorkBuddy 里提交反馈申诉" }
    }
    return { outcome: "failed", message: `每日活跃会话失败：${short(e)}` }
  }
}
