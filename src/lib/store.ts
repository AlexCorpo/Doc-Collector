import fs from "fs"
import path from "path"
import { Issuer } from "./types"

const DATA_FILE = path.join(process.cwd(), "data", "issuers.json")

function ensureDir() {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function readIssuers(): Issuer[] {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"))
  } catch {
    return []
  }
}

export function writeIssuers(issuers: Issuer[]): void {
  ensureDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(issuers, null, 2), "utf-8")
}
