import { machineId, sessionId } from "./fingerprint.mjs"
import { call, soft } from "./http.mjs"
import { dayOf, hex, inNight, num, short, uuid } from "./util.mjs"

export const CN = {
  chat: "https://copilot.tencent.com",
  billing: "https://www.codebuddy.cn",
  web: "https://www.workbuddy.cn",
}

export const CLIENT = { app: "5.9.3", cli: "2.165.0" }

export function useClient(site) {
  if (typeof site?.app === "string" && site.app) CLIENT.app = site.app
  if (typeof site?.cli === "string" && site.cli) CLIENT.cli = site.cli
}

const uaDesktop = () => `WorkBuddy/${CLIENT.app} WorkBuddy/${CLIENT.app} CLI/${CLIENT.cli}`
export const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"

export const SPECS = {
  create_canvas: { kind: "canvas", target: 1, name: "创建设计任务" },
  template_5: { kind: "template", target: 5, name: "模板创建任务" },
  expert_5: { kind: "expert", target: 5, name: "使用专家助手" },
  Expert_team_use_3: { kind: "team", target: 3, name: "使用专家团队" },
  skill_1: { kind: "skill", target: 1, name: "体验技能" },
  automation_1: { kind: "automation", target: 1, name: "创建自动化任务" },
  playbook_prompt: { kind: "playbook", target: 1, name: "灵感案例使用" },
  Expert_lighthouse: { kind: "lighthouse", target: 1, name: "轻量云专家使用" },
  Buddy_App: { kind: "buddy5", target: 1, name: "进入 Buddy 应用" },
  Buddy_App_QQ: { kind: "buddy5", target: 1, name: "企鹅教师助手" },
  Hp_Appearance: { kind: "skin", target: 1, name: "应用主题外观" },
  chat_5: { kind: "chat", target: 5, name: "发起 5 次对话" },
  "Model_chat_GLM5.2": { kind: "glmchat", target: 1, name: "体验 GLM-5.2" },
  black_cat: { kind: "cat", target: 3, name: "夜猫子任务" },
  RichMeow_Chat: { kind: "richmeow", target: 1, name: "桌面对话事件链" },
  Library_read: { kind: "library", target: 1, name: "浏览资料库" },
  first_buddy: { kind: "chat", target: 1, name: "领取一只 Buddy" },
  WorkBuddy_Valorant: { kind: "expert", target: 1, name: "体验无畏契约拼豆专家", expert: ["ex_xQHHD1u5Jkua", "无畏契约拼豆专家"] },
  wb_wechat_oa_subscribe_task: { unforgeable: true, name: "关注官方公众号" },
  Expert_Philanthropy: { unforgeable: true, name: "公益爱心捐赠" },
}

export const DESKTOP_ONLY = new Set(["RichMeow_Chat", "Library_read", "Buddy_App", "Buddy_App_QQ"])

export const EXPERTS = [
  ["ex_PZw8Gu81HfN4", "运维工程师"], ["ex_ROsDtJbzADFV", "产品经理"],
  ["ex_SMUnl0nJbPix", "UI设计师"], ["ex_ZTR062oVBOCW", "数据分析师"],
  ["ex_a3sSSFBy8qaC", "后端架构师"], ["ex_aG1kvKbq8lPx", "文案策划"],
  ["ex_al1vxtUOYQ10", "测试专家"], ["ex_cZfiyuET9UQP", "安全顾问"],
  ["ex_eggOvQuVP0hq", "算法工程师"], ["ex_hSwsQjkSKnkX", "前端工程师"],
  ["ex_mMbwwmFA9n9P", "项目管理专家"], ["ex_uAQE5POfk7Zh", "增长运营专家"],
  ["ex_uZzSAScSy7FZ", "行业研究员"], ["ex_LHywGrZOtG7G", "数据分析师"],
  ["ex_NX5C8GBciVed", "测试架构师"], ["ex_DdCsaoq4AtcO", "云端运维专家"],
  ["ex_KzqKQguubrNQ", "内容创作专家"], ["ex_2cvvUZQhDyeJ", "腾讯轻量云专家"],
]

export const TEAMS = [
  ["CloudOpsTeam", "运维专家团队"], ["CloudContentTeam", "内容专家团队"],
  ["CloudDevTeam", "研发专家团队"], ["ProductStrategyTeam", "产品战略团队"],
  ["MarketingCampaignTeam", "营销活动团队"], ["SalesBattleTeam", "销售作战团队"],
  ["DesignEngineTeam", "设计引擎团队"], ["HrOperationsTeam", "人力运营团队"],
]

const domainOf = (a) => a.domain || "copilot.tencent.com"

export function enterpriseHeaders(a) {
  const id = typeof a?.enterpriseId === "string" ? a.enterpriseId.trim() : ""
  return id ? { "X-Enterprise-Id": id, "X-Tenant-Id": id } : {}
}

export function meterHeaders(a) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "WorkBuddy/" + CLIENT.app,
    Authorization: "Bearer " + a.access,
    "X-User-Id": a.uid ?? "",
    "X-Domain": domainOf(a),
    "X-Product": "SaaS",
    "X-IDE-Type": "WorkBuddy",
    ...enterpriseHeaders(a),
  }
}

export function chatHeaders(a) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Origin: CN.billing,
    Referer: CN.billing + "/",
    "X-CodeBuddy-Request": "1",
    "Accept-Language": "zh-CN",
    "X-Agent-Intent": "craft",
    "X-Agent-Purpose": "conversation",
    "X-Agent-Type": "main",
    "X-IDE-Name": "WorkBuddy",
    "X-IDE-Type": "WorkBuddy",
    "X-IDE-Version": CLIENT.app,
    "X-Private-Data": "true",
    "X-Product": "SaaS",
    "X-Domain": domainOf(a),
    "User-Agent": uaDesktop(),
    "X-User-Id": a.uid ?? "",
    Authorization: "Bearer " + a.access,
    "X-Request-ID": hex(),
  }
}

export function billingHeaders(a) {
  const ent = enterpriseHeaders(a)
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "WorkBuddy/" + CLIENT.app,
    Origin: CN.billing,
    Referer: CN.billing + "/",
    Authorization: "Bearer " + a.access,
    "X-User-Id": a.uid ?? "",
    "X-Domain": domainOf(a),
    "X-CodeBuddy-Request": "1",
    "Accept-Language": "zh-CN",
    "X-Request-ID": hex(),
    "X-Machine-ID": machineId(a.uid),
    "X-Session-ID": sessionId(a.uid),
    "X-Product": "SaaS",
    ...(Object.keys(ent).length ? ent : { "X-No-Enterprise-Id": "1" }),
  }
}

export function webHeaders(a) {
  return {
    Authorization: "Bearer " + a.access,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: CN.web,
    Referer: CN.web + "/profile/growth-center",
    "x-client-platform": "web",
    "User-Agent": UA_WEB,
    "X-User-Id": a.uid ?? "",
    "X-Domain": CN.web,
  }
}

export async function checkin(ctx, a) {
  let st
  try {
    st = (await call(ctx, "POST", CN.chat + "/v2/billing/meter/checkin-activity-status", meterHeaders(a), {})) ?? {}
  } catch (e) {
    return refused(ctx, a, e)
  }
  if (!st.active) return { outcome: "inactive", message: "签到活动当前未开启" }
  if (st.today_checked_in) return { outcome: "done", credit: num(st.today_credit), streak: num(st.streak_days), message: "今天已签到" }
  for (let attempt = 0; ; attempt++) {
    try {
      const got = (await call(ctx, "POST", CN.chat + "/v2/billing/meter/daily-checkin", meterHeaders(a), {})) ?? {}
      const said = String(got.message ?? "")
      if (PENDING.test(said) || /失败/.test(said)) return { outcome: "failed", message: `签到没成：${said}` }
      return { outcome: "claimed", credit: num(got.credit), streak: num(got.streak_days), message: said ? `签到：${said}` : "签到成功" }
    } catch (e) {
      if (!e?.restricted && (e?.status >= 500 || e?.code === 10000) && attempt < 2) {
        await ctx.sleep(2000 * (attempt + 1))
        continue
      }
      const r = await refused(ctx, a, e)
      if (r.outcome === "done") r.streak = num(st.streak_days)
      return r
    }
  }
}

const PENDING = /处理中|请勿重复操作|系统繁忙|稍后再试/

async function refused(ctx, a, e) {
  if (e?.restricted) return { outcome: "ineligible", restricted: true, message: "WorkBuddy 以 11140 风控限制了这个账号，本插件今天不再碰它；需在 WorkBuddy 里提交反馈申诉" }
  if (e?.status === 401) {
    try {
      await call(ctx, "POST", CN.chat + "/billing/meter/get-user-resource-summary", meterHeaders(a), {})
      return { outcome: "captcha", message: "签到接口回 401 而积分接口正常：WorkBuddy 的签到只认官方 App 的设备 token，请在 WorkBuddy App 里手动签到" }
    } catch {
      return { outcome: "failed", message: "WorkBuddy 拒绝了这个账号的登录态（401），请重新登录" }
    }
  }
  const msg = short(e)
  if (e?.code === 1001 || (/已签到/.test(msg) && !PENDING.test(msg))) return { outcome: "done", message: "今天已签到" }
  if (e?.code === 1002) return { outcome: "ineligible", message: `账号不能参加签到：${msg}` }
  if (e?.code === 1003) return { outcome: "inactive", message: `签到活动已结束：${msg}` }
  return { outcome: "failed", message: `签到失败：${msg}` }
}

export function buildEvent(a, kind, idx, expert, now) {
  const cid = `wb-task-${now}-${idx}`
  const rid = `${cid}-req`
  const userId = a.uid
  switch (kind) {
    case "canvas":
      return { eventCode: "wbx_design_canvas_task_create", timestamp: now, reportDelay: 0, conversationId: cid, requestId: rid, source: "summon_keyword", isCustomModel: false, name: "", inputLength: 12, id: `wbx-canvas-${now}`, cost: 0, isSuccessful: true, userId }
    case "template":
      return { eventCode: "agent_task_created_with_template", timestamp: now, reportDelay: 0, isCustomModel: true, id: String(idx), name: "幻灯片", requestId: rid, conversationId: cid, userId }
    case "expert":
    case "team":
    case "lighthouse": {
      const [id, name] = expert ?? (kind === "lighthouse" ? ["ex_2cvvUZQhDyeJ", "腾讯轻量云专家"] : kind === "team" ? ["CloudOpsTeam", "运维专家团队"] : ["ContentCreator", "内容创作专家"])
      return { eventCode: "expert_actual_use", timestamp: now, reportDelay: 0, mode: "CLOUD", id, name, expertTitle: name, type: "02-Engineering", expertType: kind === "team" ? "team" : "agent", source: "builtin", version: "1.0.2", cost: 0, characterCount: 12, conversationId: cid, requestId: rid, messageId: rid, requestModelId: "deepseek-v4-flash", requestModelName: "DeepSeek V4 Flash", userId }
    }
    case "skill":
      return { eventCode: "skill_info", timestamp: now, reportDelay: 0, skillId: "skill_2096525080079265792", name: "pptx", userId }
    case "automation":
      return { eventCode: "automated_task_create_suc", timestamp: now, reportDelay: 0, name: "每周工作整理", type: "cron", source: "manually", modelId: "deepseek-v4-flash", modelIsThinking: false, conversationId: cid, requestId: rid, schedule: { type: "recurring", rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0" }, prompt: "每周五自动整理本周工作", userId }
    case "playbook":
      return { eventCode: "playbook_prompt_send", timestamp: now, reportDelay: 0, id: "worker-ledger-freedom-dashboard", name: "打工人小账本", type: "other", promptLength: 10, isOfficial: 1, source: "discover", conversationId: cid, requestId: rid, userId }
    case "skin":
      return { eventCode: "appearance_skin_apply", timestamp: now, reportDelay: 0, action: "apply", source: "settings_close", id: "theme-tkmw7j", vipLevel: "free", series: "craft", type: "unknown", name: "和平精英激战金秋", userId }
    case "chat":
    case "glmchat":
    case "cat": {
      const glm = kind !== "chat"
      return { eventCode: "chat_request_send", timestamp: now, reportDelay: 0, mode: kind === "cat" ? "night" : "craft", conversationId: cid, requestId: rid, inputLength: 12, requestModelId: glm ? "glm-5.2" : "deepseek-v4-flash", requestModelName: glm ? "GLM-5.2" : "DeepSeek V4 Flash", isPlan: false, agentName: "default", agentType: "conversation", userId }
    }
  }
  return { eventCode: "heartbeat", timestamp: now, userId }
}

export const report = (ctx, a, events) => soft(async () => (await call(ctx, "POST", CN.chat + "/v2/report", chatHeaders(a), events), true), false)

function norm(t) {
  const spec = SPECS[t?.task_code] ?? {}
  const p = t?.progress ?? {}
  return {
    code: t?.task_code ?? "",
    name: t?.title || spec.name || t?.task_code || "",
    status: t?.accept_status || "not_accepted",
    type: t?.task_type || "",
    current: num(p.current),
    target: num(p.target ?? spec.target ?? 1) || 1,
    jump: t?.jump_url || "",
  }
}

export async function tasks(ctx, a) {
  const d = await call(ctx, "GET", CN.chat + "/v2/activity/growth/tasks", chatHeaders(a))
  return (d?.tasks ?? []).map(norm)
}

export async function accept(ctx, a, codes) {
  const out = { accepted: [], failed: [] }
  for (let i = 0; i < codes.length; i += 20) {
    const part = codes.slice(i, i + 20)
    const d = await soft(() => call(ctx, "POST", CN.chat + "/v2/activity/growth/tasks/accept", chatHeaders(a), { task_codes: part }), null)
    if (!d) {
      out.failed.push(...part)
      continue
    }
    const seen = new Set()
    for (const r of d.results ?? []) {
      seen.add(r.task_code)
      if (r.status === "accepted" || r.status === "already_accepted") out.accepted.push(r.task_code)
      else out.failed.push(r.task_code)
    }
    for (const c of part) if (!seen.has(c)) out.failed.push(c)
  }
  return out
}

export async function claim(ctx, a, code) {
  const path = `/activity/growth/tasks/${encodeURIComponent(code)}/claim`
  try {
    const d = (await call(ctx, "POST", CN.chat + path, chatHeaders(a), {})) ?? {}
    return { ok: true, credit: num(d.credit) }
  } catch (e) {
    if (e?.restricted) throw e
    if (e?.status !== 400) return { ok: false, msg: short(e) }
    return soft(async () => {
      const d = (await call(ctx, "POST", CN.web + path, webHeaders(a), {})) ?? {}
      return { ok: true, credit: num(d.credit) }
    }, (e2) => ({ ok: false, msg: short(e2) }))
  }
}

async function progress(ctx, a, t, tally) {
  const spec = SPECS[t.code]
  if (!spec) return 0
  if (spec.unforgeable) {
    if (t.status !== "claimed") tally.manual.add(spec.name)
    return 0
  }
  if (t.status === "claimed") return 0
  if (t.status === "completed" || t.current >= t.target) {
    const r = await claim(ctx, a, t.code)
    await ctx.sleep(ctx.gap)
    if (r.ok) {
      tally.claimed.push(spec.name)
      return r.credit
    }
    tally.errors.push(`${spec.name}领奖失败：${r.msg}`)
    return 0
  }
  if (DESKTOP_ONLY.has(t.code)) {
    tally.desktop.add(spec.name)
    return 0
  }
  if (t.code === "black_cat") return 0
  if (t.status === "not_accepted" && t.type !== "auto") return 0
  const need = Math.max(1, t.target - t.current)
  const pool = spec.expert ? [spec.expert] : spec.kind === "team" ? TEAMS : spec.kind === "expert" ? EXPERTS : null
  for (let i = 0; i < need; i++) {
    const expert = pool ? pool[(t.current + i) % pool.length] : undefined
    await report(ctx, a, [buildEvent(a, spec.kind, i, expert, ctx.now())])
    if (i < need - 1) await ctx.sleep(ctx.gap)
  }
  await ctx.sleep(1500)
  let prog = t.current
  for (let attempt = 0; attempt < 6; attempt++) {
    const fresh = (await soft(() => tasks(ctx, a), [])).find((x) => x.code === t.code)
    if (fresh) {
      prog = fresh.current
      if (prog >= t.target || fresh.status === "completed" || fresh.status === "claimed") {
        prog = Math.max(prog, t.target)
        break
      }
      if (prog > t.current) {
        await ctx.sleep(2500)
        continue
      }
    }
    if (attempt < 2) await ctx.sleep(1500)
    else break
  }
  if (prog < t.target) {
    tally.pending.push(spec.name)
    return 0
  }
  const r = await claim(ctx, a, t.code)
  await ctx.sleep(ctx.gap)
  if (r.ok) {
    tally.claimed.push(spec.name)
    return r.credit
  }
  tally.errors.push(`${spec.name}领奖失败：${r.msg}`)
  return 0
}

const needsAccept = (t) => t.status === "not_accepted" && t.type !== "auto" && !SPECS[t.code]?.unforgeable

export async function growth(ctx, a, notes, reserve = 12000) {
  const tally = { claimed: [], pending: [], desktop: new Set(), manual: new Set(), errors: [], later: 0 }
  let list = await tasks(ctx, a)
  if (!list.length) {
    notes.push("成长任务：没拿到任务清单")
    return 0
  }
  let earned = 0
  for (const t of list) if (t.type === "auto") earned += await progress(ctx, a, t, tally)
  const todo = list.filter(needsAccept).map((t) => t.code)
  if (todo.length) {
    await accept(ctx, a, todo)
    await ctx.sleep(ctx.gap)
    list = await tasks(ctx, a)
    const still = list.filter(needsAccept).map((t) => t.code)
    if (still.length) {
      await accept(ctx, a, still)
      await ctx.sleep(ctx.gap)
      list = await tasks(ctx, a)
    }
  }
  for (const t of list) {
    if (t.type === "auto") continue
    const spec = SPECS[t.code]
    const work = spec && !spec.unforgeable && t.status !== "claimed" && !DESKTOP_ONLY.has(t.code) && t.code !== "black_cat"
    if (work && ctx.left() < reserve) {
      tally.later++
      continue
    }
    earned += await progress(ctx, a, t, tally)
  }
  const parts = []
  if (tally.claimed.length) parts.push(`领奖 ${tally.claimed.length} 个 +${earned}`)
  if (tally.pending.length) parts.push(`${tally.pending.length} 个已上报待到账`)
  if (tally.later) parts.push(`${tally.later} 个留到下次`)
  if (tally.desktop.size) parts.push(`${tally.desktop.size} 个需桌面端手动完成`)
  if (tally.manual.size) parts.push(`${tally.manual.size} 个需真人操作`)
  if (tally.errors.length) parts.push(tally.errors.slice(0, 2).join("，"))
  notes.push(`成长任务：${parts.length ? parts.join("，") : "没有可做的"}`)
  return earned
}

async function depart(ctx, a, lid) {
  try {
    const d = await call(ctx, "POST", CN.chat + "/activity/growth/buddy/travel/depart", chatHeaders(a), { location_id: lid })
    return { data: d ?? {} }
  } catch (e) {
    if (e?.restricted) throw e
    return { err: short(e) }
  }
}

export async function travel(ctx, a, notes) {
  const status = async () => (await call(ctx, "GET", CN.chat + "/activity/growth/buddy/travel/status", chatHeaders(a))) ?? {}
  let st = await status()
  let credit = 0
  if (st.state === "arrived") {
    const c = (await call(ctx, "POST", CN.chat + "/activity/growth/buddy/travel/claim", chatHeaders(a), {})) ?? {}
    credit = num(c.reward_credit)
    notes.push(`猫猫旅行归来 +${credit}`)
    await ctx.sleep(ctx.gap)
    st = await status()
  }
  if (st.state === "traveling") {
    notes.push("猫猫旅行途中")
    return credit
  }
  if (st.state !== "idle") {
    if (!credit) notes.push(`猫猫状态 ${st.state ?? "未知"}`)
    return credit
  }
  if (st.daily_limit_reached) {
    if (!credit) notes.push("猫猫今天已旅行过")
    return credit
  }
  const cfg = await soft(() => call(ctx, "GET", CN.chat + "/activity/growth/buddy/travel/config", chatHeaders(a)), null)
  const lid = cfg?.locations?.[0]?.id ?? 1
  let r = await depart(ctx, a, lid)
  if (r.err && /no active buddy/i.test(r.err)) {
    const list = await soft(() => tasks(ctx, a), [])
    const fb = list.find((t) => t.code === "first_buddy")
    if (fb && fb.status !== "claimed") await progress(ctx, a, fb, { claimed: [], pending: [], desktop: new Set(), manual: new Set(), errors: [] })
    r = await depart(ctx, a, lid)
  }
  if (r.err) notes.push(`猫猫派出失败：${r.err}`)
  else notes.push(`猫猫出发去「${r.data?.location?.name || "远方"}」`)
  return credit
}

export async function streakBonus(ctx, a, notes, today) {
  const got = []
  const hm = await soft(() => call(ctx, "GET", CN.chat + "/activity/growth/heatmap", chatHeaders(a)), null)
  const yesterday = dayOf(Date.parse(today + "T00:00:00Z") - 12 * 3600 * 1000)
  const cell = (hm?.cells ?? []).find((c) => c?.date === yesterday)
  let streak = await soft(() => call(ctx, "GET", CN.chat + "/activity/growth/streak", chatHeaders(a)), null)
  if (cell && num(cell.score) === 0 && num(streak?.makeup_cards?.balance) > 0) {
    const ok = await soft(async () => (await call(ctx, "POST", CN.chat + "/activity/growth/makeup-cards/use", chatHeaders(a), { target_date: yesterday }), true), false)
    if (ok) got.push(`补签 ${yesterday}`)
  }
  for (const [path, name] of [["/billing/meter/claim-gift", "新手礼包"], ["/billing/meter/claim-compensation", "活动补偿"]]) {
    const d = await soft(() => call(ctx, "POST", CN.billing + path, billingHeaders(a), {}), null)
    if (d) got.push(`${name} +${num(d.credit)}`)
  }
  if (got.length) streak = await soft(() => call(ctx, "GET", CN.chat + "/activity/growth/streak", chatHeaders(a)), streak)
  const rs = streak?.redemption_status ?? {}
  const statuses = { "7d": rs.tier_7d_status, "14d": rs.tier_14d_status, "28d": rs.tier_28d_status }
  for (const t of rs.tiers ?? []) {
    const s = statuses[t?.tier]
    if (!s || s === "locked" || s === "claimed") continue
    const ok = await soft(async () => (await call(ctx, "POST", CN.chat + "/activity/growth/redeem", chatHeaders(a), { tier: t.tier, client_token: uuid() }), true), false)
    if (ok) got.push(`兑换连登 ${t.tier}`)
  }
  const lot = await soft(() => call(ctx, "GET", CN.chat + "/activity/growth/lottery/summary", chatHeaders(a)), null)
  let drawn = 0
  for (let i = 0; i < Math.min(num(lot?.chances), 20); i++) {
    const ok = await soft(async () => (await call(ctx, "POST", CN.chat + "/activity/growth/lottery/draw", chatHeaders(a), { client_token: uuid() }), true), false)
    if (!ok) break
    drawn++
    await ctx.sleep(ctx.gap)
  }
  if (drawn) got.push(`抽奖 ${drawn} 次`)
  if (got.length) notes.push(`连登：${got.join("，")}`)
  return 0
}

export async function activity(ctx, a, notes) {
  const ok = await report(ctx, a, [buildEvent(a, "chat", 0, undefined, ctx.now())])
  if (!ok) {
    notes.push("活跃上报被拒")
    return false
  }
  const st = await soft(() => call(ctx, "GET", CN.chat + "/activity/growth/streak", chatHeaders(a)), null)
  const days = num(st?.streak?.days)
  notes.push(days ? `活跃上报 ✓ 连登 ${days} 天` : "活跃上报 ✓")
  return true
}

export async function night(ctx, a, notes) {
  if (!inNight(ctx.now())) return false
  const find = async () => (await soft(() => tasks(ctx, a), [])).find((t) => t.code === "black_cat")
  let t = await find()
  if (!t) return false
  if (t.status === "claimed") return true
  if (t.status === "not_accepted") {
    const r = await accept(ctx, a, ["black_cat"])
    if (!r.accepted.length) {
      notes.push("夜猫子任务接取失败")
      return false
    }
  }
  if (t.current < t.target) {
    const ok = await report(ctx, a, [buildEvent(a, "cat", 0, undefined, ctx.now())])
    if (!ok) {
      notes.push("夜猫子上报被拒")
      return false
    }
    let fresh = t
    for (let i = 0; i < 3; i++) {
      await ctx.sleep(3000)
      fresh = (await find()) ?? fresh
      if (fresh.current > t.current) break
    }
    t = fresh
  }
  if (t.current >= t.target || t.status === "completed") {
    const r = await claim(ctx, a, "black_cat")
    notes.push(r.ok ? `夜猫子完成 +${r.credit}` : `夜猫子领奖失败：${r.msg}`)
  } else {
    notes.push(`夜猫子 ${t.current}/${t.target}`)
  }
  return true
}

export const RERUN_MS = 3 * 3600 * 1000

export const STEPS = [
  { key: "activity", label: "对话活跃上报", daily: true, run: (ctx, a, notes) => activity(ctx, a, notes) },
  { key: "travel", label: "猫猫旅行", run: (ctx, a, notes) => travel(ctx, a, notes) },
  { key: "night", label: "夜猫子任务", daily: true, run: (ctx, a, notes) => night(ctx, a, notes) },
  { key: "streak", label: "连登管家", daily: true, run: (ctx, a, notes, day) => streakBonus(ctx, a, notes, day).then(() => true) },
  { key: "growth", label: "成长任务", run: (ctx, a, notes) => growth(ctx, a, notes) },
]

export async function runCN(ctx, a, { option = () => true, rec = {}, day = dayOf(ctx.now()) } = {}) {
  const head = await checkin(ctx, a)
  const notes = []
  rec.done ??= {}
  if (rec.done.day !== day) rec.done = { day }
  rec.ran ??= {}
  if (head.restricted) rec.restricted = day
  if (rec.restricted === day) {
    if (!head.restricted) notes.push("今天已遇到 11140 风控，跳过自动任务")
  } else if (a.enterpriseId) {
    notes.push("企业账号没有成长体系，跳过自动任务")
  } else {
    for (const s of STEPS) {
      if (!option(s.key)) continue
      if (s.daily && rec.done[s.key]) continue
      if (!s.daily && ctx.now() - num(rec.ran[s.key]) < RERUN_MS) continue
      if (ctx.left() < 5000) {
        notes.push(`${s.label}留到下次（本轮时间用完）`)
        continue
      }
      try {
        const done = await s.run(ctx, a, notes, day)
        if (s.daily && done) rec.done[s.key] = true
        if (!s.daily) rec.ran[s.key] = ctx.now()
      } catch (e) {
        if (e?.restricted) {
          rec.restricted = day
          notes.push("遇到 11140 风控，已停手")
          break
        }
        notes.push(`${s.label}失败：${short(e, 80)}`)
      }
    }
  }
  const message = [head.message, ...notes].filter(Boolean).join("；").slice(0, 600)
  return { outcome: head.outcome, credit: num(head.credit), streak: num(head.streak), message }
}
