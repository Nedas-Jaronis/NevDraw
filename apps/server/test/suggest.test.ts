import { Commit, Join, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { split } from "../src/engine/split.ts"
import { mergeSuggestions, suggestLinks } from "../src/engine/suggest.ts"
import { Refiner } from "../src/refine/Refiner.ts"
import { is, startServer, TestClient } from "./helpers.ts"

describe("suggestLinks", () => {
  const board = [
    { handle: "@postgres", label: "Postgres" },
    { handle: "@landing-page", label: "Landing page" },
  ]
  test("plain words naming an existing element suggest its handle", () => {
    expect(suggestLinks(split("api writes to postgres"), board)).toEqual([{ text: "postgres", handle: "@postgres" }])
    expect(suggestLinks(split("add a hero to the landing page"), board)).toEqual([])
    expect(suggestLinks(split("the landing page with a hero"), board)).toEqual([{ text: "the landing page", handle: "@landing-page" }])
  })
  test("already-written handles and unrelated words suggest nothing", () => {
    expect(suggestLinks(split("api writes to @postgres"), board)).toEqual([])
    expect(suggestLinks(split("redis cache"), board)).toEqual([])
    expect(suggestLinks(split("postgres"), [])).toEqual([])
  })
  test("merging keeps one per handle and only known handles", () => {
    const known = new Set(["@postgres"])
    expect(
      mergeSuggestions(known, [{ text: "db", handle: "@postgres" }, { text: "x", handle: "@ghost" }], [{ text: "postgres", handle: "@postgres" }]),
    ).toEqual([{ text: "db", handle: "@postgres" }])
  })
})

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function setup(refiner?: Layer.Layer<Refiner>) {
  const server = await startServer(refiner ? { refiner } : {})
  cleanups.push(() => server.stop())
  const join = async (name: string) => {
    const c = await TestClient.connect(server.url, "r")
    cleanups.push(() => c.close())
    c.send(new Join({ name, color: "#e11d48" }))
    await c.waitFor(is("Welcome"))
    return c
  }
  return { join }
}
const anchor = { x: 0, y: 0 }

test("only the typist gets the chip; accepting it (the rewritten text) links to the existing node", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  const b = await join("Bo")
  a.send(new SetInput({ text: "postgres", anchor }))
  a.send(new Commit())
  const [pg] = (await b.waitFor(is("NodesCommitted"))).nodes

  b.send(new SetInput({ text: "api writes to postgres", anchor }))
  const sug = await b.waitFor(is("SuggestionsUpdated", (m) => m.suggestions.length > 0))
  expect(sug.suggestions).toEqual([{ text: "postgres", handle: "@postgres" }])
  await Bun.sleep(50)
  expect(a.received.some((m) => m._tag === "SuggestionsUpdated")).toBe(false)

  // The client rewrote the text to the handle.
  b.send(new SetInput({ text: "api writes to @postgres", anchor }))
  await b.waitFor(is("SuggestionsUpdated", (m) => m.suggestions.length === 0))
  const d = await b.waitFor(is("DraftUpdated", (m) => m.draft.text.endsWith("@postgres")))
  expect(d.draft.nodes.map((n) => n.type)).toEqual(["service"])
  expect(d.draft.edges[0]).toMatchObject({ to: pg!.id, kind: "writes" })
})

test("ignoring the chip and pressing Enter creates a new element", async () => {
  const { join } = await setup()
  const a = await join("Ada")
  a.send(new SetInput({ text: "postgres", anchor }))
  a.send(new Commit())
  await a.waitFor(is("NodesCommitted"))
  a.send(new SetInput({ text: "api writes to postgres", anchor }))
  await a.waitFor(is("SuggestionsUpdated", (m) => m.suggestions.length > 0))
  a.send(new Commit())
  const c = await a.waitFor(is("NodesCommitted", (m) => m.nodes.length === 2))
  expect(c.nodes.map((n) => n.handle)).toEqual(["@api", "@postgres-2"])
  await a.waitFor(is("SuggestionsUpdated", (m) => m.suggestions.length === 0))
})

test("LLM suggestions for unknown handles are never shown", async () => {
  const refiner = Layer.succeed(Refiner, {
    enabled: true,
    name: "stub",
    refine: () =>
      Effect.succeed({
        nodes: [{ key: "p0", type: "service" as const, label: "Api", parent: null, props: {} }],
        edges: [],
        suggestions: [{ text: "db", handle: "@ghost" }],
        patches: [],
      }),
  })
  process.env.LLM_DEBOUNCE_MS = "30"
  const { join } = await setup(refiner)
  const a = await join("Ada")
  a.send(new SetInput({ text: "api uses the db", anchor }))
  await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes.length === 1))
  await Bun.sleep(50)
  expect(a.received.some((m) => m._tag === "SuggestionsUpdated" && m.suggestions.length > 0)).toBe(false)
})
