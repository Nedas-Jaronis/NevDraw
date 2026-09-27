import type { BoardNode } from "@rtw/shared"
import { Commit, Discard, Join, MoveNode, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { avoid, estimateSizes, overlaps, pushAside, type Rect } from "../src/engine/layout.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const node = (id: string, x: number, y: number, extra: Partial<BoardNode> = {}): BoardNode => ({
  id,
  type: "service",
  label: id,
  parent: null,
  order: 0,
  props: {},
  x,
  y,
  pinned: false,
  authorId: "a",
  authorColor: "#000",
  ...extra,
})

describe("size estimates", () => {
  test("containers grow with their children; rows take the tallest child", () => {
    const page = node("p", 0, 0, { type: "page" })
    const kids = ["navbar", "hero", "form"].map((t, i) => node(`k${i}`, 0, 0, { type: t as BoardNode["type"], parent: "p", order: i }))
    const stacked = estimateSizes([page, ...kids]).get("p")!
    const row = estimateSizes([{ ...page, props: { layout: "row" } }, ...kids]).get("p")!
    expect(stacked.w).toBe(320)
    expect(stacked.h).toBeGreaterThan(row.h)
    expect(estimateSizes([node("s", 0, 0)]).get("s")!.w).toBe(240)
  })
})

describe("pushAside", () => {
  const sizes = (...ns: BoardNode[]) => estimateSizes(ns)

  test("a draft pushes an overlapping unpinned element out of the way", () => {
    const a = node("a", 100, 0)
    const d = node("d", 0, 0)
    const out = pushAside({ committed: [a], drafts: [d], sizes: sizes(a, d) })
    const p = out.get("a")!
    const size = sizes(a, d)
    expect(overlaps({ ...p, ...size.get("a")! }, { x: 0, y: 0, ...size.get("d")! })).toBe(false)
  })

  test("pinned elements never move", () => {
    const a = node("a", 100, 0, { pinned: true })
    const d = node("d", 0, 0)
    expect(pushAside({ committed: [a], drafts: [d], sizes: sizes(a, d) }).size).toBe(0)
  })

  test("pushes cascade without moving untouched elements", () => {
    const a = node("a", 100, 0)
    const b = node("b", 400, 0)
    const far = node("far", 5000, 5000)
    const d = node("d", 0, 0)
    const out = pushAside({ committed: [a, b, far], drafts: [d], sizes: sizes(a, b, far, d) })
    expect(out.has("a")).toBe(true)
    expect(out.has("far")).toBe(false)
  })

  test("no drafts, no displacement (everything settles back)", () => {
    const a = node("a", 0, 0)
    const b = node("b", 10, 10)
    expect(pushAside({ committed: [a, b], drafts: [], sizes: sizes(a, b) }).size).toBe(0)
  })
})

test("avoid slides a new element right past obstacles", () => {
  const obstacles: Rect[] = [{ x: 0, y: 0, w: 240, h: 60 }, { x: 272, y: 0, w: 240, h: 60 }]
  const p = avoid({ x: 10, y: 10, w: 240, h: 60 }, obstacles)
  expect(obstacles.some((o) => overlaps({ ...p, w: 240, h: 60 }, o))).toBe(false)
})

// ---------------------------------------------------------------------------

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function setup() {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const join = async (name: string) => {
    const c = await TestClient.connect(server.url, "r")
    cleanups.push(() => c.close())
    c.send(new Join({ name, color: "#e11d48" }))
    return { c, welcome: await c.waitFor(is("Welcome")) }
  }
  return { join }
}
const anchor = { x: 500, y: 500 }

test("a growing draft pushes others aside; Esc lets them settle back", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "api server", anchor }))
  a.c.send(new Commit())
  const [api] = (await b.c.waitFor(is("NodesCommitted"))).nodes

  b.c.send(new SetInput({ text: "postgres", anchor })) // lands on top of the api server
  // The typist sees the api server make room; nobody else sees anything move for a private draft.
  const pushed = await b.c.waitFor(is("LayoutUpdated", (m) => m.displaced.length > 0))
  expect(pushed.displaced[0]!.id).toBe(api!.id)
  expect(a.c.received.some((m) => m._tag === "LayoutUpdated" && m.displaced.length > 0)).toBe(false)

  b.c.send(new Discard())
  await b.c.waitFor(is("LayoutUpdated", (m) => m.displaced.length === 0))
})

test("committing keeps pushed elements where they were pushed", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "api server", anchor }))
  a.c.send(new Commit())
  const [api] = (await b.c.waitFor(is("NodesCommitted"))).nodes
  b.c.send(new SetInput({ text: "postgres", anchor }))
  const pushed = await b.c.waitFor(is("LayoutUpdated", (m) => m.displaced.length > 0))
  b.c.send(new Commit())
  const saved = await a.c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === api!.id)))
  expect(saved.nodes[0]).toMatchObject({ x: pushed.displaced[0]!.x, y: pushed.displaced[0]!.y })
  const late = await join("Cy")
  expect(late.welcome.displaced).toEqual([])
})

test("a new draft goes around a pinned element instead of pushing it", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "api server", anchor }))
  a.c.send(new Commit())
  const [api] = (await a.c.waitFor(is("NodesCommitted"))).nodes
  a.c.send(new MoveNode({ id: api!.id, x: api!.x, y: api!.y, final: true })) // pin in place
  await a.c.waitFor(is("NodesUpdated"))

  b.c.send(new SetInput({ text: "postgres", anchor }))
  const d = await b.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "postgres"))
  const pg = d.draft.nodes[0]!
  expect(overlaps({ x: pg.x, y: pg.y, w: 240, h: 46 }, { x: api!.x, y: api!.y, w: 240, h: 46 })).toBe(false)
  await Bun.sleep(50)
  expect(b.c.received.some((m) => m._tag === "LayoutUpdated" && m.displaced.length > 0)).toBe(false)
})

test("two people typing at the same spot don't stack their drafts", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "landing page", anchor }))
  await a.c.waitFor(is("DraftUpdated"))
  b.c.send(new SetInput({ text: "pricing page", anchor }))
  const bd = await b.c.waitFor(is("DraftUpdated", (m) => m.draft.text === "pricing page"))
  const ad = a.c.received.find(is("DraftUpdated", (m) => m.draft.text === "landing page"))!
  const r = (n: BoardNode) => ({ x: n.x, y: n.y, w: 320, h: 100 })
  expect(overlaps(r(ad.draft.nodes[0]!), r(bd.draft.nodes[0]!))).toBe(false)
})
