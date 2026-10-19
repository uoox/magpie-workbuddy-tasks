import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runCN } from "./cn.mjs"
import { runIntl } from "./intl.mjs"
import { record } from "./state.mjs"
import { dayOf, hashOf, makeCtx, short } from "./util.mjs"

export const COMMUNITY = "@magpie-community/opencode-workbuddy-auth"

export const SITES = {
  workbuddy: { make: "WorkBuddyAuthPlugin", run: runCN, budgetMs: 75000 },
  "workbuddy-ai": { make: "WorkBuddyAIAuthPlugin", run: runIntl, budgetMs: 100000 },
}

export const OPTIONS = {
  workbuddy: [
    { key: "activity", label: "每日对话活跃上报（点亮连登）", description: "签到时上报一条 chat_request_send 事件，推进成长中心连登天数与热力墙。属于伪造行为事件。", default: true },
    { key: "travel", label: "猫猫旅行", description: "归来自动领奖，在家自动派出。", default: true },
    { key: "night", label: "夜猫子任务", description: "签到落在北京时间 23:00–08:00 时上报一次夜间事件，累计 3 天领奖。", default: true },
    { key: "streak", label: "连登管家", description: "昨日漏签用补签卡补上、连登 7/14/28 天档位兑换、抽完抽奖次数、领新手礼包与活动补偿。", default: true },
    { key: "growth", label: "成长任务与积分任务", description: "批量接取任务、上报对应行为事件、领奖。属于伪造行为事件，风险最高。", default: true },
  ],
  "workbuddy-ai": [
    { key: "daily-active", label: "国际版每日活跃会话", description: "在网页端开一条云端 agent 会话说一句 Hi 并跑完，领官方每日 30/50 积分包。", default: true },
  ],
}

export function candidates(input, env = process.env) {
  const bases = [input?.directory, process.cwd(), env.XDG_CONFIG_HOME && join(env.XDG_CONFIG_HOME, "magpie"), join(homedir(), ".config", "magpie")]
  const out = []
  if (env.MAGPIE_WORKBUDDY_AUTH) out.push(env.MAGPIE_WORKBUDDY_AUTH)
  for (const b of bases) if (b) out.push(join(b, "plugins", "node_modules", ...COMMUNITY.split("/")))
  return [...new Set(out)]
}

export function entryOf(target) {
  const st = statSync(target, { throwIfNoEntry: false })
  if (!st) return null
  if (!st.isDirectory()) return target
  let pkg = {}
  try {
    pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"))
  } catch {}
  const ex = pkg.exports
  const pick = (x) => (typeof x === "string" ? x : x?.import ?? x?.default)
  const named = [ex && typeof ex === "object" ? pick(ex["./server"]) : null, pkg.main, ex && typeof ex === "object" ? pick(ex["."]) : null, typeof ex === "string" ? ex : null]
  for (const n of named) if (typeof n === "string" && n.trim() && existsSync(resolve(target, n.trim()))) return resolve(target, n.trim())
  for (const f of ["index.mjs", "index.js"]) if (existsSync(join(target, f))) return join(target, f)
  return null
}

export async function loadCommunity(input, { env = process.env, importer = (u) => import(u) } = {}) {
  for (const dir of candidates(input, env)) {
    const file = entryOf(dir)
    if (!file) continue
    try {
      return await importer(pathToFileURL(file).href)
    } catch {}
  }
  try {
    return await importer(COMMUNITY)
  } catch {
    return null
  }
}

export const statePathOf = (input, env = process.env) =>
  env.MAGPIE_WORKBUDDY_TASKS_STATE || join(input?.directory || process.cwd(), "workbuddy-tasks.json")

const flights = new Map()

export async function checkinFor(id, getAuth, deps = {}) {
  const site = SITES[id]
  const raw = await getAuth()
  if (raw?.type !== "oauth") return { outcome: "failed", message: "这个账号没有登录" }
  if (raw.source === "desktop") return { outcome: "ineligible", message: "桌面端登录态不支持自动任务，请改用浏览器方式登录" }
  let a = raw
  try {
    a = (await deps.fresh?.(raw)) ?? raw
  } catch {}
  if (!a?.access || !a?.uid) return { outcome: "failed", message: "登录态里缺 token 或 uid，请重新登录" }
  const key = `${id}|${hashOf(a.uid)}`
  const running = flights.get(key)
  if (running) return running
  const job = (async () => {
    const ctx = makeCtx({ budgetMs: site.budgetMs, ...(deps.ctx ?? {}) })
    const { rec, save } = record(deps.statePath, key)
    try {
      if (deps.jitter !== false) await ctx.sleep(1000 + Math.floor(ctx.random() * 2000))
      const r = await site.run(ctx, a, { option: deps.option ?? (() => true), rec, day: dayOf(ctx.now()) })
      rec.last = { at: new Date(ctx.now()).toISOString(), outcome: r.outcome, message: r.message }
      return r
    } catch (e) {
      return { outcome: "failed", message: short(e) }
    } finally {
      save()
    }
  })().finally(() => flights.delete(key))
  flights.set(key, job)
  return job
}

export async function serve(id, input, deps = {}) {
  const site = SITES[id]
  const mod = await (deps.load ?? loadCommunity)(input)
  const make = mod?.[site.make]
  if (typeof make !== "function") return {}
  const base = (await make(input)) ?? {}
  if (!base.auth || base.auth.provider !== id) return {}
  const fresh = mod._internal?.fresh
  const siteOf = mod._internal?.SITES?.[id]
  const option = (key) => {
    try {
      const f = input?.magpie?.option
      return typeof f === "function" ? f(id, key) === true : true
    } catch {
      return true
    }
  }
  const keys = new Set(OPTIONS[id].map((o) => o.key))
  const auth = {
    ...base.auth,
    options: [...(base.auth.options ?? []).filter((o) => !keys.has(o?.key)), ...OPTIONS[id]],
    checkin: (getAuth) =>
      checkinFor(id, getAuth, {
        fresh: typeof fresh === "function" && siteOf ? (a) => fresh(siteOf, input?.client, a) : undefined,
        option,
        statePath: deps.statePath ?? statePathOf(input),
        ctx: deps.ctx,
        jitter: deps.jitter,
      }),
  }
  return { ...base, auth }
}
