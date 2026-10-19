import { describe, expect, test } from "bun:test"
import { INTL, runIntl } from "../src/intl.mjs"
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

function server({ finishAfter = 2, create } = {}) {
  let polls = 0
  const rpcs = []
  const f = fakeFetch([
    [`POST ${INTL.origin}/console/as/conversations/`, create ?? (() => ok({ id: "conv-1" }))],
    [`GET ${INTL.origin}/console/as/conversations/conv-1/session`, () => ok({ link: LINK, token: "SANDBOX-TOKEN", sessionId: "sess-1", cwd: "/workspace" })],
    [`GET ${INTL.origin}/console/as/conversations/conv-1`, () => ok({ status: ++polls >= finishAfter ? "completed" : "working" })],
    [`GET ${LINK}`, ({ signal }) => new Response(sse(signal), { status: 200, headers: { "Acp-Connection-Id": "conn-9", "content-type": "text/event-stream" } })],
    [`POST ${LINK}`, ({ body, headers }) => {
      rpcs.push({ method: body.method, conn: headers["acp-connection-id"], params: body.params })
      return { status: 202, text: "" }
    }],
  ])
  return { f, rpcs }
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
    const create = f.calls[0]
    expect(create.body).toMatchObject({ prompt: "Hi", model: "deepseek-v4.1-flash", conversationOrigin: "workbuddy-app" })
    expect(create.headers.origin).toBe(INTL.origin)
    expect(rec.intl).toBe("2026-10-20")
    const n = f.calls.length
    expect((await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })).outcome).toBe("done")
    expect(f.calls.length).toBe(n)
  })

  test("a session that never finishes is a failure to retry", async () => {
    const { f } = server({ finishAfter: 1e9 })
    const rec = {}
    const r = await runIntl(testCtx(f.fetch, { budgetMs: 20000 }), account, { rec, day: "2026-10-20" })
    expect(r.outcome).toBe("failed")
    expect(rec.intl).toBeUndefined()
  })

  test("11140 rests the account for the day", async () => {
    const { f } = server({ create: () => ({ status: 403, json: { code: 11140, msg: "request illegal" } }) })
    const rec = {}
    expect((await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })).outcome).toBe("ineligible")
    expect((await runIntl(testCtx(f.fetch), account, { rec, day: "2026-10-20" })).outcome).toBe("ineligible")
    expect(f.calls).toHaveLength(1)
  })

  test("the option off leaves it alone", async () => {
    const { f } = server()
    expect((await runIntl(testCtx(f.fetch), account, { option: () => false })).outcome).toBe("ineligible")
    expect(f.calls).toHaveLength(0)
  })
})
