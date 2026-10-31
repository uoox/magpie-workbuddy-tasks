import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { useClient } from "./client.mjs"
import { OPTIONS as CN_OPTIONS, runCN } from "./cn.mjs"
import { OPTIONS as INTL_OPTIONS, runIntl } from "./intl.mjs"
import { record } from "./state.mjs"
import { dayOf, hashOf, makeCtx } from "./util.mjs"

export const COMMUNITY = "@magpie-community/opencode-workbuddy-auth"
export const WAIT_MS = 45000
const AGAIN_MS = 10 * 60 * 1000

export const SITES = {
  workbuddy: { make: "WorkBuddyAuthPlugin", run: runCN, budgetMs: 240000, options: CN_OPTIONS },
  "workbuddy-ai": { make: "WorkBuddyAIAuthPlugin", run: runIntl, budgetMs: 180000, options: INTL_OPTIONS },
}

export async function loadCommunity(input) {
  try {
    return await import(pathToFileURL(Bun.resolveSync(COMMUNITY, join(input?.directory ?? process.cwd(), "plugins"))).href)
  } catch {
    return null
  }
}

const flights = new Map()
const late = new Map()

function start(id, a, key, deps) {
  const site = SITES[id]
  const ctx = makeCtx({ budgetMs: site.budgetMs, ...(deps.ctx ?? {}) })
  const day = dayOf(ctx.now())
  const job = { day, head: null, taken: false }
  job.done = (async () => {
    const { rec, save } = record(deps.statePath, key)
    try {
      if (deps.jitter !== false) await ctx.sleep(1000 + Math.floor(ctx.random() * 2000))
      const r = await site.run(ctx, a, { option: deps.option, rec, day, onHead: (h) => (job.head = h) })
      rec.last = { at: new Date(ctx.now()).toISOString(), outcome: r.outcome, message: r.message }
      return r
    } finally {
      save()
    }
  })()
  job.done.then(
    (r) => job.taken || late.set(key, { day, r }),
    () => {},
  ).finally(() => flights.delete(key))
  return job
}

export async function checkinFor(id, getAuth, deps = {}) {
  const a = await getAuth()
  if (a?.type === "api" || a?.source === "key") return { outcome: "ineligible", message: "API key 登录没有签到和任务，请改用浏览器方式登录" }
  if (a?.type !== "oauth") return { outcome: "failed", message: "这个账号没有登录" }
  if (a.source === "desktop") return deps.desktop ? deps.desktop(getAuth) : { outcome: "ineligible", message: "桌面端登录态不支持自动任务，请改用浏览器方式登录" }
  if (!a.access || !a.uid) return { outcome: "failed", message: "登录态里缺 token 或 uid，请重新登录" }
  const ent = typeof a.enterpriseId === "string" ? a.enterpriseId.trim() : ""
  const key = `${id}|${hashOf(ent ? `${a.uid}|${ent}` : a.uid)}`
  const now = deps.ctx?.now ?? Date.now
  const kept = late.get(key)
  if (kept && !flights.has(key)) {
    late.delete(key)
    if (kept.day === dayOf(now())) return kept.r
  }
  const job = flights.get(key) ?? start(id, a, key, deps)
  flights.set(key, job)
  let timer
  const r = await Promise.race([job.done, new Promise((ok) => (timer = setTimeout(ok, deps.waitMs ?? WAIT_MS, null)))]).finally(() => clearTimeout(timer))
  if (r) {
    job.taken = true
    late.delete(key)
    return r
  }
  const until = now() + AGAIN_MS
  if (job.head) return { ...job.head, message: `${job.head.message}；其余任务还在后台跑，稍后报结果`, until }
  return { outcome: "inactive", message: "任务还在后台跑，稍后报结果", until }
}

export async function serve(id, input, deps = {}) {
  const site = SITES[id]
  const mod = await (deps.load ?? loadCommunity)(input)
  const make = mod?.[site.make]
  if (typeof make !== "function") return {}
  const base = (await make(input)) ?? {}
  if (!base.auth || base.auth.provider !== id) return {}
  useClient(id, mod._internal?.SITES?.[id])
  const said = input?.magpie?.option
  const option = typeof said === "function" ? (key) => said(id, key) === true : undefined
  const keys = new Set(site.options.map((o) => o.key))
  const own = base.auth.checkin
  const auth = {
    ...base.auth,
    options: [...(base.auth.options ?? []).filter((o) => !keys.has(o?.key)), ...site.options],
    checkin: (getAuth) =>
      checkinFor(id, getAuth, {
        option,
        statePath: deps.statePath ?? join(input?.directory ?? process.cwd(), "workbuddy-tasks.json"),
        desktop: typeof own === "function" ? (g) => own(g) : undefined,
        ctx: deps.ctx,
        jitter: deps.jitter,
        waitMs: deps.waitMs,
      }),
  }
  return { ...base, auth }
}
