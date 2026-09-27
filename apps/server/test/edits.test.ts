import { Commit, Join, RenameHandle, SetInput, SetNote } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { bulkEditOf, detachOf, editOf } from "../src/engine/edits.ts"
import { sensibleParents } from "../src/engine/materialize.ts"
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
  const user = { id: "u", name: "A", color: "#000", cursor: null, typing: false }
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

describe("embedding media in the element you name", () => {
  const h = new Map([
    ["@hero-area", { container: false, type: "hero" as const, label: "Hero area" }],
    ["@pricing-card", { container: true, type: "card" as const, label: "Pricing card" }],
    ["@landing-page", { container: true, type: "page" as const, label: "Landing page" }],
  ])
  const where = (t: string) => interpretOffline(t, h).nodes.map((n) => `${n.type}<${n.parent}`)
  test.each([
    ["embed an image in @hero-area", "image<@hero-area"],
    ["embed an image in the hero area", "image<@hero-area"],
    ["put a photo inside @hero-area", "image<@hero-area"],
    ["add an image to @pricing-card", "image<@pricing-card"],
    ["a video on the pricing card", "video<@pricing-card"],
    ["a signup form in the landing page", "form<@landing-page"],
  ] as const)("%p", (text, expected) => {
    expect(where(text)).toEqual([expected])
  })
  test("non-media can't go inside a leaf; unknown names stay top-level", () => {
    expect(where("a button in the hero area")).toEqual(["button<null"])
    expect(where("an image in the footer")).toEqual(["image<null"])
  })
})

describe("taking things apart", () => {
  const h = new Map<string, { container: boolean; parent?: string | null }>([
    ["@stack", { container: true, parent: null }],
    ["@server-1", { container: false, parent: "@stack" }],
    ["@lb", { container: false, parent: null }],
  ])
  test.each([
    ["detach @server-1 from @stack", [{ target: "@server-1", detach: true }]],
    ["take @server-1 out of @stack", [{ target: "@server-1", detach: true }]],
    ["unattach @server-1", [{ target: "@server-1", detach: true }]],
    ["disconnect @lb from @server-1", [{ target: "@lb", unlink: "@server-1" }]],
    ["remove the arrow between @lb and @stack", [{ target: "@lb", unlink: "@stack" }]],
    ["unlink @lb", [{ target: "@lb", unlink: "*" }]],
  ] as const)("%p", (text, patches) => {
    expect(detachOf(text, h)).toEqual(patches as never)
  })
  test("not a detach", () => {
    expect(detachOf("connect @lb to @stack", h)).toBeNull()
    expect(detachOf("take @lb out of @stack", h)).toBeNull()
  })
})

test("'all servers inside @stack' recolors what's inside, never the stack", () => {
  const h = new Map<string, { container: boolean; type?: never; parent?: string | null }>([
    ["@stack", { container: true, type: "section" as never, parent: null }],
    ["@server-1", { container: false, type: "service" as never, parent: "@stack" }],
    ["@server-2", { container: false, type: "service" as never, parent: "@stack" }],
    ["@api", { container: false, type: "service" as never, parent: null }],
  ])
  expect(bulkEditOf("turn all servers inside the @stack to blue", h, [])).toEqual([
    { target: "@server-1", color: "#1c7ed6" },
    { target: "@server-2", color: "#1c7ed6" },
  ])
})

test("connecting is never nesting: an element with an arrow to its parent goes top-level", () => {
  const board = { byHandle: new Map([["@stack", { id: "s", type: "section" } as never], ["@api", { id: "a", type: "service" } as never]]), byId: new Map() }
  const g = sensibleParents(
    {
      nodes: [
        { key: "n1", type: "cache", label: "Cache", parent: "@stack", props: {} },
        { key: "n2", type: "cache", label: "Cache 2", parent: "@api", props: {} },
        { key: "n3", type: "service", label: "Server 6", parent: "@stack", props: {} },
      ],
      edges: [{ from: "n1", to: "@stack", kind: "calls" }],
      suggestions: [],
      patches: [],
    },
    board,
  )
  expect(g.nodes.map((n) => n.parent)).toEqual([null, null, "@stack"])
})

test("detach over the protocol: out of the container, and arrows removed", async () => {
  const c = await room()
  c.send(new SetInput({ text: "a signup form with an email input", anchor }))
  c.send(new Commit())
  const made = (await c.waitFor(is("NodesCommitted"))).nodes
  const section = made.find((n) => n.type === "form")!
  const child = made.find((n) => n.parent === section.id)!
  c.send(new SetInput({ text: `detach ${child.handle} from ${section.handle}`, anchor }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("detach")))
  c.send(new Commit())
  const up = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === child.id && n.parent === null)))
  expect(up.nodes.find((n) => n.id === child.id)!.parent).toBeNull()

  c.send(new SetInput({ text: `a cache connected to ${child.handle}`, anchor }))
  c.send(new Commit())
  const linked = await c.waitFor(is("NodesCommitted", (m) => m.edges.length > 0))
  c.send(new SetInput({ text: `disconnect ${child.handle} from @cache`, anchor }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("disconnect")))
  c.send(new Commit())
  const removed = await c.waitFor(is("NodesRemoved"))
  expect(removed.edgeIds).toEqual(linked.edges.map((e) => e.id))
})

test("retagging: click a tag, type a new one; taken or empty tags are ignored", async () => {
  const c = await room()
  c.send(new SetInput({ text: "a login form. a pricing table", anchor }))
  c.send(new Commit())
  const [form, table] = (await c.waitFor(is("NodesCommitted"))).nodes.filter((n) => n.parent === null)
  c.send(new RenameHandle({ id: form!.id, handle: "@Sign In form!" }))
  const up = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === form!.id)))
  expect(up.nodes[0]!.handle).toBe("@sign-in-form")
  c.send(new RenameHandle({ id: table!.id, handle: "sign-in-form" }))
  await Bun.sleep(100)
  expect(c.received.filter(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === table!.id)))).toEqual([])
  // The new tag is what references use from now on.
  c.send(new SetInput({ text: "make @sign-in-form red", anchor }))
  const d = await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("make")))
  expect(d.draft.patches).toEqual([{ id: form!.id, color: "#e03131" }])
})

test("annotations: typed commands and the protocol", async () => {
  const { noteOf } = await import("../src/engine/edits.ts")
  const h = new Map([["@hero", { container: false }]])
  expect(noteOf("annotate @hero: needs the real photo", h)).toEqual([{ target: "@hero", note: "needs the real photo" }])
  expect(noteOf("add a note to @hero saying copy from marketing", h)).toEqual([{ target: "@hero", note: "copy from marketing" }])
  expect(noteOf("@hero note: A/B test this", h)).toEqual([{ target: "@hero", note: "A/B test this" }])
  expect(noteOf("annotate @nope: x", h)).toBeNull()

  const c = await room()
  c.send(new SetInput({ text: "a hero", anchor }))
  c.send(new Commit())
  const hero = (await c.waitFor(is("NodesCommitted"))).nodes[0]!
  c.send(new SetNote({ id: hero.id, note: "  hi  " }))
  const up = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.props.note === "hi")))
  expect(up.nodes[0]!.id).toBe(hero.id)
  c.send(new SetInput({ text: `annotate ${hero.handle}: swap the photo`, anchor }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("annotate")))
  c.send(new Commit())
  await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.props.note === "swap the photo")))
})

test("disconnecting a group cuts the arrows from what's inside it ('disconnect @stack and @lb')", async () => {
  const c = await room()
  c.send(new SetInput({ text: "an api writes to postgres", anchor }))
  c.send(new Commit())
  const first = await c.waitFor(is("NodesCommitted"))
  c.send(new SetInput({ text: "wrap @api into a backend box", anchor }))
  c.send(new Commit())
  await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.handle === "@api" && n.parent !== null)))
  c.send(new SetInput({ text: "disconnect @backend-box and @postgres", anchor }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("disconnect")))
  c.send(new Commit())
  const removed = await c.waitFor(is("NodesRemoved"))
  expect(removed.edgeIds).toEqual(first.edges.map((e) => e.id))
})
