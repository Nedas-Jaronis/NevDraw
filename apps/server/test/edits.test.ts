import { Commit, Join, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { editOf } from "../src/engine/edits.ts"
import { interpretOffline } from "../src/engine/index.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const info = (...hs: Array<[string, boolean, string]>) =>
  new Map(hs.map(([h, container, type]) => [h, { container, type: type as never }]))

describe("edits to existing elements", () => {
  const known = new Set(["@blue-clock-25-minute-time", "@x"])
  test.each([
    ["make @blue-clock-25-minute-time a red clock", { target: "@blue-clock-25-minute-time", color: "#e03131" }],
    ["change @x to blue", { target: "@x", color: "#1c7ed6" }],
    ["@x should be green", { target: "@x", color: "#2f9e44" }],
    ["rename @x to checkout page", { target: "@x", label: "Checkout Page" }],
    ["turn @x into a stopwatch", { target: "@x", type: "stopwatch" }],
    ["color @x tiffany blue", { target: "@x", color: "#0abab5" }],
  ] as const)("%p", (text, patch) => {
    expect(editOf(text, known)).toEqual(patch)
  })

  test("not edits: no change cue, unknown handle, or just a reference", () => {
    expect(editOf("a blue timer like @x", known)).toBeNull()
    expect(editOf("make @nope red", known)).toBeNull()
    expect(editOf("the @x", known)).toBeNull()
  })

  test("the reported case makes no new element", () => {
    const g = interpretOffline("make @blue-clock-25-minute-time a red clock", info(["@blue-clock-25-minute-time", false, "timer"]))
    expect(g.nodes).toEqual([])
    expect(g.patches).toEqual([{ target: "@blue-clock-25-minute-time", color: "#e03131" }])
  })
})

describe("wrapping existing elements into a container", () => {
  const board = info(
    ["@call-to-action", true, "section"],
    ["@body", true, "section"],
    ["@header", true, "section"],
    ["@landing-page", true, "page"],
    ["@footer", true, "section"],
  )

  test("the reported case: create a wrapper, then 'it should include …'", () => {
    const g = interpretOffline(
      "create a main landing page wrapper box. it should include @call-to-action @body @header @landing-page @footer",
      board,
    )
    expect(g.nodes.map((n) => `${n.type}:${n.label}`)).toEqual(["section:Main landing page wrapper box"])
    const box = g.nodes[0]!.key
    expect(g.patches).toEqual(
      ["@call-to-action", "@body", "@header", "@landing-page", "@footer"].map((target) => ({ target, parent: box })),
    )
  })

  test("wrap / group / put … into …", () => {
    const g = interpretOffline("wrap @header, @body and @footer into one box", board)
    expect(g.nodes.map((n) => n.type)).toEqual(["section"])
    expect(g.patches.map((p) => p.target)).toEqual(["@header", "@body", "@footer"])
    const page = interpretOffline("put @header and @footer in a page called Home", board)
    expect(page.nodes.map((n) => `${n.type}:${n.label}`)).toEqual(["page:Home"])
  })

  test("'them' means this person's recent elements", async () => {
    const { assemble } = await import("../src/engine/assemble.ts")
    const { split } = await import("../src/engine/split.ts")
    const { keywordAnswers } = await import("../src/engine/answers.ts")
    const pieces = split("group them into a section")
    const g = assemble(pieces, pieces.map(keywordAnswers), board, ["@header", "@footer"])
    expect(g.patches.map((p) => p.target)).toEqual(["@header", "@footer"])
  })
})

// ---------------------------------------------------------------------------

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function room() {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#f59f00" }))
  await c.waitFor(is("Welcome"))
  return c
}
const anchor = { x: 0, y: 0 }

test("recolor over the protocol: preview as a patch, Enter applies it, no new element", async () => {
  const c = await room()
  c.send(new SetInput({ text: "blue 25 minute timer", anchor }))
  c.send(new Commit())
  const [timer] = (await c.waitFor(is("NodesCommitted"))).nodes
  expect(timer!.props.color).toBe("#1c7ed6")

  c.send(new SetInput({ text: `make ${timer!.handle} a red clock`, anchor }))
  const d = await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("make")))
  expect(d.draft.nodes).toEqual([])
  expect(d.draft.patches).toEqual([{ id: timer!.id, color: "#e03131" }])

  c.send(new Commit())
  const up = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === timer!.id && n.props.color === "#e03131")))
  expect(up.nodes.find((n) => n.id === timer!.id)).toMatchObject({ type: "timer", handle: timer!.handle })
})

test("wrap over the protocol: the new box commits, then the elements move inside it in order", async () => {
  const c = await room()
  c.send(new SetInput({ text: "header section. body section. footer section", anchor }))
  c.send(new Commit())
  const made = (await c.waitFor(is("NodesCommitted"))).nodes
  c.send(new SetInput({ text: "create a main wrapper box. it should include @header-section @body-section @footer-section", anchor }))
  c.send(new Commit())
  const box = (await c.waitFor(is("NodesCommitted", (m) => m.nodes.some((n) => n.label.startsWith("Main"))))).nodes[0]!
  const moved = await c.waitFor(is("NodesUpdated", (m) => m.nodes.length === 3))
  expect(moved.nodes.map((n) => [n.id, n.parent, n.order])).toEqual(made.map((n, i) => [n.id, box.id, i]))
})

test("an element can't be moved inside itself", async () => {
  const c = await room()
  c.send(new SetInput({ text: "landing page with hero section", anchor }))
  c.send(new Commit())
  await c.waitFor(is("NodesCommitted"))
  // Move the page into its own child: rejected.
  c.send(new SetInput({ text: "put @landing-page into @hero-section", anchor }))
  await Bun.sleep(150)
  const drafts = c.received.filter(is("DraftUpdated", (m) => m.draft.text.startsWith("put")))
  expect(drafts.every((d) => d.draft.patches.every((p) => p.parent === undefined))).toBe(true)
})

test("'call to action' elsewhere in a sentence never renames (the reported page rename)", () => {
  const known = new Set(["@landing-page", "@x"])
  expect(editOf("add a call to action at the bottom of @landing-page", known)).toBeNull()
  expect(editOf("call @x the pricing page", known)).toEqual({ target: "@x", label: "Pricing Page" })
  expect(editOf("@x should be called Checkout", known)).toEqual({ target: "@x", label: "Checkout" })
  expect(editOf("make @x into a stopwatch", known)).toEqual({ target: "@x", type: "stopwatch" })
})

test("a wrapper named after a page is still a plain box (section), even if Jev says page", async () => {
  const { assemble } = await import("../src/engine/assemble.ts")
  const { split } = await import("../src/engine/split.ts")
  const { keywordAnswers } = await import("../src/engine/answers.ts")
  const pieces = split("create a main landing page wrapper box. it should include @header")
  const answers = pieces.map(keywordAnswers)
  answers[0] = { ...answers[0]!, nodeType: { value: "page", confidence: 1 }, isContainer: 1, source: "jev" }
  const g = assemble(pieces, answers, new Map([["@header", { container: true }]]))
  expect(g.nodes.map((n) => n.type)).toEqual(["section"])
})

describe("positions among siblings", () => {
  const user = { id: "u", name: "A", color: "#000", cursor: null }
  const base = (id: string, extra: Record<string, unknown>) => ({
    id, type: "section" as const, label: id, parent: "page", order: 0, props: {}, x: 0, y: 0, pinned: false, authorId: "x", authorColor: "#000", ...extra,
  })
  const page = { ...base("page", { type: "page", parent: null, handle: "@landing-page" }) }
  const navbar = base("nav", { type: "navbar", order: 0, handle: "@navbar" })
  const cta = base("cta", { type: "button", order: 1, handle: "@call-to-action" })
  const board = {
    byHandle: new Map([["@landing-page", page], ["@navbar", navbar], ["@call-to-action", cta]] as const),
    byId: new Map([page, navbar, cta].map((n) => [n.id, n])),
  }
  const handles = new Map([
    ["@landing-page", { container: true }],
    ["@navbar", { container: false }],
    ["@call-to-action", { container: false }],
  ])
  const place = async (text: string) => {
    const { materialize } = await import("../src/engine/index.ts")
    const m = materialize({ graph: interpretOffline(text, handles), prev: undefined, anchor: { x: 0, y: 0 }, user, newId: () => "new", board: board as never })
    return m.nodes[0]!
  }

  test("the reported case: a hero between @navbar and @call-to-action goes between them", async () => {
    const hero = await place("@landing-page create a hero section between @navbar and @call-to-action")
    expect(hero).toMatchObject({ type: "hero", parent: "page" })
    expect(hero.order).toBeGreaterThan(0)
    expect(hero.order).toBeLessThan(1)
  })

  test("above / below / at the top / at the bottom, parent inferred from the sibling", async () => {
    expect((await place("a banner above @navbar")).order).toBeLessThan(0)
    expect(await place("an image below @navbar")).toMatchObject({ parent: "page" })
    expect((await place("an image below @navbar")).order).toBe(0.5)
    expect((await place("add a footer at the bottom of @landing-page")).order).toBe(2)
    expect((await place("add a notice at the top of @landing-page")).order).toBe(-1)
  })
})
