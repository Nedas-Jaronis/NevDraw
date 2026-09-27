import type { BoardNode, EntryGraph } from "@rtw/shared"
import { Commit, Join, SetInput, slug, uniqueHandle } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BoardStore, makeMemoryStore } from "../src/BoardStore.ts"
import { interpretOffline, materialize, validateHandles } from "../src/engine/index.ts"
import { is, startServer, TestClient } from "./helpers.ts"

describe("handle names", () => {
  test("readable slugs, unique with a suffix", () => {
    expect(slug("Landing Page!", "page")).toBe("landing-page")
    expect(slug("   ", "page")).toBe("page")
    expect(uniqueHandle("Landing page", "page", new Set())).toBe("@landing-page")
    expect(uniqueHandle("Landing page", "page", new Set(["@landing-page", "@landing-page-2"]))).toBe("@landing-page-3")
  })
})

describe("@ references in the engine", () => {
  const info = new Map([
    ["@landing-page", { container: true }],
    ["@postgres", { container: false }],
  ])
  const shape = (g: EntryGraph) => ({
    nodes: g.nodes.map((n) => `${n.type}:${n.label}<${n.parent ?? "-"}`),
    edges: g.edges.map((e) => `${e.from}-${e.kind}->${e.to}`),
  })

  test("an arrow to a known handle points at it instead of creating a node", () => {
    expect(shape(interpretOffline("api server writes to @postgres", info))).toEqual({
      nodes: ["service:Api server<-"],
      edges: ["p0-writes->@postgres"],
    })
  })

  test("'X to @container' nests X inside the committed element", () => {
    expect(shape(interpretOffline("add a signup form to @landing-page", info)).nodes).toEqual(["form:Signup form<@landing-page"])
  })

  test("'@container with …' nests the following pieces", () => {
    expect(shape(interpretOffline("@landing-page with pricing table and footer", info)).nodes).toEqual([
      "table:Pricing table<@landing-page",
      "section:Footer<@landing-page",
    ])
  })

  test("an unknown @handle is just text, never a reference", () => {
    expect(shape(interpretOffline("api writes to @nothing", info))).toEqual({
      nodes: ["service:Api<-", "box:Nothing<-"],
      edges: ["p0-writes->p1"],
    })
  })

  test("validateHandles drops invented references (e.g. from an LLM)", () => {
    const g: EntryGraph = {
      nodes: [{ key: "a", type: "form", label: "Form", parent: "@ghost", props: {} }],
      edges: [
        { from: "a", to: "@ghost", kind: "calls" },
        { from: "a", to: "@postgres", kind: "writes" },
      ],
      suggestions: [
        { text: "db", handle: "@postgres" },
        { text: "x", handle: "@ghost" },
      ],
      patches: [],
    }
    const v = validateHandles(g, new Set(["@postgres"]))
    expect(v.nodes[0]!.parent).toBeNull()
    expect(v.edges.map((e) => e.to)).toEqual(["@postgres"])
    expect(v.suggestions.map((s) => s.handle)).toEqual(["@postgres"])
  })
})

describe("materialize against the board", () => {
  const user = { id: "u", name: "A", color: "#000", cursor: null, typing: false }
  const base = (id: string, extra: Partial<BoardNode>): BoardNode => ({
    id,
    type: "page",
    label: id,
    parent: null,
    order: 0,
    props: {},
    x: 100,
    y: 100,
    pinned: false,
    authorId: "x",
    authorColor: "#111",
    ...extra,
  })
  const page = base("page1", { handle: "@landing-page" })
  const hero = base("hero1", { type: "hero", parent: "page1", order: 0 })
  const pg = base("pg1", { type: "database", handle: "@postgres", x: 900, y: 50 })
  const board = {
    byHandle: new Map([
      ["@landing-page", page],
      ["@postgres", pg],
    ]),
    byId: new Map([page, hero, pg].map((n) => [n.id, n])),
  }
  let i = 0
  const newId = () => `n${++i}`

  test("children of a committed container link to its id and come after its existing children", () => {
    const m = materialize({
      graph: interpretOffline("@landing-page with pricing table", new Map([["@landing-page", { container: true }]])),
      prev: undefined,
      anchor: { x: 0, y: 0 },
      user,
      newId,
      board,
    })
    expect(m.nodes).toHaveLength(1)
    expect(m.nodes[0]).toMatchObject({ parent: "page1", order: 1, type: "table" })
  })

  test("arrows to a handle use the committed id; the new source is placed normally", () => {
    const m = materialize({
      graph: interpretOffline("worker writes to @postgres", new Map([["@postgres", { container: false }]])),
      prev: undefined,
      anchor: { x: 0, y: 0 },
      user,
      newId,
      board,
    })
    expect(m.edges.map((e) => [e.from, e.to])).toEqual([[m.nodes[0]!.id, "pg1"]])
  })
})

// ---------------------------------------------------------------------------

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function setup(store = makeMemoryStore()) {
  const server = await startServer({ store })
  cleanups.push(() => server.stop())
  const join = async (name: string) => {
    const c = await TestClient.connect(server.url, "r")
    cleanups.push(() => c.close())
    c.send(new Join({ name, color: "#e11d48" }))
    return { c, welcome: await c.waitFor(is("Welcome")) }
  }
  return { join, server }
}
const anchor = { x: 0, y: 0 }

test("committing assigns unique handles to every element", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  a.c.send(new SetInput({ text: "landing page with navbar", anchor }))
  a.c.send(new Commit())
  const first = await a.c.waitFor(is("NodesCommitted"))
  expect(first.nodes.map((n) => n.handle)).toEqual(["@landing-page", "@navbar"])
  a.c.send(new SetInput({ text: "landing page", anchor }))
  a.c.send(new Commit())
  const second = await a.c.waitFor(is("NodesCommitted", (m) => m.nodes[0]!.id !== first.nodes[0]!.id))
  expect(second.nodes[0]!.handle).toBe("@landing-page-2")
})

test("a teammate drafts children inside a committed page (privately), then commits into it", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "landing page with navbar", anchor }))
  a.c.send(new Commit())
  const [page] = (await b.c.waitFor(is("NodesCommitted"))).nodes

  b.c.send(new SetInput({ text: "add a signup form to @landing-page", anchor }))
  const d = await b.c.waitFor(is("DraftUpdated", (m) => m.draft.text.includes("@landing-page")))
  expect(d.draft.nodes).toHaveLength(1)
  expect(d.draft.nodes[0]).toMatchObject({ type: "form", parent: page!.id, order: 1 })

  b.c.send(new Commit())
  const c = await a.c.waitFor(is("NodesCommitted", (m) => m.nodes[0]?.type === "form"))
  expect(c.nodes[0]!.parent).toBe(page!.id)
  expect(c.nodes[0]!.handle).toBe("@signup-form")
})

test("'writes to @postgres' connects to the existing node without duplicating it", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  a.c.send(new SetInput({ text: "postgres", anchor }))
  a.c.send(new Commit())
  const [pg] = (await a.c.waitFor(is("NodesCommitted"))).nodes
  a.c.send(new SetInput({ text: "api server writes to @postgres", anchor }))
  a.c.send(new Commit())
  const c = await a.c.waitFor(is("NodesCommitted", (m) => m.edges.length > 0))
  expect(c.nodes.map((n) => n.type)).toEqual(["service"])
  expect(c.edges[0]).toMatchObject({ to: pg!.id, kind: "writes" })
})

test("entries can't change committed elements", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "landing page", anchor }))
  a.c.send(new Commit())
  const [page] = (await a.c.waitFor(is("NodesCommitted"))).nodes
  b.c.send(new SetInput({ text: "@landing-page", anchor })) // a bare reference adds nothing
  b.c.send(new Commit())
  await Bun.sleep(80)
  const late = await join("Cy")
  expect(late.welcome.nodes).toEqual([page!])
})

test("boards saved before handles existed get handles on load, once", async () => {
  const legacy = { id: "old", type: "page", label: "Old page", parent: null, order: 0, props: {}, x: 0, y: 0, pinned: false, authorId: "x", authorColor: "#000" } as const
  const store = makeMemoryStore()
  await Effect.runPromise(Effect.flatMap(BoardStore, (s) => s.upsert("r", [legacy])).pipe(Effect.provide(store)))
  const { join } = await setup(store)
  const a = await join("Ada")
  expect(a.welcome.nodes[0]!.handle).toBe("@old-page")
})

test("architecture elements never nest inside UI containers", () => {
  const g = interpretOffline("add a signup form to @landing-page and a worker that reads from @postgres", new Map([
    ["@landing-page", { container: true }],
    ["@postgres", { container: false }],
  ]))
  expect(g.nodes.map((n) => `${n.type}<${n.parent ?? "-"}`)).toEqual(["form<@landing-page", "service<-"])
  expect(g.edges.map((e) => `${e.kind}->${e.to}`)).toEqual(["reads->@postgres"])
})
