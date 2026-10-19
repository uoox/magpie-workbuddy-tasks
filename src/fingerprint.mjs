import { createHash } from "node:crypto"

export function deriveId(uid, salt) {
  const h0 = createHash("md5").update(`${salt}:${uid || "anonymous"}`, "utf8").digest("hex")
  const h = h0.slice(0, 12) + "4" + h0.slice(13, 16) + "a" + h0.slice(17)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export const machineId = (uid) => deriveId(uid, "machine")

export const sessionId = (uid) => deriveId(uid, "session")
