import { describe, expect, test } from "bun:test"
import { ACTIVE_LIMIT, INTL, runIntl } from "../src/intl.mjs"
import { account, fakeFetch, ok, testCtx } from "./fake.mjs"

const LINK = "https://sandbox.example/acp/s1"

function sse(signal) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode('data: {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk"}}}\n'))
      c.enqueue(enc.encode('data: {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk"}}}\n'))
      signal?.addEventListener("abort", () => {
        try {
          c.close()
        } catch {}
      })
    },
  })
}

const C = `${INTL.origin}/console/as/conversations/`

function server({ finishAfter = 2, create, list = [] } = {}) {
  let polls = 0
  const rpcs = []
  const acts = []
  const f = fakeFetch([
    [`GET ${C}?page=1&pageSize=50`, () => ok({ conversations: list })],
    [`POST ${C}`, create ?? (() => ok({ id: "conv-1" }))],
    [`POST ${C}*`, ({ url }) => {
      const [id, action] = url.slice(C.length).split("/")
      acts.push(`${action} ${id}`)
      return ok(null)
    }],
    [`GET ${INTL.origin}/console/as/conversations/conv-1/session`, () => ok({ link: LINK, token: "SANDBOX-TOKEN", sessionId: "sess-1", cwd: "/workspace" })],
    [`GET ${INTL.origin}/console/as/conversations/conv-1`, () => ok({ status: ++polls >= finishAfter ? "completed" : "working" })],
    [`GET ${LINK}`, ({ signal }) => new Response(sse(signal), { status: 200, headers: { "Acp-Connection-Id": "conn-9", "content-type": "text/event-stream" } })],
    [`POST ${LINK}`, ({ body, headers }) => {
      rpcs.push({ method: body.method, conn: headers["acp-connection-id"], params: body.params })
      return { status: 202, text: "" }
    }],
  ])
  return { f, rpcs, acts }
}

describe("international daily active", () => {
  test("runs a web session to completed, once a day", async () => {
    const { f, rpcs } = server()
    const rec = {}
    const r = await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })
    expect(r.outcome).toBe("claimed")
    expect(r.message).toContain("2 段输出")
    expect(rpcs.map((x) => x.method)).toEqual(["initialize", "session/load", "session/set_model", "session/prompt"])
    expect(rpcs.every((x) => x.conn === "conn-9")).toBe(true)
    expect(rpcs[2].params).toEqual({ sessionId: "sess-1", modelId: "deepseek-v4.1-flash" })
    const create = f.hits("POST", C)[0]
    expect(create.body).toMatchObject({ prompt: "Hi", model: "deepseek-v4.1-flash", conversationOrigin: "workbuddy-app" })
    expect(create.headers.origin).toBe(INTL.origin)
    expect(rec.intl).toBe("2026-10-20")
    const n = f.calls.length
    expect((await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })).outcome).toBe("done")
    expect(f.calls.length).toBe(n)
  })

  test("a finished session is stopped, so it frees its active slot", async () => {
    const { f, acts } = server()
    await runIntl(testCtx(f.fetch), account, { rec: {}, day: "2026-10-20" })
    expect(acts).toEqual(["stop conv-1"])
  })

  test("a session that never finishes is a failure to retry, and is deleted", async () => {
    const { f, acts } = server({ finishAfter: 1e9 })
    const rec = {}
    const r = await runIntl(testCtx(f.fetch, { budgetMs: 20000 }), account, { rec, day: "2026-10-20" })
    expect(r.outcome).toBe("failed")
    expect(rec.intl).toBeUndefined()
    expect(acts).toEqual(["stop conv-1", "delete conv-1"])
  })

  test("a full account stops the oldest of its own sessions and creates again", async () => {
    const list = Array.from({ length: ACTIVE_LIMIT }, (_, i) => ({ id: `old-${i}`, name: i === 0 ? "帮我写个周报" : "Hi", status: "working", createdAt: new Date(Date.parse("2026-10-20T03:59:00Z") - (ACTIVE_LIMIT - i) * 1000).toISOString() }))
    let tries = 0
    const { f, acts } = server({
      list,
      create: () => (++tries === 1 ? { status: 429, json: { code: 10105, msg: "CreateConversation: 10105:you have reached the maximum number of active conversations(10)" } } : ok({ id: "conv-1" })),
    })
    const r = await runIntl(testCtx(f.fetch), account, { rec: {}, day: "2026-10-20" })
    expect(r.outcome).toBe("claimed")
    expect(acts).toEqual(["stop old-1", "stop old-2", "stop conv-1"])
  })

  test("a full account with none of its own sessions to stop says what to do", async () => {
    const list = Array.from({ length: ACTIVE_LIMIT }, (_, i) => ({ id: `u-${i}`, name: `真实对话 ${i}`, status: "working", createdAt: "2026-10-01T00:00:00Z" }))
    const { f, acts } = server({ list, create: () => ({ status: 429, json: { code: 10105, msg: "maximum number of active conversations(10)" } }) })
    const r = await runIntl(testCtx(f.fetch), account, { rec: {}, day: "2026-10-20" })
    expect(r.outcome).toBe("failed")
    expect(r.message).toContain("网页端结束旧对话")
    expect(acts).toEqual([])
    expect(f.hits("POST", C)).toHaveLength(1)
  })

  test("sessions an earlier run left working over half an hour are stopped first", async () => {
    const list = [
      { id: "stale", name: "Hi", status: "working", createdAt: "2026-10-20T02:00:00Z" },
      { id: "recent", name: "Hi", status: "working", createdAt: "2026-10-20T03:50:00Z" },
      { id: "theirs", name: "帮我写个周报", status: "working", createdAt: "2026-10-19T02:00:00Z" },
      { id: "done", name: "Hi", status: "completed", createdAt: "2026-10-19T02:00:00Z" },
    ]
    const { f, acts } = server({ list })
    await runIntl(testCtx(f.fetch), account, { rec: {}, day: "2026-10-20" })
    expect(acts).toEqual(["stop stale", "stop conv-1"])
  })

  test("a session the server renamed is still known as this plugin's by its id", async () => {
    const list = [{ id: "renamed", name: "Start new session", status: "working", createdAt: "2026-10-19T02:00:00Z" }]
    const { f, acts } = server({ list })
    const rec = { convs: ["renamed"] }
    await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })
    expect(acts).toEqual(["stop renamed", "stop conv-1"])
    expect(rec.convs).toEqual(["renamed", "conv-1"])
  })

  test("a create that fails upstream is asked once more", async () => {
    let tries = 0
    const { f } = server({ create: () => (++tries === 1 ? { status: 502, text: "bad gateway" } : ok({ id: "conv-1" })) })
    expect((await runIntl(testCtx(f.fetch), account, { rec: {}, day: "2026-10-20" })).outcome).toBe("claimed")
    expect(tries).toBe(2)
  })

  test("the random prompt option sends a pool line instead of Hi", async () => {
    const { f } = server()
    await runIntl(testCtx(f.fetch), account, { rec: {}, day: "2026-10-20", option: () => true })
    const prompt = f.hits("POST", C)[0].body.prompt
    expect(prompt).not.toBe("Hi")
    expect(prompt.length).toBeLessThanOrEqual(30)
  })

  test("11140 rests the account for the day", async () => {
    const { f } = server({ create: () => ({ status: 403, json: { code: 11140, msg: "request illegal" } }) })
    const rec = {}
    expect((await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })).outcome).toBe("ineligible")
    expect((await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })).outcome).toBe("ineligible")
    expect(f.hits("POST", C)).toHaveLength(1)
  })

  test("the option off leaves it alone", async () => {
    const { f } = server()
    expect((await runIntl(testCtx(f.fetch), account, { option: () => false })).outcome).toBe("ineligible")
    expect(f.calls).toHaveLength(0)
  })
})
