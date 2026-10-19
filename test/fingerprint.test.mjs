import { describe, expect, test } from "bun:test"
import { deriveId, machineId, sessionId } from "../src/fingerprint.mjs"
import { billingHeaders } from "../src/cn.mjs"
import { account } from "./fake.mjs"

describe("derive_id", () => {
  test("matches wb-proxy's wb_fingerprint.derive_id", () => {
    expect(machineId("100012345678")).toBe("79143cdd-992c-45fb-a8fd-eae1725319e4")
    expect(sessionId("100012345678")).toBe("32914172-92c7-485b-a02c-6338ac4fdbfd")
    expect(deriveId("", "machine")).toBe("fc1f3f60-3c8b-4dc0-a839-42ea0169ab1e")
  })

  test("is stable per account and differs across accounts", () => {
    expect(machineId("a")).toBe(machineId("a"))
    expect(machineId("a")).not.toBe(machineId("b"))
    expect(machineId("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test("billing headers carry the derived device ids", () => {
    const h = billingHeaders(account)
    expect(h["X-Machine-ID"]).toBe("79143cdd-992c-45fb-a8fd-eae1725319e4")
    expect(h["X-Session-ID"]).toBe("32914172-92c7-485b-a02c-6338ac4fdbfd")
    expect(h["X-No-Enterprise-Id"]).toBe("1")
    expect(billingHeaders({ ...account, enterpriseId: "e1" })["X-Enterprise-Id"]).toBe("e1")
  })
})
