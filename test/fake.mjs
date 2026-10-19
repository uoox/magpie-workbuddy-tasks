export function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase()
    const u = String(url)
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    let body
    try {
      body = init.body === undefined ? undefined : JSON.parse(init.body)
    } catch {
      body = init.body
    }
    const call = { method, url: u, headers, body, signal: init.signal }
    calls.push(call)
    for (const [pattern, handler] of routes) {
      const [m, p] = pattern.split(" ")
      if (m !== method) continue
      if (p.endsWith("*") ? u.startsWith(p.slice(0, -1)) : u === p) {
        const out = await handler(call, calls)
        if (out instanceof Response) return out
        const { status = 200, json, text, headers: h } = out ?? {}
        return new Response(text ?? JSON.stringify(json ?? { code: 0, data: null }), { status, headers: h ?? { "content-type": "application/json" } })
      }
    }
    return new Response(JSON.stringify({ code: 404, msg: "no route " + method + " " + u }), { status: 404 })
  }
  return { fetch, calls, hits: (m, p) => calls.filter((c) => c.method === m && (p.endsWith("*") ? c.url.startsWith(p.slice(0, -1)) : c.url === p)) }
}

export const ok = (data) => ({ json: { code: 0, msg: "ok", data } })

export function testCtx(fetch, { now = Date.parse("2026-10-20T04:00:00Z"), budgetMs = 600000 } = {}) {
  let t = now
  return {
    fetch,
    sleep: async (ms) => {
      t += ms
    },
    now: () => t,
    random: () => 0,
    gap: 1000,
    deadline: now + budgetMs,
    left() {
      return this.deadline - t
    },
    advance(ms) {
      t += ms
    },
  }
}

export const account = { type: "oauth", access: "ACCESS-SECRET-TOKEN", refresh: "REFRESH-SECRET", expires: 0, uid: "100012345678", domain: "copilot.tencent.com" }
