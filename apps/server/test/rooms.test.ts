import { Join, MoveCursor } from "@rtw/shared"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { is, startServer, TestClient } from "./helpers.ts"

let server: Awaited<ReturnType<typeof startServer>>
const clients: TestClient[] = []

beforeEach(async () => {
  server = await startServer()
})
afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await server.stop()
})

async function join(room: string, name: string, color = "#e11d48") {
  const c = await TestClient.connect(server.url, room)
  clients.push(c)
  c.send(new Join({ name, color }))
  const welcome = await c.waitFor(is("Welcome"))
  return { c, selfId: welcome.selfId, welcome }
}

test("joining returns a welcome listing everyone already in the room", async () => {
  const a = await join("r1", "Ada")
  expect(a.welcome.users.map((u) => u.name)).toEqual(["Ada"])

  const b = await join("r1", "Bo", "#2563eb")
  expect(b.welcome.users.map((u) => u.name).sort()).toEqual(["Ada", "Bo"])

  const joined = await a.c.waitFor(is("UserJoined"))
  expect(joined.user).toMatchObject({ id: b.selfId, name: "Bo", color: "#2563eb" })
})

test("cursor moves are broadcast to others in board coordinates", async () => {
  const a = await join("r1", "Ada")
  const b = await join("r1", "Bo")

  a.c.send(new MoveCursor({ cursor: { x: 120, y: -40 } }))
  const moved = await b.c.waitFor(is("CursorMoved"))
  expect(moved).toMatchObject({ id: a.selfId, cursor: { x: 120, y: -40 } })

  // A late joiner sees the last known cursor in the snapshot.
  await Bun.sleep(20)
  const c = await join("r1", "Cy")
  expect(c.welcome.users.find((u) => u.id === a.selfId)?.cursor).toEqual({ x: 120, y: -40 })
})

test("disconnecting broadcasts UserLeft", async () => {
  const a = await join("r1", "Ada")
  const b = await join("r1", "Bo")
  b.c.close()
  const left = await a.c.waitFor(is("UserLeft"))
  expect(left.id).toBe(b.selfId)
})

test("rooms are isolated", async () => {
  const a = await join("r1", "Ada")
  await join("r2", "Bo")
  a.c.send(new MoveCursor({ cursor: { x: 1, y: 1 } }))
  await Bun.sleep(50)
  expect(a.c.received.some((m) => m._tag === "UserJoined")).toBe(false)
})

test("malformed messages are ignored without dropping the connection", async () => {
  const a = await join("r1", "Ada")
  const b = await join("r1", "Bo")
  a.c.ws.send("not json")
  a.c.ws.send(JSON.stringify({ _tag: "Nope" }))
  a.c.send(new MoveCursor({ cursor: { x: 5, y: 5 } }))
  const moved = await b.c.waitFor(is("CursorMoved"))
  expect(moved.cursor).toEqual({ x: 5, y: 5 })
})

test("unknown paths fall back to the web app (or a build hint)", async () => {
  const res = await fetch(`${server.httpUrl}/b/some-room`)
  expect([200, 503]).toContain(res.status)
})
