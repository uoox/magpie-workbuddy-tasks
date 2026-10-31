import { describe, expect, test } from "bun:test"
import { CLIENTS } from "../src/client.mjs"
import { CN, RERUN_MS, THEME, blindbox, checkin, growth, report, runCN, travel, streakBonus } from "../src/cn.mjs"
import { account, fakeFetch, ok, testCtx } from "./fake.mjs"

const STATUS = `POST ${CN.chat}/v2/billing/meter/checkin-activity-status`
const CLAIM = `POST ${CN.chat}/v2/billing/meter/daily-checkin`
const SUMMARY = `POST ${CN.chat}/billing/meter/get-user-resource-summary`

describe("checkin", () => {
  test("claims when the event runs and today's isn't in", async () => {
    const f = fakeFetch([
      [STATUS, () => ok({ active: true, today_checked_in: false, streak_days: 3 })],
      [CLAIM, () => ok({ credit: 20, streak_days: 4, message: "签到成功" })],
    ])
    const r = await checkin(testCtx(f.fetch), account)
    expect(r).toMatchObject({ outcome: "claimed", credit: 20, streak: 4 })
    const h = f.calls[1].headers
    expect(h.authorization).toBe("Bearer ACCESS-SECRET-TOKEN")
    expect(h["user-agent"]).toBe("WorkBuddy/5.9.3")
    expect(h["x-user-id"]).toBe("100012345678")
  })

  test("today's in already is done", async () => {
    const f = fakeFetch([[STATUS, () => ok({ active: true, today_checked_in: true, today_credit: 10, streak_days: 5 })]])
    expect(await checkin(testCtx(f.fetch), account)).toMatchObject({ outcome: "done", credit: 10, streak: 5 })
    expect(f.hits("POST", CLAIM.split(" ")[1])).toHaveLength(0)
  })

  test("no event running is inactive", async () => {
    const f = fakeFetch([[STATUS, () => ok({ active: false })]])
    expect((await checkin(testCtx(f.fetch), account)).outcome).toBe("inactive")
  })

  test("codes 1001/1002/1003 map to done/ineligible/inactive", async () => {
    for (const [code, outcome] of [[1001, "done"], [1002, "ineligible"], [1003, "inactive"]]) {
      const f = fakeFetch([
        [STATUS, () => ok({ active: true, today_checked_in: false, streak_days: 2 })],
        [CLAIM, () => ({ status: 400, json: { code, msg: "x" } })],
      ])
      expect((await checkin(testCtx(f.fetch), account)).outcome).toBe(outcome)
    }
  })

  test("401 with credits readable means WorkBuddy's own app", async () => {
    const f = fakeFetch([
      [STATUS, () => ({ status: 401, text: "<html>401</html>", headers: { "content-type": "text/html" } })],
      [SUMMARY, () => ok({})],
    ])
    const r = await checkin(testCtx(f.fetch), account)
    expect(r.outcome).toBe("captcha")
    expect(r.message).toContain("WorkBuddy App")
  })

  test("401 everywhere asks to sign in again", async () => {
    const f = fakeFetch([
      [STATUS, () => ({ status: 401, text: "<html>401</html>" })],
      [SUMMARY, () => ({ status: 401, text: "<html>401</html>" })],
    ])
    expect((await checkin(testCtx(f.fetch), account)).outcome).toBe("failed")
  })

  test("a claim WorkBuddy says is still pending or failed is a failure to retry", async () => {
    for (const message of ["请求处理中，请勿重复操作", "签到失败，已签到天数不足 7 天"]) {
      const f = fakeFetch([
        [STATUS, () => ok({ active: true, today_checked_in: false })],
        [CLAIM, () => ok({ credit: 0, message })],
      ])
      expect((await checkin(testCtx(f.fetch), account)).outcome).toBe("failed")
    }
  })

  test("a transient billing failure is asked again twice", async () => {
    let n = 0
    const f = fakeFetch([
      [STATUS, () => ok({ active: true, today_checked_in: false })],
      [CLAIM, () => (++n < 3 ? { status: 502, text: "bad gateway" } : ok({ credit: 20, streak_days: 1 }))],
    ])
    expect(await checkin(testCtx(f.fetch), account)).toMatchObject({ outcome: "claimed", credit: 20 })
    expect(n).toBe(3)
  })

  test("the client version follows the community plugin's", async () => {
    Object.assign(CLIENTS.workbuddy, { app: "6.0.1", cli: "2.200.0" })
    try {
      const f = fakeFetch([[STATUS, () => ok({ active: false })], [`POST ${CN.chat}/v2/report`, () => ok(null)]])
      await checkin(testCtx(f.fetch), account)
      await report(testCtx(f.fetch), account, [{ eventCode: "heartbeat" }])
      expect(f.calls[0].headers["user-agent"]).toBe("WorkBuddy/6.0.1")
      expect(f.calls[1].headers["user-agent"]).toBe("WorkBuddy/6.0.1 WorkBuddy/6.0.1 CLI/2.200.0")
      expect(f.calls[1].headers["x-ide-version"]).toBe("6.0.1")
    } finally {
      Object.assign(CLIENTS.workbuddy, { app: "5.9.3", cli: "2.165.0" })
    }
  })

  test("11140 is ineligible and restricted", async () => {
    const f = fakeFetch([[STATUS, () => ({ status: 403, json: { code: 11140, msg: "request illegal", displayMsg: "账号存在异常行为，已被限制使用" } })]])
    const r = await checkin(testCtx(f.fetch), account)
    expect(r).toMatchObject({ outcome: "ineligible", restricted: true })
  })
})

function growthServer({ tasks, acceptFails = [] }) {
  const state = new Map(tasks.map((t) => [t.task_code, { ...t, progress: { ...(t.progress ?? { current: 0, target: 1 }) } }]))
  const reported = []
  const f = fakeFetch([
    [`GET ${CN.chat}/v2/activity/growth/tasks`, () => ok({ tasks: [...state.values()].map((t) => structuredClone(t)) })],
    [`POST ${CN.chat}/v2/activity/growth/tasks/accept`, ({ body }) => {
      const results = body.task_codes.map((c) => {
        if (acceptFails.includes(c)) return { task_code: c, status: "failed", message: "nope" }
        state.get(c).accept_status = "accepted"
        return { task_code: c, status: "accepted" }
      })
      return ok({ results })
    }],
    [`POST ${CN.chat}/v2/report`, ({ body }) => {
      for (const ev of body) {
        reported.push(ev)
        const map = { wbx_design_canvas_task_create: "create_canvas", expert_actual_use: ev.expertType === "team" ? "Expert_team_use_3" : "expert_5", skill_info: "skill_1" }
        const code = map[ev.eventCode]
        const t = code && state.get(code)
        if (t && (t.accept_status === "accepted" || t.task_type === "auto")) {
          const seen = (t.seen ??= new Set())
          const k = ev.id ?? ev.timestamp
          if (!seen.has(k)) {
            seen.add(k)
            t.progress.current++
            if (t.progress.current >= t.progress.target) t.accept_status = "completed"
          }
        }
      }
      return ok(null)
    }],
    [`POST ${CN.chat}/activity/growth/tasks/*`, ({ url }) => {
      const code = decodeURIComponent(url.split("/tasks/")[1].split("/")[0])
      const t = state.get(code)
      if (!t || t.progress.current < t.progress.target) return { status: 400, json: { code: 400, msg: "task not completed" } }
      t.accept_status = "claimed"
      return ok({ credit: t.reward_credit ?? 100 })
    }],
    [`POST ${CN.web}/activity/growth/tasks/*`, () => ({ status: 400, json: { code: 400, msg: "task not completed" } })],
  ])
  return { f, state, reported, delete: (c) => state.delete(c) }
}

describe("growth tasks", () => {
  test("accepts, reports distinct expert ids, and claims", async () => {
    const s = growthServer({
      tasks: [
        { task_code: "create_canvas", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 1 }, reward_credit: 300 },
        { task_code: "expert_5", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 5 }, reward_credit: 200 },
        { task_code: "Library_read", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 1 } },
        { task_code: "wb_wechat_oa_subscribe_task", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 1 } },
        { task_code: "skill_1", accept_status: "claimed", task_type: "single", progress: { current: 1, target: 1 } },
      ],
    })
    const notes = []
    const earned = await growth(testCtx(s.f.fetch), account, notes)
    expect(earned).toBe(500)
    expect(s.state.get("create_canvas").accept_status).toBe("claimed")
    expect(s.state.get("expert_5").accept_status).toBe("claimed")
    const experts = s.reported.filter((e) => e.eventCode === "expert_actual_use").map((e) => e.id)
    expect(new Set(experts).size).toBe(5)
    expect(s.reported.every((e) => e.userId === "100012345678")).toBe(true)
    expect(notes[0]).toContain("领奖 2 个 +500")
    expect(notes[0]).toContain("1 个需桌面端手动完成")
    expect(notes[0]).toContain("1 个需真人操作")
    const acceptCall = s.f.hits("POST", `${CN.chat}/v2/activity/growth/tasks/accept`)[0]
    expect(acceptCall.body.task_codes).not.toContain("wb_wechat_oa_subscribe_task")
  })

  test("the Valorant task reports its own expert", async () => {
    const s = growthServer({ tasks: [{ task_code: "WorkBuddy_Valorant", accept_status: "accepted", task_type: "single", progress: { current: 0, target: 1 } }] })
    await growth(testCtx(s.f.fetch), account, [])
    const ev = s.reported.find((e) => e.eventCode === "expert_actual_use")
    expect(ev).toMatchObject({ id: "ex_xQHHD1u5Jkua", name: "无畏契约拼豆专家" })
  })

  test("the theme task applies the theme for real, then reports it", async () => {
    const s = growthServer({ tasks: [{ task_code: "Hp_Appearance", accept_status: "accepted", task_type: "single", progress: { current: 0, target: 1 } }] })
    const base = s.f.fetch
    const order = []
    const f = fakeFetch([
      [`POST ${CN.web}/v2/operation-platform/appearance/resources`, () => (order.push("resources"), ok({ resources: [{ id: "theme-new", name: "和平精英冬季", vip_level: "free", series: "craft" }] }))],
      [`POST ${CN.web}/portal/user-asset/appearance/set`, ({ body }) => (order.push(`set ${body.resource_key}`), ok(null))],
      [`POST ${CN.chat}/v2/report`, (c) => (order.push("report"), base(c.url, { method: "POST", body: JSON.stringify(c.body) }))],
      [`GET ${CN.chat}/*`, (c) => base(c.url, { method: "GET" })],
      [`POST ${CN.chat}/*`, (c) => base(c.url, { method: "POST", body: JSON.stringify(c.body) })],
      [`POST ${CN.web}/*`, (c) => base(c.url, { method: "POST" })],
    ])
    await growth(testCtx(f.fetch), account, [])
    expect(order).toEqual(["resources", "set theme-new", "report"])
    expect(s.reported[0]).toMatchObject({ eventCode: "appearance_skin_apply", id: "theme-new", name: "和平精英冬季", type: "personal" })
    expect(f.hits("POST", `${CN.web}/portal/user-asset/appearance/set`)[0].headers["user-agent"]).toStartWith("WorkBuddy/")
  })

  test("the theme falls back to the known one when the catalog says nothing", async () => {
    const f = fakeFetch([[`POST ${CN.web}/*`, () => ok({ resources: [] })]])
    const { applyTheme } = await import("../src/cn.mjs")
    expect(await applyTheme(testCtx(f.fetch), account)).toEqual(THEME)
    expect(f.calls[1].body).toEqual({ kind: "theme", resource_key: THEME.id })
  })

  test("a task whose accept fails is not reported", async () => {
    const s = growthServer({
      tasks: [{ task_code: "create_canvas", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 1 } }],
      acceptFails: ["create_canvas"],
    })
    await growth(testCtx(s.f.fetch), account, [])
    expect(s.reported).toHaveLength(0)
  })

  test("work left when the budget runs out waits for the next run", async () => {
    const s = growthServer({
      tasks: [{ task_code: "create_canvas", accept_status: "accepted", task_type: "single", progress: { current: 0, target: 1 } }],
    })
    const notes = []
    await growth(testCtx(s.f.fetch, { budgetMs: 5000 }), account, notes)
    expect(s.reported).toHaveLength(0)
    expect(notes[0]).toContain("1 个留到下次")
  })
})

describe("cat travel", () => {
  test("claims an arrived trip and sends the next", async () => {
    let state = "arrived"
    const f = fakeFetch([
      [`GET ${CN.chat}/activity/growth/buddy/travel/status`, () => ok({ state, daily_limit_reached: false })],
      [`POST ${CN.chat}/activity/growth/buddy/travel/claim`, () => ((state = "idle"), ok({ reward_credit: 30 }))],
      [`GET ${CN.chat}/activity/growth/buddy/travel/config`, () => ok({ locations: [{ id: 7, name: "海边" }] })],
      [`POST ${CN.chat}/activity/growth/buddy/travel/depart`, ({ body }) => ((state = "traveling"), ok({ location: { id: body.location_id, name: "海边" } }))],
    ])
    const notes = []
    expect(await travel(testCtx(f.fetch), account, notes)).toBe(30)
    expect(notes).toEqual(["猫猫旅行归来 +30", "猫猫出发去「海边」"])
    expect(f.hits("POST", `${CN.chat}/activity/growth/buddy/travel/depart`)[0].body).toEqual({ location_id: 7 })
  })

  test("no buddy yet: completes first_buddy then departs", async () => {
    let buddy = false
    const s = growthServer({ tasks: [{ task_code: "first_buddy", accept_status: "not_accepted", task_type: "auto", progress: { current: 1, target: 1 } }] })
    const base = s.f.fetch
    const f = fakeFetch([
      [`GET ${CN.chat}/activity/growth/buddy/travel/status`, () => ok({ state: "idle" })],
      [`GET ${CN.chat}/activity/growth/buddy/travel/config`, () => ok({ locations: [] })],
      [`POST ${CN.chat}/activity/growth/buddy/travel/depart`, () => (buddy ? ok({ location: { name: "森林" } }) : { status: 400, json: { code: 400, msg: "no active buddy" } })],
      [`POST ${CN.chat}/activity/growth/tasks/first_buddy/claim`, () => ((buddy = true), ok({ credit: 300 }))],
      [`GET ${CN.chat}/*`, (c) => base(c.url, { method: "GET" })],
    ])
    const notes = []
    await travel(testCtx(f.fetch), account, notes)
    expect(buddy).toBe(true)
    expect(notes.at(-1)).toBe("猫猫出发去「森林」")
  })

  test("today's trip done leaves it", async () => {
    const f = fakeFetch([[`GET ${CN.chat}/activity/growth/buddy/travel/status`, () => ok({ state: "idle", daily_limit_reached: true })]])
    const notes = []
    await travel(testCtx(f.fetch), account, notes)
    expect(notes).toEqual(["猫猫今天已旅行过"])
    expect(f.calls).toHaveLength(1)
  })
})

describe("energy blind box", () => {
  test("opens as many as the energy pays for, up to one call's limit", async () => {
    const f = fakeFetch([
      [`GET ${CN.chat}/v2/activity/growth/buddy/quota`, () => ok({ affordable: 3, max_open_count: 2, balance: 34 })],
      [`POST ${CN.chat}/v2/activity/growth/buddy/open`, () => ok({ results: [{ instance: { name: "橘猫" } }, { template: { name: "黑猫" } }] })],
    ])
    const notes = []
    await blindbox(testCtx(f.fetch), account, notes)
    expect(f.hits("POST", `${CN.chat}/v2/activity/growth/buddy/open`)[0].body).toMatchObject({ count: 2 })
    expect(notes).toEqual(["盲盒开了 2 个：橘猫、黑猫"])
  })

  test("not enough energy opens nothing and says nothing", async () => {
    const f = fakeFetch([[`GET ${CN.chat}/v2/activity/growth/buddy/quota`, () => ok({ affordable: 0, balance: 4 })]])
    const notes = []
    await blindbox(testCtx(f.fetch), account, notes)
    expect(f.calls).toHaveLength(1)
    expect(notes).toEqual([])
  })
})

describe("streak keeper", () => {
  test("makes up yesterday, redeems an open tier, draws all chances", async () => {
    const f = fakeFetch([
      [`GET ${CN.chat}/activity/growth/heatmap`, () => ok({ cells: [{ date: "2026-10-19", score: 0 }] })],
      [`GET ${CN.chat}/activity/growth/streak`, () => ok({ streak: { days: 6 }, makeup_cards: { balance: 1 }, redemption_status: { tiers: [{ tier: "7d" }, { tier: "14d" }], tier_7d_status: "available", tier_14d_status: "locked" } })],
      [`POST ${CN.chat}/activity/growth/makeup-cards/use`, () => ok({})],
      [`POST ${CN.billing}/billing/meter/claim-gift`, () => ({ status: 400, json: { code: 1, msg: "claimed" } })],
      [`POST ${CN.billing}/billing/meter/claim-compensation`, () => ({ status: 400, json: { code: 1, msg: "none" } })],
      [`POST ${CN.chat}/activity/growth/redeem`, () => ok({})],
      [`GET ${CN.chat}/activity/growth/lottery/summary`, () => ok({ chances: 2 })],
      [`POST ${CN.chat}/activity/growth/lottery/draw`, () => ok({})],
    ])
    const notes = []
    await streakBonus(testCtx(f.fetch), account, notes, "2026-10-20")
    expect(notes[0]).toBe("连登：补签 2026-10-19，兑换连登 7d，抽奖 2 次")
    expect(f.hits("POST", `${CN.chat}/activity/growth/makeup-cards/use`)[0].body).toEqual({ target_date: "2026-10-19" })
    const gift = f.hits("POST", `${CN.billing}/billing/meter/claim-gift`)[0].headers
    expect(gift["x-machine-id"]).toBe("79143cdd-992c-45fb-a8fd-eae1725319e4")
  })
})

function dayServer() {
  const s = growthServer({
    tasks: [
      { task_code: "black_cat", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 3 } },
      { task_code: "skill_1", accept_status: "not_accepted", task_type: "single", progress: { current: 0, target: 1 } },
    ],
  })
  const base = s.f.fetch
  const f = fakeFetch([
    [STATUS, () => ok({ active: true, today_checked_in: false, streak_days: 1 })],
    [CLAIM, () => ok({ credit: 10, streak_days: 2 })],
    [`GET ${CN.chat}/activity/growth/buddy/travel/status`, () => ok({ state: "traveling" })],
    [`GET ${CN.chat}/activity/growth/heatmap`, () => ok({ cells: [] })],
    [`GET ${CN.chat}/activity/growth/streak`, () => ok({ streak: { days: 2 } })],
    [`GET ${CN.chat}/activity/growth/lottery/summary`, () => ok({ chances: 0 })],
    [`POST ${CN.billing}/*`, () => ({ status: 400, json: { code: 1 } })],
    [`POST ${CN.chat}/v2/report`, (c) => {
      for (const ev of c.body) if (ev.mode === "night") s.state.get("black_cat").progress.current++
      return base(c.url, { method: "POST", body: JSON.stringify(c.body) })
    }],
    [`GET ${CN.chat}/*`, (c) => base(c.url, { method: "GET" })],
    [`POST ${CN.chat}/*`, (c) => base(c.url, { method: "POST", body: JSON.stringify(c.body) })],
  ])
  return { s, f }
}

describe("a day's run", () => {
  test("checks in, reports once a day, travels, does night owl only at night", async () => {
    const { s, f } = dayServer()
    const rec = {}
    const day = await runCN(testCtx(f.fetch), account, { rec, day: "2026-10-20" })
    expect(day.outcome).toBe("claimed")
    expect(day.credit).toBe(10)
    expect(day.message).toContain("活跃上报 ✓ 连登 2 天")
    expect(day.message).toContain("猫猫旅行途中")
    expect(day.message).not.toContain("夜猫子")
    expect(s.state.get("skill_1").accept_status).toBe("claimed")
    expect(day.message).not.toContain("ACCESS-SECRET-TOKEN")
    const reports = () => s.reported.filter((e) => e.eventCode === "chat_request_send" && e.mode === "craft").length
    expect(reports()).toBe(1)
    await runCN(testCtx(f.fetch), account, { rec, day: "2026-10-20" })
    expect(reports()).toBe(1)

    const nightRec = {}
    const r = await runCN(testCtx(f.fetch, { now: Date.parse("2026-10-20T16:30:00Z") }), account, { rec: nightRec, day: "2026-10-21" })
    expect(r.message).toContain("夜猫子 1/3")
    expect(nightRec.done.night).toBe(true)
  })

  test("travel and growth wait three hours before they run again", async () => {
    const { f } = dayServer()
    const rec = {}
    const ctx = testCtx(f.fetch)
    await runCN(ctx, account, { rec, day: "2026-10-20" })
    const travels = () => f.hits("GET", `${CN.chat}/activity/growth/buddy/travel/status`).length
    const lists = () => f.hits("GET", `${CN.chat}/v2/activity/growth/tasks`).length
    const [t0, l0] = [travels(), lists()]
    await runCN(testCtx(f.fetch, { now: ctx.now() + 30 * 60 * 1000 }), account, { rec, day: "2026-10-20" })
    expect([travels(), lists()]).toEqual([t0, l0])
    await runCN(testCtx(f.fetch, { now: ctx.now() + RERUN_MS }), account, { rec, day: "2026-10-20" })
    expect(travels()).toBe(t0 + 1)
    expect(lists()).toBeGreaterThan(l0)
  })

  test("options turn steps off", async () => {
    const { s, f } = dayServer()
    const r = await runCN(testCtx(f.fetch), account, { rec: {}, option: (k) => k === "travel" })
    expect(r.message).toContain("猫猫旅行途中")
    expect(s.reported).toHaveLength(0)
  })

  test("enterprise accounts only check in", async () => {
    const { f } = dayServer()
    const r = await runCN(testCtx(f.fetch), { ...account, enterpriseId: "ent-1" }, { rec: {} })
    expect(r.message).toContain("企业账号")
    expect(f.calls.every((c) => c.url.includes("/billing/meter/"))).toBe(true)
    expect(f.calls[0].headers["x-enterprise-id"]).toBe("ent-1")
  })

  test("11140 during the tasks stops everything for the day", async () => {
    const f = fakeFetch([
      [STATUS, () => ok({ active: true, today_checked_in: true, streak_days: 1 })],
      [`POST ${CN.chat}/v2/report`, () => ({ status: 403, json: { code: 11140, msg: "request illegal" } })],
      [`GET ${CN.chat}/*`, () => ok({})],
    ])
    const rec = {}
    const r = await runCN(testCtx(f.fetch), account, { rec, day: "2026-10-20" })
    expect(r.outcome).toBe("done")
    expect(r.message).toContain("11140")
    expect(rec.restricted).toBe("2026-10-20")
    const n = f.calls.length
    await runCN(testCtx(f.fetch), account, { rec, day: "2026-10-20" })
    expect(f.calls.length).toBe(n + 1)
  })
})
