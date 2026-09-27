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

test("a draft is private: only the typist sees it, including the raw text", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")

  a.c.send(new SetInput({ text: "landing page", anchor }))
  const seen = await a.c.waitFor(is("DraftUpdated"))
  expect(seen.draft.userId).toBe(a.selfId)
  expect(seen.draft.text).toBe("landing page")
  expect(seen.draft.nodes).toHaveLength(1)
  expect(seen.draft.nodes[0]).toMatchObject({ type: "page", label: "Landing page", authorColor: "#e11d48" })
  await Bun.sleep(100)
  // Nobody else sees it, or anything move for it.
  expect(b.c.received.some((m) => m._tag === "DraftUpdated" || m._tag === "DraftCleared" || m._tag === "LayoutUpdated")).toBe(false)
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
  const draft = await a.c.waitFor(is("DraftUpdated"))
  a.c.send(new Commit())
  const committed = await b.c.waitFor(is("NodesCommitted"))
  expect(committed.nodes.map((n) => n.id)).toEqual([draft.draft.nodes[0]!.id])
  expect(committed.nodes[0]!.type).toBe("cache")
  await a.c.waitFor(is("DraftCleared", (m) => m.userId === a.selfId))
  expect(b.c.received.some((m) => m._tag === "DraftUpdated")).toBe(false)
})
test("Esc discards the draft and commits nothing", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "signup form", anchor }))
  await a.c.waitFor(is("DraftUpdated"))
  a.c.send(new Discard())
  await a.c.waitFor(is("DraftCleared", (m) => m.userId === a.selfId))
  a.c.send(new Commit()) // nothing left to commit
  await Bun.sleep(50)
  expect(b.c.received.some((m) => m._tag === "NodesCommitted" || m._tag === "DraftUpdated")).toBe(false)
})
test("clearing the input clears the draft", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  a.c.send(new SetInput({ text: "hero", anchor }))
  await a.c.waitFor(is("DraftUpdated"))
  a.c.send(new SetInput({ text: "   ", anchor }))
  await a.c.waitFor(is("DraftCleared"))
})
test("a late joiner receives the committed board, but not anyone's draft", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  a.c.send(new SetInput({ text: "api server", anchor }))
  a.c.send(new Commit())
  await a.c.waitFor(is("NodesCommitted"))
  a.c.send(new SetInput({ text: "postgres", anchor }))
  await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "postgres"))

  const late = await join(s.url, "r", "Cy")
  expect(late.welcome.nodes.map((n) => n.type)).toEqual(["service"])
  expect(late.welcome.drafts).toEqual([])
  expect(late.welcome.displaced).toEqual([])
})
test("disconnecting drops that user's draft; nothing is committed", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "queue", anchor }))
  await a.c.waitFor(is("DraftUpdated"))
  a.c.close()
  await b.c.waitFor(is("UserLeft", (m) => m.id === a.selfId))
  const c = await join(s.url, "r", "Cy")
  expect(c.welcome.nodes).toEqual([])
  expect(c.welcome.drafts).toEqual([])
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
  a.c.send(new SetInput({ text: "api", anchor }))
  a.c.send(new Commit())
  a.c.send(new SetInput({ text: "worker", anchor }))
  await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "worker"))
  const tags = a.c.received
    .map((m) => (m._tag === "DraftUpdated" ? `Draft:${m.draft.text}` : m._tag))
    .filter((t) => t.startsWith("Draft") || t === "NodesCommitted")
  const from = tags.indexOf("Draft:api")
  expect(tags.slice(from).filter((t, i, all) => t !== all[i - 1])).toEqual(["Draft:api", "NodesCommitted", "DraftCleared", "Draft:worker"])
})
test("a nested entry arrives as a page draft with its children linked in order", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "landing page with navbar, hero, pricing table and signup form", anchor }))
  const { draft } = await a.c.waitFor(is("DraftUpdated"))
  const [page, ...kids] = draft.nodes
  expect(page).toMatchObject({ type: "page", parent: null })
  expect(kids.map((k) => [k.type, k.parent, k.order])).toEqual([
    ["navbar", page!.id, 0],
    ["hero", page!.id, 1],
    ["table", page!.id, 2],
    ["form", page!.id, 3],
  ])
  a.c.send(new Commit())
  const committed = await b.c.waitFor(is("NodesCommitted"))
  expect(committed.nodes.map((n) => n.id)).toEqual(draft.nodes.map((n) => n.id))
})

test("others see only that someone is typing, never the draft; it stops on Enter or clear", async () => {
  const s = await boot()
  const a = await join(s.url, "r", "Ada")
  const b = await join(s.url, "r", "Bo")
  a.c.send(new SetInput({ text: "p", anchor }))
  a.c.send(new SetInput({ text: "postgres", anchor }))
  await b.c.waitFor(is("UserTyping", (m) => m.id === a.selfId && m.typing))
  // Once per burst of typing, not per keystroke.
  await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "postgres"))
  expect(b.c.received.filter((m) => m._tag === "UserTyping")).toHaveLength(1)
  a.c.send(new Commit())
  await b.c.waitFor(is("UserTyping", (m) => m.id === a.selfId && !m.typing))
  await b.c.waitFor(is("NodesCommitted"))
  expect(b.c.received.some((m) => m._tag === "DraftUpdated")).toBe(false)

  a.c.send(new SetInput({ text: "cache", anchor }))
  await b.c.waitFor(is("UserTyping", (m) => m.typing && b.c.received.filter((x) => x._tag === "UserTyping").length === 3))
  a.c.send(new SetInput({ text: "", anchor }))
  await b.c.waitFor(is("UserTyping", (m) => !m.typing && b.c.received.filter((x) => x._tag === "UserTyping").length === 4))
  // A newcomer sees who's typing in the welcome.
  a.c.send(new SetInput({ text: "queue", anchor }))
  await a.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "queue"))
  const c = await join(s.url, "r", "Cy")
  expect(c.welcome.users.find((u) => u.id === a.selfId)?.typing).toBe(true)
})
