import { Commit, DeleteNode, Join, MoveNode, SetInput } from "@rtw/shared"
import { afterEach, expect, test } from "bun:test"
import { makeMemoryStore } from "../src/BoardStore.ts"
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
async function join(url: string, name: string) {
  const c = await TestClient.connect(url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name, color: "#e11d48" }))
  const welcome = await c.waitFor(is("Welcome"))
  return { c, welcome }
}
const anchor = { x: 400, y: 300 }

async function commitPage(c: TestClient) {
  c.send(new SetInput({ text: "landing page with navbar and hero", anchor }))
  c.send(new Commit())
  return (await c.waitFor(is("NodesCommitted"))).nodes
}

test("dragging moves a node live for others, pins it, and saves the final position", async () => {
  const store = makeMemoryStore()
  const s = await boot(store)
  const a = await join(s.url, "Ada")
  const b = await join(s.url, "Bo")
  const [page] = await commitPage(a.c)

  a.c.send(new MoveNode({ id: page!.id, x: 10, y: 20, final: false }))
  const live = await b.c.waitFor(is("NodesUpdated", (m) => m.nodes[0]!.x === 10))
  expect(live.nodes[0]).toMatchObject({ id: page!.id, y: 20, pinned: true })

  a.c.send(new MoveNode({ id: page!.id, x: 111.6, y: 222.2, final: true }))
  await a.c.waitFor(is("NodesUpdated", (m) => m.nodes[0]!.x === 112))

  // Persisted: a fresh server on the same store sees it pinned at the final spot.
  await s.stop()
  const s2 = await boot(store)
  const c = await join(s2.url, "Cy")
  expect(c.welcome.nodes.find((n) => n.id === page!.id)).toMatchObject({ x: 112, y: 222, pinned: true })
})

test("two people dragging the same node: the last write wins", async () => {
  const s = await boot()
  const a = await join(s.url, "Ada")
  const b = await join(s.url, "Bo")
  const [page] = await commitPage(a.c)
  a.c.send(new MoveNode({ id: page!.id, x: 1, y: 1, final: true }))
  await b.c.waitFor(is("NodesUpdated", (m) => m.nodes[0]!.x === 1))
  b.c.send(new MoveNode({ id: page!.id, x: 2, y: 2, final: true }))
  await a.c.waitFor(is("NodesUpdated", (m) => m.nodes[0]!.x === 2))
  const late = await join(s.url, "Cy")
  expect(late.welcome.nodes.find((n) => n.id === page!.id)).toMatchObject({ x: 2, y: 2 })
})

test("children can't be moved on their own", async () => {
  const s = await boot()
  const a = await join(s.url, "Ada")
  const b = await join(s.url, "Bo")
  const [, navbar] = await commitPage(a.c)
  a.c.send(new MoveNode({ id: navbar!.id, x: 5, y: 5, final: true }))
  await Bun.sleep(80)
  expect(b.c.received.some((m) => m._tag === "NodesUpdated")).toBe(false)
})

test("deleting a container removes it and its children for everyone and from storage", async () => {
  const store = makeMemoryStore()
  const s = await boot(store)
  const a = await join(s.url, "Ada")
  const b = await join(s.url, "Bo")
  const nodes = await commitPage(a.c)
  a.c.send(new DeleteNode({ id: nodes[0]!.id }))
  const removed = await b.c.waitFor(is("NodesRemoved"))
  expect([...removed.ids].sort()).toEqual(nodes.map((n) => n.id).sort())
  const late = await join(s.url, "Cy")
  expect(late.welcome.nodes).toEqual([])
})
