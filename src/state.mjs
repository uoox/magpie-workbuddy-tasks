import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

function read(path) {
  try {
    const d = JSON.parse(readFileSync(path, "utf8"))
    return d && typeof d === "object" && !Array.isArray(d) ? d : {}
  } catch {
    return {}
  }
}

export function record(path, key) {
  const rec = { ...(read(path)[key] ?? {}) }
  return {
    rec,
    save() {
      if (!path) return
      try {
        const all = read(path)
        all[key] = rec
        mkdirSync(dirname(path), { recursive: true })
        const tmp = `${path}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 })
        renameSync(tmp, path)
      } catch {}
    },
  }
}
