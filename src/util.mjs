import { createHash, randomUUID } from "node:crypto"

export const num = (v) => {
  const n = typeof v === "number" ? v : Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export const hex = () => randomUUID().replaceAll("-", "")

export const uuid = () => randomUUID()

const BEIJING_MS = 8 * 3600 * 1000

export const dayOf = (ms) => new Date(ms + BEIJING_MS).toISOString().slice(0, 10)

export const inNight = (ms) => {
  const h = new Date(ms + BEIJING_MS).getUTCHours()
  return h >= 23 || h < 8
}

export const short = (e, n = 120) => String(e?.message ?? e ?? "").replace(/\s+/g, " ").slice(0, n)

export const hashOf = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16)

export function makeCtx({
  fetch = (...x) => globalThis.fetch(...x),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  random = Math.random,
  budgetMs,
  gap = 1000,
} = {}) {
  const deadline = now() + budgetMs
  return { fetch, sleep, now, random, gap, deadline, left: () => deadline - now() }
}
