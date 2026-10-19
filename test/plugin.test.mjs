import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as index from "../index.mjs"
import { CN } from "../src/cn.mjs"
import { COMMUNITY, candidates, checkinFor, loadCommunity, serve } from "../src/plugin.mjs"
import { account, fakeFetch, ok, testCtx } from "./fake.mjs"

function community() {
  const make = (id) => async () => ({
    config: async () => {},
    "chat.headers": async () => {},
    provider: { id, models: async (p) => p.models },
    auth: { provider: id, refreshLead: 300000, refresh: async () => undefined, loader: async () => ({}), usage: async () => ({}), methods: [{ type: "oauth", label: "browser" }] },
  })
  return {
    WorkBuddyAuthPlugin: make("workbuddy"),
    WorkBuddyAIAuthPlugin: make("workbuddy-ai"),
    _internal: { SITES: { workbuddy: {}, "workbuddy-ai": {} }, fresh: async (_s, _c, a) => ({ ...a, access: a.access + "-FRESH" }) },
  }
}

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
    expect(hooks.auth.options.map((o) => o.key)).toEqual(["activity", "travel", "night", "streak", "growth"])
    expect(hooks.auth.options.every((o) => /^[a-z0-9_-]{1,40}$/.test(o.key) && o.label.length <= 60 && o.description.length <= 300)).toBe(true)
    expect(hooks.provider.id).toBe("workbuddy")
    const ai = await serve("workbuddy-ai", {}, { load: async () => community() })
    expect(ai.auth.options.map((o) => o.key)).toEqual(["daily-active"])
  })

  test("no community plugin installed: nothing is served", async () => {
    expect(await serve("workbuddy", {}, { load: async () => null })).toEqual({})
  })

  test("finds the community plugin where magpie installs it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wbt-"))
    const pkg = join(dir, "plugins", "node_modules", ...COMMUNITY.split("/"))
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: COMMUNITY, type: "module", main: "./index.mjs" }))
    writeFileSync(join(pkg, "index.mjs"), "export const WorkBuddyAuthPlugin = async () => ({ auth: { provider: 'workbuddy' } })\n")
    expect(candidates({ directory: dir }, {})[0]).toBe(pkg)
    const mod = await loadCommunity({ directory: dir }, { env: {} })
    expect(typeof mod.WorkBuddyAuthPlugin).toBe("function")
  })

  test("checkin goes through fresh, keeps no secret in its state, and is single-flight", async () => {
    const f = fakeFetch([
      [`POST ${CN.chat}/v2/billing/meter/checkin-activity-status`, () => ok({ active: true, today_checked_in: true, today_credit: 5, streak_days: 9 })],
      [`POST ${CN.chat}/v2/report`, () => ok(null)],
      [`GET ${CN.chat}/*`, () => ok({})],
      [`POST ${CN.billing}/*`, () => ({ status: 400, json: { code: 1 } })],
    ])
    const statePath = join(mkdtempSync(join(tmpdir(), "wbt-")), "state.json")
    const hooks = await serve("workbuddy", {}, { load: async () => community(), statePath, ctx: testCtx(f.fetch), jitter: false })
    const getAuth = async () => ({ ...account })
    const [a, b] = await Promise.all([hooks.auth.checkin(getAuth), hooks.auth.checkin(getAuth)])
    expect(a).toBe(b)
    expect(a).toMatchObject({ outcome: "done", credit: 5, streak: 9 })
    expect(f.calls[0].headers.authorization).toBe("Bearer ACCESS-SECRET-TOKEN-FRESH")
    const saved = readFileSync(statePath, "utf8")
    expect(saved).not.toContain("SECRET")
    expect(saved).not.toContain("100012345678")
    expect(JSON.parse(saved)).toBeObject()
  })

  test("desktop sign-ins and missing sign-ins are said plainly", async () => {
    expect((await checkinFor("workbuddy", async () => undefined)).outcome).toBe("failed")
    expect((await checkinFor("workbuddy", async () => ({ type: "oauth", source: "desktop", uid: "1" }))).outcome).toBe("ineligible")
  })
})
