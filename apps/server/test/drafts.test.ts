import { Commit, Discard, Join, SetInput } from "@rtw/shared"
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join as joinPath } from "node:path"
import { makeMemoryStore, sqliteStore } from "../src/BoardStore.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function boot(store = makeMemoryStore()) {
  const server = await startServer({ store })
  cleanups.push(() => server.stop())
  return server
}

async function join(url: string, room: string, name: string, color = "#e11d48") {
  const c = await TestClient.connect(url, room)
  cleanups.push(() => c.close())
  c.send(new Join({ name, color }))
  const welcome = await c.waitFor(is("Welcome"))
  return { c, selfId: welcome.selfId, welcome }
}

const anchor = { x: 400, y: 300 }

test("typing broadcasts a draft to everyone, including the raw text", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")

  a.c.send(new SetInput({ text: "landing page", anchor }))
  const seen = await b.c.waitFor(is("DraftUpdated"))
  expect(seen.draft.userId).toBe(a.selfId)
  expect(seen.draft.text).toBe("landing page")
  expect(seen.draft.nodes).toHaveLength(1)
  expect(seen.draft.nodes[0]).toMatchObject({ type: "page", label: "Landing page", authorColor: "#e11d48" })
  // The typist sees their own draft too.
  await a.c.waitFor(is("DraftUpdated"))
})

test("a draft keeps its node id and position while typing continues", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  a.c.send(new SetInput({ text: "post", anchor }))
  a.c.send(new SetInput({ text: "postgres", anchor: { x: 9999, y: 9999 } }))
  const last = await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "postgres"))
  const first = a.c.received.find(is("DraftUpdated", (m) => m.draft.text === "post"))!
  expect(last.draft.nodes[0]!.id).toBe(first.draft.nodes[0]!.id)
  expect(last.draft.nodes[0]!.x).toBe(first.draft.nodes[0]!.x)
  expect(last.draft.nodes[0]!.type).toBe("database")
})

test("Enter commits the draft for everyone, reusing the draft's id", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "redis cache", anchor }))
  const draft = await b.c.waitFor(is("DraftUpdated"))
  a.c.send(new Commit())
  const committed = await b.c.waitFor(is("NodesCommitted"))
  expect(committed.nodes.map((n) => n.id)).toEqual([draft.draft.nodes[0]!.id])
  expect(committed.nodes[0]!.type).toBe("cache")
  await b.c.waitFor(is("DraftCleared", (m) => m.userId === a.selfId))
})

test("Esc discards the draft for everyone and commits nothing", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "signup form", anchor }))
  await b.c.waitFor(is("DraftUpdated"))
  a.c.send(new Discard())
  await b.c.waitFor(is("DraftCleared", (m) => m.userId === a.selfId))
  a.c.send(new Commit()) // nothing left to commit
  await Bun.sleep(50)
  expect(b.c.received.some((m) => m._tag === "NodesCommitted")).toBe(false)
})

test("clearing the input clears the draft", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "hero", anchor }))
  await b.c.waitFor(is("DraftUpdated"))
  a.c.send(new SetInput({ text: "   ", anchor }))
  await b.c.waitFor(is("DraftCleared"))
})

test("a late joiner receives the committed board plus live drafts", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  a.c.send(new SetInput({ text: "api server", anchor }))
  a.c.send(new Commit())
  await a.c.waitFor(is("NodesCommitted"))
  a.c.send(new SetInput({ text: "postgres", anchor }))
  await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "postgres"))

  const late = await join(s.url, "r", "Cy")
  expect(late.welcome.nodes.map((n) => n.type)).toEqual(["service"])
  expect(late.welcome.drafts).toHaveLength(1)
  expect(late.welcome.drafts[0]).toMatchObject({ userId: a.selfId, text: "postgres" })
})

test("disconnecting clears that user's draft", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "queue", anchor }))
  await b.c.waitFor(is("DraftUpdated"))
  a.c.close()
  await b.c.waitFor(is("DraftCleared", (m) => m.userId === a.selfId))
})

test("committed nodes survive a server restart; drafts do not (SQLite)", async () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "rtw-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const db = joinPath(dir, "boards.sqlite")

  const first = await startServer({ store: sqliteStore(db) })
  const a = await join(first.url, "r", "Ada")
  a.c.send(new SetInput({ text: "landing page", anchor }))
  a.c.send(new Commit())
  await a.c.waitFor(is("NodesCommitted"))
  a.c.send(new SetInput({ text: "unsaved idea", anchor }))
  await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "unsaved idea"))
  a.c.close()
  await first.stop()

  const second = await boot(sqliteStore(db))
  const b = await join(second.url, "r", "Bo")
  expect(b.welcome.nodes.map((n) => n.label)).toEqual(["Landing page"])
  expect(b.welcome.drafts).toEqual([])
})

test("each client's messages apply in order (type, commit, type again)", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "api", anchor }))
  a.c.send(new Commit())
  a.c.send(new SetInput({ text: "worker", anchor }))
  await b.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "worker"))
  const tags = b.c.received.map((m) => (m._tag === "DraftUpdated" ? `Draft:${m.draft.text}` : m._tag))
  expect(tags.slice(tags.indexOf("Draft:api"))).toEqual(["Draft:api", "NodesCommitted", "DraftCleared", "Draft:worker"])
})
