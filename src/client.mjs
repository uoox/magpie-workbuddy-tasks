import { hex } from "./util.mjs"

export const CLIENTS = {
  workbuddy: { app: "5.9.3", cli: "2.165.0", appName: "WorkBuddy", endpoint: "https://copilot.tencent.com" },
  "workbuddy-ai": { app: "5.9.3", cli: "2.165.0", appName: "workbuddy-ai", endpoint: "https://www.workbuddy.ai" },
}

export function useClient(id, site) {
  const c = CLIENTS[id]
  for (const k of ["app", "cli", "appName"]) if (typeof site?.[k] === "string" && site[k]) c[k] = site[k]
}

export function cliAgent(id) {
  const c = CLIENTS[id]
  return `WorkBuddy/${c.app} ${c.appName}/${c.app} CLI/${c.cli}`
}

export function enterpriseHeaders(a) {
  const id = typeof a?.enterpriseId === "string" ? a.enterpriseId.trim() : ""
  return id ? { "X-Enterprise-Id": id, "X-Tenant-Id": id } : {}
}

const domainOf = (id, a) => a.domain || new URL(CLIENTS[id].endpoint).host

export function meterHeaders(id, a) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "WorkBuddy/" + CLIENTS[id].app,
    Authorization: "Bearer " + a.access,
    "X-User-Id": a.uid ?? "",
    "X-Domain": domainOf(id, a),
    "X-Product": "SaaS",
    "X-IDE-Type": "WorkBuddy",
    ...enterpriseHeaders(a),
  }
}

export function clientHeaders(id, a) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "X-Agent-Intent": "craft",
    "X-Agent-Purpose": "conversation",
    "X-Agent-Type": "main",
    "X-IDE-Name": "WorkBuddy",
    "X-IDE-Type": "WorkBuddy",
    "X-IDE-Version": CLIENTS[id].app,
    "X-Private-Data": "true",
    "X-Product": "SaaS",
    "X-Domain": domainOf(id, a),
    "User-Agent": cliAgent(id),
    "X-User-Id": a.uid ?? "",
    Authorization: "Bearer " + a.access,
    "X-Request-ID": hex(),
  }
}
