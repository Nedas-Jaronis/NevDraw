import { afterEach, beforeEach, expect, test } from "bun:test"
import { startServer } from "./helpers.ts"

let server: Awaited<ReturnType<typeof startServer>>
beforeEach(async () => {
  server = await startServer()
})
afterEach(async () => {
  await server.stop()
})

test("the host (on this machine) sees the session and may go remote", async () => {
  const s = (await (await fetch(`${server.httpUrl}/api/session`)).json()) as { publicUrl: string | null; host: boolean }
  expect(s.host).toBe(true)
  expect(s.publicUrl).toBeNull()
})

test("people arriving through the tunnel aren't the host and can't open one", async () => {
  const cf = { "cf-connecting-ip": "203.0.113.7", "cf-ray": "abc" }
  const s = (await (await fetch(`${server.httpUrl}/api/session`, { headers: cf })).json()) as { host: boolean; canGoRemote: boolean }
  expect(s).toMatchObject({ host: false, canGoRemote: false })
  const r = await fetch(`${server.httpUrl}/api/session/remote`, { method: "POST", headers: cf })
  expect(r.status).toBe(403)
})
