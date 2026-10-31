import { clientHeaders, meterHeaders } from "./client.mjs"
import { call, soft } from "./http.mjs"
import { PROMPTS } from "./prompts.mjs"
import { dayOf, hex, num, short } from "./util.mjs"

export const INTL = { origin: "https://www.workbuddy.ai" }
const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
export const MODEL = "deepseek-v4.1-flash"
const CONVERSATIONS = INTL.origin + "/console/as/conversations/"
export const ACTIVE_LIMIT = 10
const KEEP = 8
const ACTIVE = new Set(["working", "creating", "pending"])
const ORPHAN_MS = 30 * 60 * 1000
const OURS = new Set(["Hi", ...PROMPTS])

export const OPTIONS = [
  { key: "checkin", label: "国际版签到", description: "签到活动开着且今天没签就签；活动没开时什么都不做。", default: true },
  { key: "activity", label: "国际版对话活跃上报（点亮连登）", description: "每天上报一条 chat_request_send 事件，推进国际版成长中心连登。属于伪造行为事件，国际版风控更严。", default: false },
  { key: "daily-active", label: "国际版每日活跃会话", description: "在网页端开一条云端 agent 会话说一句 Hi 并跑完，领官方每日 30/50 积分包。跑完即结束会话，释放活跃名额。", default: true },
  { key: "random-prompt", label: "每日会话用随机提示词", description: "从 60 条内置的日常小问题里随机挑一句代替 Hi，免得每天都是同一句。", default: false },
]

const DEFAULTS = (k) => OPTIONS.find((o) => o.key === k)?.default === true

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

const convUrl = (id) => CONVERSATIONS + encodeURIComponent(String(id))

const full = (e) => e?.status === 429 && (e.code === 10105 || /10105|maximum number of active conversations/i.test(e.message ?? ""))

async function act(ctx, a, id, action) {
  try {
    await call(ctx, "POST", `${convUrl(id)}/${action}`, webHeaders(a), {}, 20000)
    return true
  } catch {
    return false
  }
}

export async function release(ctx, a, id, { remove = false } = {}) {
  const stopped = await act(ctx, a, id, "stop")
  return remove ? (await act(ctx, a, id, "delete")) || stopped : stopped
}

export async function sweep(ctx, a, { prune = false, known = [] } = {}) {
  let active
  try {
    const d = await call(ctx, "GET", CONVERSATIONS + "?page=1&pageSize=50", webHeaders(a), undefined, 20000)
    active = (Array.isArray(d?.conversations) ? d.conversations : []).filter((c) => ACTIVE.has(String(c?.status ?? "").toLowerCase()))
  } catch (e) {
    if (e?.restricted) throw e
    return 0
  }
  const ids = new Set(known.map(String))
  const mine = active.filter((c) => ids.has(String(c?.id)) || OURS.has(String(c?.name ?? "").trim()))
  mine.sort((x, y) => String(x?.createdAt ?? "").localeCompare(String(y?.createdAt ?? "")))
  const cutoff = ctx.now() - ORPHAN_MS
  let stopped = 0
  for (const c of mine) {
    if (prune) {
      if (active.length - stopped <= KEEP) break
    } else {
      const at = Date.parse(c?.createdAt ?? "")
      if (!Number.isFinite(at) || at > cutoff) continue
    }
    if (await act(ctx, a, c.id, "stop")) stopped++
  }
  return stopped
}

async function create(ctx, a, body, known) {
  try {
    return await call(ctx, "POST", CONVERSATIONS, webHeaders(a), body, 30000)
  } catch (e) {
    if (!full(e)) throw e
    const freed = await sweep(ctx, a, { prune: true, known })
    if (!freed) throw Object.assign(new Error(`活跃会话已达上限（${ACTIVE_LIMIT}）且没有本插件建的旧会话可结束，请到 www.workbuddy.ai 网页端结束旧对话`), { final: true })
    return await call(ctx, "POST", CONVERSATIONS, webHeaders(a), body, 30000)
  }
}

export async function dailyActive(ctx, a, { model = MODEL, prompt = "Hi", poll = 3000, reserve = 3000, known = [] } = {}) {
  const conv = await create(ctx, a, {
    prompt,
    model,
    conversationOrigin: "workbuddy-app",
    plugins: [{ name: "weixinpay", marketplace: "codebuddy-builtin" }],
  }, known)
  const id = conv?.id
  if (!id) throw Object.assign(new Error("建会话没有返回会话 id"), { final: true })
  known.push(String(id))
  known.splice(0, Math.max(0, known.length - 16))
  let kept = false
  try {
    const url = convUrl(id)
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
        if (status === "completed") {
          kept = true
          return { conversation: id, chunks: acp.chunks() }
        }
        if (status === "failed" || status === "error") throw new Error(`会话状态 ${status}`)
        await ctx.sleep(poll)
      }
      throw Object.assign(new Error(`会话没在时限内跑完（状态 ${status || "未知"}）`), { final: true })
    } finally {
      await acp.close()
    }
  } finally {
    await release(ctx, a, id, { remove: !kept })
  }
}

const retryable = (e) => !e?.final && !e?.restricted && (!e?.status || e.status >= 500 || e.status === 408 || e.status === 429)

export async function checkin(ctx, a) {
  const st = await soft(() => call(ctx, "POST", INTL.origin + "/billing/meter/checkin-activity-status", meterHeaders("workbuddy-ai", a), {}), null)
  if (!st?.active) return null
  if (st.today_checked_in ?? st.todayCheckedIn) return { outcome: "done", credit: num(st.today_credit ?? st.daily_credit), streak: num(st.streak_days), message: "今天已签到" }
  try {
    const got = (await call(ctx, "POST", INTL.origin + "/v2/billing/meter/daily-checkin", meterHeaders("workbuddy-ai", a), {})) ?? {}
    return { outcome: "claimed", credit: num(got.credit), streak: num(got.streak_days), message: got.message ? `签到：${got.message}` : "签到成功" }
  } catch (e) {
    if (e?.restricted) throw e
    if (e?.code === 1001) return { outcome: "done", message: "今天已签到" }
    return { outcome: "failed", message: `签到失败：${short(e)}` }
  }
}

export async function activity(ctx, a, notes) {
  const id = "wb-" + hex()
  const event = { eventCode: "chat_request_send", timestamp: ctx.now(), reportDelay: 0, mode: "craft", conversationId: id, requestId: id, inputLength: 12, requestModelId: MODEL, requestModelName: "DeepSeek V4.1 Flash", isPlan: false, agentName: "default", agentType: "conversation", userId: a.uid }
  const ok = await soft(async () => (await call(ctx, "POST", INTL.origin + "/v2/report", clientHeaders("workbuddy-ai", a), [event]), true), false)
  if (!ok) {
    notes.push("活跃上报被拒")
    return false
  }
  const st = await soft(() => call(ctx, "GET", INTL.origin + "/activity/growth/streak", clientHeaders("workbuddy-ai", a)), null)
  const days = num(st?.streak?.days)
  notes.push(days ? `活跃上报 ✓ 连登 ${days} 天` : "活跃上报 ✓")
  return true
}

async function daily(ctx, a, rec, day, option) {
  if (rec.intl === day) return { outcome: "done", message: "今天的每日活跃会话已跑完" }
  const prompt = option("random-prompt") ? PROMPTS[Math.floor(ctx.random() * PROMPTS.length)] : "Hi"
  rec.convs = Array.isArray(rec.convs) ? rec.convs : []
  try {
    await sweep(ctx, a, { known: rec.convs })
    let r
    for (let round = 0; ; round++) {
      try {
        r = await dailyActive(ctx, a, { prompt, known: rec.convs })
        break
      } catch (e) {
        if (round > 0 || !retryable(e) || ctx.left() < 45000) throw e
        await ctx.sleep(5000)
      }
    }
    rec.intl = day
    return { outcome: "claimed", message: `每日活跃会话已跑完（${r.chunks} 段输出），30/50 积分包由 WorkBuddy 稍后发放` }
  } catch (e) {
    if (e?.restricted) throw e
    return { outcome: "failed", message: `每日活跃会话失败：${short(e)}` }
  }
}

const RESTRICTED = { outcome: "ineligible", message: "WorkBuddy 以 11140 风控限制了这个账号，今天不再碰它；需在 WorkBuddy 里提交反馈申诉" }

export async function runIntl(ctx, a, { option = DEFAULTS, rec = {}, day = dayOf(ctx.now()) } = {}) {
  if (rec.restricted === day) return { outcome: "ineligible", message: "今天已遇到 11140 风控，不再碰这个账号" }
  rec.done ??= {}
  if (rec.done.day !== day) rec.done = { day }
  const notes = []
  let head = null
  let active = null
  try {
    if (option("checkin")) head = await checkin(ctx, a)
    if (option("activity") && !rec.done.activity) rec.done.activity = await activity(ctx, a, notes)
    if (option("daily-active")) active = await daily(ctx, a, rec, day, option)
  } catch (e) {
    if (!e?.restricted) throw e
    rec.restricted = day
    return RESTRICTED
  }
  const outs = [head?.outcome, active?.outcome].filter(Boolean)
  const outcome = active?.outcome === "failed" ? "failed" : outs.includes("claimed") ? "claimed" : outs.includes("done") ? "done" : outs[0] ?? (notes.length ? "done" : "inactive")
  const message = [head?.message, ...notes, active?.message].filter(Boolean).join("；") || "签到活动未开启，其余任务在插件选项里关掉了"
  return { outcome, credit: num(head?.credit), streak: num(head?.streak), message }
}
