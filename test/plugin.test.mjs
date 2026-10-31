import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as index from "../index.mjs"
import { CLIENTS } from "../src/client.mjs"
import { CN } from "../src/cn.mjs"
import { INTL } from "../src/intl.mjs"
import { COMMUNITY, checkinFor, loadCommunity, serve } from "../src/plugin.mjs"
import { account, fakeFetch, ok, testCtx } from "./fake.mjs"

function community({ own } = {}) {
  const make = (id) => async () => ({
    config: async () => {},
    "chat.headers": async () => {},
    provider: { id, models: async (p) => p.models },
    auth: { provider: id, refreshLead: 300000, refresh: async () => undefined, loader: async () => ({}), usage: async () => ({}), methods: [{ type: "oauth", label: "browser" }], options: [{ key: "free_only", label: "Free models only" }], ...(own && id === "workbuddy" ? { checkin: own } : {}) },
  })
  return {
    WorkBuddyAuthPlugin: make("workbuddy"),
    WorkBuddyAIAuthPlugin: make("workbuddy-ai"),
    _internal: { SITES: { workbuddy: { app: "5.9.3", cli: "2.165.0", appName: "WorkBuddy" }, "workbuddy-ai": { app: "5.9.3", cli: "2.165.0", appName: "workbuddy-ai" } } },
  }
}

const tmpState = () => join(mkdtempSync(join(tmpdir(), "wbt-")), "state.json")

describe("plugin wiring", () => {
  test("index exports only the two plugin functions", () => {
    expect(Object.keys(index).sort()).toEqual(["WorkBuddyAITasksPlugin", "WorkBuddyTasksPlugin"])
  })

  test("wraps the community plugin's hooks and adds checkin and options", async () => {
    const hooks = await serve("workbuddy", { directory: "/nowhere" }, { load: async () => community() })
    expect(hooks.auth.provider).toBe("workbuddy")
    expect(hooks.auth.methods).toHaveLength(1)
    expect(typeof hooks.auth.loader).toBe("function")
    expect(typeof hooks.auth.usage).toBe("function")
    expect(hooks.auth.refreshLead).toBe(300000)
    expect(typeof hooks.auth.checkin).toBe("function")
    expect(hooks.auth.options.map((o) => o.key)).toEqual(["free_only", "activity", "travel", "night", "streak", "growth", "blindbox"])
    expect(hooks.auth.options.length).toBeLessThanOrEqual(16)
    expect(hooks.auth.options.every((o) => /^[a-z0-9_-]{1,40}$/.test(o.key) && o.label.length <= 60 && (o.description ?? "").length <= 300)).toBe(true)
    expect(hooks.provider.id).toBe("workbuddy")
    const ai = await serve("workbuddy-ai", {}, { load: async () => community() })
    expect(ai.auth.options.map((o) => o.key)).toEqual(["free_only", "checkin", "activity", "daily-active", "random-prompt"])
  })

  test("no community plugin installed: nothing is served", async () => {
    expect(await serve("workbuddy", {}, { load: async () => null })).toEqual({})
  })

  test("finds the community plugin where magpie installs it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wbt-"))
    const pkg = join(dir, "plugins", "node_modules", ...COMMUNITY.split("/"))
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: COMMUNITY, type: "module", exports: "./index.mjs" }))
    writeFileSync(join(pkg, "index.mjs"), "export const WorkBuddyAuthPlugin = async () => ({ auth: { provider: 'workbuddy' } })\n")
    const mod = await loadCommunity({ directory: dir })
    expect(typeof mod.WorkBuddyAuthPlugin).toBe("function")
  })

  test("the client version comes from the community plugin's site", async () => {
    const mod = community()
    mod._internal.SITES.workbuddy = { app: "6.1.0", cli: "2.200.0", appName: "WorkBuddy" }
    try {
      await serve("workbuddy", {}, { load: async () => mod })
      expect(CLIENTS.workbuddy).toMatchObject({ app: "6.1.0", cli: "2.200.0" })
    } finally {
      CLIENTS.workbuddy.app = "5.9.3"
      CLIENTS.workbuddy.cli = "2.165.0"
    }
  })

  test("checkin uses the sign-in magpie hands it, keeps no secret in its state, and is single-flight", async () => {
    const f = fakeFetch([
      [`POST ${CN.chat}/v2/billing/meter/checkin-activity-status`, () => ok({ active: true, today_checked_in: true, today_credit: 5, streak_days: 9 })],
      [`POST ${CN.chat}/v2/report`, () => ok(null)],
      [`GET ${CN.chat}/*`, () => ok({})],
      [`POST ${CN.billing}/*`, () => ({ status: 400, json: { code: 1 } })],
    ])
    const statePath = tmpState()
    const hooks = await serve("workbuddy", {}, { load: async () => community(), statePath, ctx: testCtx(f.fetch), jitter: false })
    const getAuth = async () => ({ ...account })
    const [a, b] = await Promise.all([hooks.auth.checkin(getAuth), hooks.auth.checkin(getAuth)])
    expect(a).toBe(b)
    expect(a).toMatchObject({ outcome: "done", credit: 5, streak: 9 })
    expect(f.calls[0].headers.authorization).toBe("Bearer ACCESS-SECRET-TOKEN")
    const saved = readFileSync(statePath, "utf8")
    expect(saved).not.toContain("SECRET")
    expect(saved).not.toContain("100012345678")
    expect(JSON.parse(saved)).toBeObject()
  })

  test("a run that outlasts magpie's wait says the check-in now and the rest at until", async () => {
    let release
    const gate = new Promise((r) => (release = r))
    const f = fakeFetch([
      [`POST ${CN.chat}/v2/billing/meter/checkin-activity-status`, () => ok({ active: true, today_checked_in: false })],
      [`POST ${CN.chat}/v2/billing/meter/daily-checkin`, () => ok({ credit: 20, streak_days: 3 })],
      [`POST ${CN.chat}/v2/report`, async () => (await gate, ok(null))],
      [`GET ${CN.chat}/*`, () => ok({})],
      [`POST ${CN.chat}/*`, () => ok({})],
      [`POST ${CN.billing}/*`, () => ({ status: 400, json: { code: 1 } })],
    ])
    const ctx = testCtx(f.fetch)
    const deps = { statePath: tmpState(), ctx, jitter: false, waitMs: 20 }
    const first = await checkinFor("workbuddy", async () => ({ ...account }), deps)
    expect(first).toMatchObject({ outcome: "claimed", credit: 20, streak: 3 })
    expect(first.message).toContain("后台")
    expect(first.until).toBe(ctx.now() + 10 * 60 * 1000)
    release()
    await new Promise((r) => setTimeout(r, 20))
    const second = await checkinFor("workbuddy", async () => ({ ...account }), deps)
    expect(second.outcome).toBe("claimed")
    expect(second.message).toContain("活跃上报 ✓")
    expect(second.until).toBeUndefined()
    expect(f.hits("POST", `${CN.chat}/v2/billing/meter/daily-checkin`)).toHaveLength(1)
  })

  test("a check-in that gets no answer at all is thrown, for magpie's offline backoff", async () => {
    const fetch = async () => {
      throw new TypeError("fetch failed")
    }
    expect(checkinFor("workbuddy", async () => ({ ...account }), { statePath: "", ctx: testCtx(fetch), jitter: false })).rejects.toThrow("fetch failed")
  })

  test("a personal and an enterprise sign-in of one uid are kept apart", async () => {
    const f = fakeFetch([
      [`POST ${CN.chat}/v2/billing/meter/checkin-activity-status`, ({ headers }) => ok({ active: true, today_checked_in: true, today_credit: headers["x-enterprise-id"] ? 1 : 2 })],
      [`GET ${CN.chat}/*`, () => ok({})],
      [`POST ${CN.chat}/*`, () => ok({})],
      [`POST ${CN.billing}/*`, () => ({ status: 400, json: { code: 1 } })],
    ])
    const statePath = tmpState()
    const deps = { statePath, ctx: testCtx(f.fetch), jitter: false, option: () => false }
    const [p, e] = await Promise.all([
      checkinFor("workbuddy", async () => ({ ...account }), deps),
      checkinFor("workbuddy", async () => ({ ...account, enterpriseId: "ent-1" }), deps),
    ])
    expect([p.credit, e.credit]).toEqual([2, 1])
    expect(Object.keys(JSON.parse(readFileSync(statePath, "utf8")))).toHaveLength(2)
  })

  test("an option the user never set reads as its default", async () => {
    const seen = []
    const f = fakeFetch([[`POST ${INTL.origin}/*`, ({ url, body }) => (seen.push([url, body?.prompt]), { status: 400, json: { code: 1, msg: "no" } })], [`GET ${INTL.origin}/*`, () => ok({ conversations: [] })]])
    const hooks = await serve("workbuddy-ai", {}, { load: async () => community(), statePath: "", ctx: testCtx(f.fetch), jitter: false })
    await hooks.auth.checkin(async () => ({ ...account, uid: "200" }))
    expect(seen.find(([u]) => u.endsWith("/v2/report"))).toBeUndefined()
    expect(seen.find(([u]) => u === `${INTL.origin}/console/as/conversations/`)[1]).toBe("Hi")
  })

  test("API keys, desktop sign-ins and missing sign-ins are said plainly", async () => {
    expect((await checkinFor("workbuddy", async () => undefined)).outcome).toBe("failed")
    expect((await checkinFor("workbuddy", async () => ({ type: "api", key: "ck_x" }))).outcome).toBe("ineligible")
    expect((await checkinFor("workbuddy-ai", async () => ({ type: "oauth", source: "desktop", uid: "1" }))).outcome).toBe("ineligible")
  })

  test("a desktop sign-in is checked in by the community plugin's own hook", async () => {
    const own = async (getAuth) => ({ outcome: "claimed", credit: 7, message: (await getAuth()).source })
    const hooks = await serve("workbuddy", {}, { load: async () => community({ own }), statePath: "" })
    expect(await hooks.auth.checkin(async () => ({ type: "oauth", source: "desktop", uid: "1" }))).toEqual({ outcome: "claimed", credit: 7, message: "desktop" })
  })
})
