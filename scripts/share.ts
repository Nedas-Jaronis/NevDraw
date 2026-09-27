/**
 * bun run share: build the web app, start the production server on one
 * port, have it open a Cloudflare quick tunnel to itself, and print the
 * public link and a QR code. Ctrl+C stops both. The link changes each time the tunnel
 * restarts, so leave this running while people are on the board.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import QRCode from "qrcode"

const root = join(import.meta.dir, "..")
const port = Number(process.env.PORT) || 3000

const cloudflared = [Bun.which("cloudflared"), join(homedir(), ".local/bin/cloudflared")].find((p) => p && existsSync(p))
if (!cloudflared) {
  console.error(
    "cloudflared isn't installed. Install it once:\n" +
      "  curl -fsSL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared",
  )
  process.exit(1)
}

console.log("› building the web app…")
const build = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "ignore", stderr: "inherit" })
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)

console.log(`› starting the server on :${port}…`)
const envFile = join(root, ".env")
const server = Bun.spawn(["bun", ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), "apps/server/src/main.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdout: "inherit",
  stderr: "inherit",
})

// Wait until it answers before opening the tunnel.
for (let i = 0; i < 60; i++) {
  const ok = await fetch(`http://localhost:${port}/`).then((r) => r.ok).catch(() => false)
  if (ok) break
  await Bun.sleep(500)
}

console.log("› opening a Cloudflare tunnel…")
// The server owns the tunnel (the same one "Go remote" in the profile menu opens).
const body = await fetch(`http://localhost:${port}/api/session/remote`, { method: "POST" })
  .then((r) => r.json() as Promise<{ publicUrl?: string; error?: string }>)
  .catch((e: unknown) => ({ publicUrl: undefined, error: e instanceof Error ? e.message : String(e) }))
if (!body.publicUrl) {
  // Never leave the server (and its tunnel) running behind a failed share.
  console.error(`Couldn't open the tunnel: ${body.error ?? "unknown error"}`)
  server.kill()
  process.exit(1)
}
const url = body.publicUrl

const stop = () => {
  server.kill()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)

console.log(`\n  Live Wireframes is public at:\n\n    ${url}\n`)
console.log(await QRCode.toString(url, { type: "terminal", small: true }))
console.log("  Share that link (or the QR). Each board's own link also has a QR under Share.")
console.log("  Leave this running; Ctrl+C stops the server and the tunnel.")
console.log("  (A brand-new link can take a minute to resolve on this machine; other devices usually get it right away.)\n")
await server.exited
