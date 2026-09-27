/**
 * "Go remote": a Cloudflare quick tunnel this server opens on demand, so the
 * host can hand out a public link from the board itself (like Excalidraw's
 * "Start session"). One tunnel per server; it closes when the server stops.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type Tunnel = { url: string; target: string; proc: ReturnType<typeof Bun.spawn> }

let current: Tunnel | null = null
let starting: Promise<string> | null = null

export const cloudflaredPath = () =>
  [Bun.which("cloudflared"), join(homedir(), ".local/bin/cloudflared")].find((p): p is string => !!p && existsSync(p)) ?? null

export const publicUrl = () => current?.url ?? null

/** Close the tunnel (on shutdown, or before re-opening). */
export function closeTunnel() {
  current?.proc.kill()
  current = null
}
for (const sig of ["SIGINT", "SIGTERM", "exit"] as const) process.on(sig, closeTunnel)

/**
 * Open a quick tunnel to `target` (e.g. http://localhost:3000) and resolve
 * with its public https URL once it answers. Reuses an open one.
 */
export function openTunnel(target: string): Promise<string> {
  if (current && current.target === target && current.proc.exitCode === null) return Promise.resolve(current.url)
  if (starting) return starting
  const bin = cloudflaredPath()
  if (!bin) return Promise.reject(new Error("cloudflared isn't installed on the host"))
  starting = (async () => {
    closeTunnel()
    const proc = Bun.spawn([bin, "tunnel", "--no-autoupdate", "--url", target], { stdout: "ignore", stderr: "pipe" })
    const reader = proc.stderr.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const deadline = Date.now() + 45_000
    let url: string | null = null
    while (!url && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value)
      url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buffer)?.[0] ?? null
    }
    // Keep draining its log so the pipe never fills.
    void (async () => {
      for (;;) if ((await reader.read()).done) break
    })().catch(() => {})
    if (!url) {
      proc.kill()
      throw new Error("the tunnel didn't come up")
    }
    current = { url, target, proc }
    // A new hostname takes a moment to route: wait until it answers, but not forever (other
    // devices usually reach it before this machine's DNS does).
    const until = Date.now() + 20_000
    while (Date.now() < until) {
      if (await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false)) break
      await Bun.sleep(1000)
    }
    void proc.exited.then(() => {
      if (current?.proc === proc) current = null
    })
    return url
  })().finally(() => {
    starting = null
  })
  return starting
}
