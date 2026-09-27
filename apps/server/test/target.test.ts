import { Commit, Join, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { readTargeted, resolveIn, subtreeOf } from "../src/engine/target.ts"
import { is, startServer, TestClient } from "./helpers.ts"

type Info = { container: boolean; type?: never; label?: string; parent?: string | null }
const H = new Map<string, Info>([
  ["@landing-page", { container: true, type: "page" as never, label: "Landing page", parent: null }],
  ["@hero", { container: false, type: "hero" as never, label: "Hero", parent: "@landing-page" }],
  ["@get-started", { container: false, type: "button" as never, label: "Get started", parent: "@landing-page" }],
  ["@subtitle", { container: false, type: "text" as never, label: "Subtitle", parent: "@landing-page" }],
  ["@footer", { container: true, type: "section" as never, label: "Footer", parent: "@landing-page" }],
])

describe("reading text aimed at a clicked element", () => {
  test("its parts, nearest first; names resolve by label, handle words or type", () => {
    expect(subtreeOf("@landing-page", H)).toEqual(["@hero", "@get-started", "@subtitle", "@footer"])
    expect(resolveIn("the get started button", "@landing-page", H)).toBe("@get-started")
    expect(resolveIn("the button", "@landing-page", H)).toBe("@get-started")
    expect(resolveIn("it", "@landing-page", H)).toBe("@landing-page")
  })
  test("remove, move and change become patches; the rest describes new parts", () => {
    const t = readTargeted("add a pricing table and remove the get started button, then move the footer to the top", "@landing-page", H)
    expect(t.patches).toEqual([
      { target: "@get-started", remove: true },
      { target: "@footer", before: "$top" },
    ])
    expect(t.rest).toBe("add a pricing table")
  })
  test("'make it red' edits the target; 'rename the subtitle to Tagline' edits the part", () => {
    expect(readTargeted("make it red", "@hero", H).rest).toBe("make @hero red")
    expect(readTargeted("make red", "@hero", H).rest).toBe("make @hero red")
    expect(readTargeted("rename the subtitle to Tagline", "@landing-page", H).patches).toEqual([{ target: "@subtitle", label: "Tagline" }])
  })
  test("move X above / below Y", () => {
    expect(readTargeted("move the subtitle above the hero", "@landing-page", H).patches).toEqual([{ target: "@subtitle", before: "@hero" }])
    expect(readTargeted("put the button below the subtitle", "@landing-page", H).patches).toEqual([{ target: "@get-started", after: "@subtitle" }])
  })
})

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

test("click a page, then add inside it, remove a part and reorder, all on Enter", async () => {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const anchor = { x: 0, y: 0 }
  c.send(new SetInput({ text: "a landing page with a navbar, a hero and a footer", anchor }))
  c.send(new Commit())
  const made = (await c.waitFor(is("NodesCommitted"))).nodes
  const page = made.find((n) => n.type === "page")!
  const hero = made.find((n) => n.type === "hero")!
  const footer = made.find((n) => n.label === "Footer")!

  // Target the page: new parts go inside it, not on the board.
  c.send(new SetInput({ text: "a pricing table and remove the hero", anchor, target: page.id }))
  const d = await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("a pricing")))
  expect(d.draft.nodes.map((n) => [n.type, n.parent])).toEqual([["table", page.id]])
  expect(d.draft.patches).toEqual([{ id: hero.id, remove: true }])
  c.send(new Commit())
  const removed = await c.waitFor(is("NodesRemoved"))
  expect(removed.ids).toEqual([hero.id])
  const added = await c.waitFor(is("NodesCommitted", (m) => m.nodes.some((n) => n.type === "table")))
  expect(added.nodes[0]!.parent).toBe(page.id)

  c.send(new SetInput({ text: "move the footer to the top", anchor, target: page.id }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("move")))
  c.send(new Commit())
  const up = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === footer.id)))
  const navbar = made.find((n) => n.type === "navbar")!
  expect(up.nodes.find((n) => n.id === footer.id)!.order).toBeLessThan(navbar.order)
})

describe("arrows from the target, and removing arrows by name", () => {
  const B = new Map<string, Info>([
    ["@contact-form", { container: true, type: "form" as never, label: "Contact form", parent: null }],
    ["@server", { container: false, type: "service" as never, label: "Server", parent: null }],
    ["@server2", { container: false, type: "service" as never, label: "Server2", parent: null }],
    ["@pricing-page", { container: true, type: "page" as never, label: "Pricing page", parent: null }],
  ])
  test("'link towards another server' is an arrow to the server that's there, not a link inside the form", async () => {
    const { readTargeted } = await import("../src/engine/target.ts")
    const only = new Map([...B].filter(([h]) => h !== "@server2"))
    expect(readTargeted("link towards another server", "@contact-form", only)).toEqual({ patches: [], rest: "@contact-form connects to @server", command: true })
    expect(readTargeted("it calls the pricing page", "@contact-form", only).rest).toBe("@contact-form calls @pricing-page")
    // Nothing like it on the board: a new one, next to the form.
    const t = readTargeted("send it to a payments api", "@contact-form", only)
    expect(t).toMatchObject({ rest: "@contact-form connects to a payments api", command: false })
  })
  test("unlink by name, no @ needed", async () => {
    const { unlinkByName } = await import("../src/engine/target.ts")
    expect(unlinkByName("unlink all the contact form to server links", B, null)).toEqual([
      { target: "@contact-form", unlink: "@server" },
      { target: "@contact-form", unlink: "@server2" },
    ])
    expect(unlinkByName("disconnect the contact form and server2", B, null)).toEqual([{ target: "@contact-form", unlink: "@server2" }])
    expect(unlinkByName("remove the arrows between the contact form and the pricing page", B, null)).toEqual([
      { target: "@contact-form", unlink: "@pricing-page" },
    ])
    expect(unlinkByName("unlink it", B, "@contact-form")).toEqual([{ target: "@contact-form", unlink: "*" }])
    expect(unlinkByName("remove the footer", B, "@contact-form")).toBeNull()
  })
})

test("'take everything out of the landing page and make it blank again' removes all its parts, nothing else", () => {
  for (const text of [
    "take everything out of the landing page and make it blank again",
    "clear it",
    "make it blank",
    "remove everything inside it",
  ]) {
    const t = readTargeted(text, "@landing-page", H)
    expect(t.patches.map((p) => p.target).sort()).toEqual(["@footer", "@get-started", "@hero", "@subtitle"])
    expect(t.patches.every((p) => p.remove)).toBe(true)
    expect(t.command).toBe(true)
  }
})

test("a new page while something is targeted goes on the board, not inside it", async () => {
  const { placeInTarget } = await import("../src/engine/target.ts")
  const g = placeInTarget(
    {
      nodes: [
        { key: "p0", type: "page", label: "Landing page", parent: null, props: {} },
        { key: "p1", type: "input", label: "Phone", parent: null, props: {} },
      ],
      edges: [],
      suggestions: [],
      patches: [],
    },
    "@footer",
    H,
  )
  expect(g.nodes.map((n) => [n.key, n.parent])).toEqual([
    ["p0", null],
    ["p1", "@footer"],
  ])
})

test("relinking two elements that are already linked adds nothing; after an unlink it restores one arrow", async () => {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const anchor = { x: 0, y: 0 }
  c.send(new SetInput({ text: "a contact form calls a server", anchor }))
  c.send(new Commit())
  const first = await c.waitFor(is("NodesCommitted"))
  expect(first.edges).toHaveLength(1)
  const [form, srv] = [first.nodes.find((n) => n.type === "form")!, first.nodes.find((n) => n.type === "service")!]
  c.send(new SetInput({ text: `relink ${form.handle} and ${srv.handle}`, anchor }))
  await Bun.sleep(200)
  const d = c.received.filter(is("DraftUpdated", (m) => m.draft.text.startsWith("relink"))).at(-1)
  expect(d?.draft.edges ?? []).toEqual([])
  c.send(new SetInput({ text: "", anchor }))
  c.send(new SetInput({ text: `unlink ${form.handle} from ${srv.handle}`, anchor }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("unlink")))
  c.send(new Commit())
  await c.waitFor(is("NodesRemoved"))
  c.send(new SetInput({ text: `relink ${form.handle} and ${srv.handle}`, anchor }))
  await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("relink") && m.draft.edges.length === 1))
  c.send(new Commit())
  const again = await c.waitFor(is("NodesCommitted", (m) => m.edges.length === 1 && m.nodes.length === 0))
  expect(again.edges[0]).toMatchObject({ from: form.id, to: srv.id })
})

test("retyping into a collection keeps count and kind: 'change this to a list of contacts 4 of them'", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const H2 = new Map([["@contact-form", { container: true, type: "form" as never, label: "Contact form", parent: null, items: ["Name", "Email", "Message"] }]])
  const run = (text: string) => interpret({ text, handles: H2, peek: () => undefined, memory: new Map(), target: "@contact-form" }).graph
  expect(run("change this to a list of contacts 4 of them").patches).toEqual([
    { target: "@contact-form", type: "list", of: "contact", items: ["Contact 1", "Contact 2", "Contact 3", "Contact 4"] },
  ])
  expect(run("make it 3 contacts").patches).toEqual([
    { target: "@contact-form", type: "list", of: "contact", items: ["Contact 1", "Contact 2", "Contact 3"] },
  ])
  expect(run("turn it into a table of timers").patches).toEqual([{ target: "@contact-form", type: "table", of: "timer" }])
  expect(run("make it red").patches).toEqual([{ target: "@contact-form", color: "#e03131" }])
})

test("'change to a clock' / 'make it a clock' with a target changes the element itself", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const H2 = new Map([["@contact-form", { container: true, type: "form" as never, label: "Contact form", parent: null }]])
  for (const text of ["change to a clock", "turn into a clock", "make it a clock", "change it to a clock"]) {
    const g = interpret({ text, handles: H2, peek: () => undefined, memory: new Map(), target: "@contact-form" }).graph
    expect(g.nodes).toEqual([])
    expect(g.patches).toEqual([{ target: "@contact-form", type: "clock" }])
  }
})

describe("disconnect cuts only the arrow to what you name", () => {
  const S = new Map<string, Info>([
    ["@in-touch-modal", { container: true, type: "modal" as never, label: "In touch modal", parent: null }],
    ["@just-email", { container: true, type: "modal" as never, label: "Just email", parent: "@in-touch-modal" }],
    ["@server1", { container: false, type: "service" as never, label: "Server1", parent: null }],
    ["@server-2", { container: false, type: "service" as never, label: "Server 2", parent: null }],
    ["@server-3", { container: false, type: "service" as never, label: "Server 3", parent: null }],
  ])
  test.each([
    ["disconnect @in-touch-modal from server 2", null, [{ target: "@in-touch-modal", unlink: "@server-2" }]],
    ["disconnect @in-touch-modal from server 1", null, [{ target: "@in-touch-modal", unlink: "@server1" }]],
    ["unlink @just-email from the server 3", null, [{ target: "@just-email", unlink: "@server-3" }]],
    ["disconnect from server 2", "@in-touch-modal", [{ target: "@in-touch-modal", unlink: "@server-2" }]],
    ["disconnect it from server 3", "@in-touch-modal", [{ target: "@in-touch-modal", unlink: "@server-3" }]],
    ["disconnect @in-touch-modal from everything", null, [{ target: "@in-touch-modal", unlink: "*" }]],
    ["disconnect from everything", "@in-touch-modal", [{ target: "@in-touch-modal", unlink: "*" }]],
  ] as const)("%p", async (text, target, patches) => {
    const { interpret } = await import("../src/engine/index.ts")
    const g = interpret({ text, handles: S, peek: () => undefined, memory: new Map(), target })
    expect(g.graph.patches).toEqual(patches as never)
  })
  test("naming something that isn't there cuts nothing", async () => {
    const { interpret } = await import("../src/engine/index.ts")
    const g = interpret({ text: "disconnect @in-touch-modal from server 9", handles: S, peek: () => undefined, memory: new Map() })
    expect(g.graph.patches.some((p) => p.unlink === "*")).toBe(false)
  })
})

describe("remove existing elements by name (no target, no @ needed)", () => {
  const R = new Map<string, Info>([
    ["@contact-form", { container: true, type: "form" as never, label: "Contact form", parent: null }],
    ["@server1", { container: false, type: "service" as never, label: "Server1", parent: null }],
    ["@server2", { container: false, type: "service" as never, label: "Server2", parent: null }],
    ["@server3", { container: false, type: "service" as never, label: "Server3", parent: null }],
  ])
  const run = async (text: string) => {
    const { interpret } = await import("../src/engine/index.ts")
    return interpret({ text, handles: R, peek: () => undefined, memory: new Map() }).graph
  }
  test("'remove server1' removes Server1 (never a new 'Remove server1' element)", async () => {
    const g = await run("remove server1")
    expect(g.nodes).toEqual([])
    expect(g.patches).toEqual([{ target: "@server1", remove: true }])
  })
  test("several, a tag, all of a kind", async () => {
    expect((await run("delete server 1 and server 3")).patches).toEqual([
      { target: "@server1", remove: true },
      { target: "@server3", remove: true },
    ])
    expect((await run("remove @contact-form")).patches).toEqual([{ target: "@contact-form", remove: true }])
    expect((await run("remove all servers")).patches.map((p) => p.target)).toEqual(["@server1", "@server2", "@server3"])
  })
  test("a name that matches nothing removes nothing and makes nothing", async () => {
    const g = await run("remove server9")
    expect(g.patches).toEqual([])
    expect(g.nodes.some((n) => /remove/i.test(n.label))).toBe(false)
  })
})

test("'make cta a left sidebar and footer a right sidebar' changes both in place, never a new element", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const P = new Map<string, Info>([
    ["@blank-page", { container: true, type: "section" as never, label: "Blank page", parent: null }],
    ["@cta", { container: false, type: "button" as never, label: "Cta", parent: "@blank-page" }],
    ["@footer", { container: true, type: "section" as never, label: "Footer", parent: "@blank-page" }],
  ])
  for (const target of [null, "@blank-page"]) {
    const g = interpret({ text: "make cta a left sidebar and footer a right sidebar", handles: P, peek: () => undefined, memory: new Map(), target }).graph
    expect(g.nodes).toEqual([])
    expect(g.patches).toEqual([
      { target: "@cta", label: "Left Sidebar", type: "section" },
      { target: "@footer", label: "Right Sidebar", type: "section" },
    ])
  }
})

test("renaming the targeted element (or a part of it), quotes or not", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const M = new Map<string, Info>([
    ["@in-touch-modal", { container: true, type: "modal" as never, label: "In touch modal", parent: null }],
    ["@inner", { container: true, type: "modal" as never, label: "On the inside just have a username modal", parent: "@in-touch-modal" }],
    ["@username-input", { container: false, type: "input" as never, label: "Username input only", parent: "@inner" }],
  ])
  const run = (text: string, target: string) => interpret({ text, handles: M, peek: () => undefined, memory: new Map(), target }).graph
  for (const [text, target, patch] of [
    ['edit the name to title from "On the inside just have a username modal" to "username"', "@inner", { target: "@inner", label: "Username" }],
    ["rename it to Sign in", "@inner", { target: "@inner", label: "Sign in" }],
    ["rename to Sign in", "@inner", { target: "@inner", label: "Sign in" }],
    ["call it Login", "@inner", { target: "@inner", label: "Login" }],
    ["set the heading to Welcome back", "@inner", { target: "@inner", label: "Welcome back" }],
    ["change the name of the username input to Email", "@in-touch-modal", { target: "@username-input", label: "Email" }],
    ["rename the username input to Handle", "@in-touch-modal", { target: "@username-input", label: "Handle" }],
  ] as const) {
    const g = run(text, target)
    expect(g.nodes).toEqual([])
    expect(g.patches).toEqual([patch])
  }
})

test("same-sentence ordering, and 'turn the cta and footer into a 2 column layout' with no stray elements", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const run = (text: string, handles = new Map(), target: string | null = null) =>
    interpret({ text, handles, peek: () => undefined, memory: new Map(), target }).graph
  expect(run("a landing page with a header, hero, footer and cta, and put the cta before the footer").nodes.map((n) => n.label)).toEqual([
    "Landing page",
    "Header",
    "Hero",
    "Cta",
    "Footer",
  ])

  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const anchor = { x: 0, y: 0 }
  c.send(new SetInput({ text: "a landing page with a header, a hero, a cta button and a footer", anchor }))
  c.send(new Commit())
  const made = (await c.waitFor(is("NodesCommitted"))).nodes
  const page = made.find((n) => n.type === "page")!
  const cta = made.find((n) => n.label.toLowerCase().includes("cta"))!
  const footer = made.find((n) => n.label === "Footer")!
  c.send(new SetInput({ text: "turn the cta and footer into a 2 column layout, cta on the left and footer on the right", anchor, target: page.id }))
  const d = await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("turn")))
  expect(d.draft.nodes.map((n) => n.label)).toEqual(["Two columns", "Left column", "Right column"])
  c.send(new Commit())
  const made2 = (await c.waitFor(is("NodesCommitted", (m) => m.nodes.some((n) => n.label === "Two columns")))).nodes
  const row = made2.find((n) => n.label === "Two columns")!
  const [leftCol, rightCol] = [made2.find((n) => n.label === "Left column")!, made2.find((n) => n.label === "Right column")!]
  expect(row.parent).toBe(page.id)
  expect([leftCol.parent, rightCol.parent]).toEqual([row.id, row.id])
  const moved = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === cta.id) && m.nodes.some((n) => n.id === footer.id)))
  expect(moved.nodes.find((n) => n.id === cta.id)!.parent).toBe(leftCol.id)
  expect(moved.nodes.find((n) => n.id === footer.id)!.parent).toBe(rightCol.id)
})

test("move by tag or name, no selection: 'move @hero after the footer' reorders, never creates", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const run = (text: string) => interpret({ text, handles: H, peek: () => undefined, memory: new Map() }).graph
  expect(run("move @hero after the footer")).toMatchObject({ nodes: [], patches: [{ target: "@hero", after: "@footer" }] })
  expect(run("put the subtitle before @hero")).toMatchObject({ nodes: [], patches: [{ target: "@subtitle", before: "@hero" }] })
  expect(run("move the footer to the end")).toMatchObject({ nodes: [], patches: [{ target: "@footer", after: "$bottom" }] })
  // Names nothing that's there: nothing moves, nothing is made.
  expect(run("move @hero after the pricing table")).toMatchObject({ nodes: [], patches: [] })
})

test("ordering phrases in the same sentence: 'do the footer at the end', 'footer goes last'", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const P = new Map([["@blank-page", { container: true, type: "page" as never, label: "Blank page", parent: null }]])
  for (const text of ["add a header, cta, footer, and hero. do the footer at the end", "add a header, cta, footer and hero, the footer goes last"]) {
    const g = interpret({ text, handles: P, peek: () => undefined, memory: new Map(), target: "@blank-page" }).graph
    expect(g.nodes.map((n) => n.label)).toEqual(["Header", "Cta", "Hero", "Footer"])
  }
})

test("'make @hero and @cta sidebars, hero is a leftsidebar and cta is a right sidebar'", async () => {
  const { interpret } = await import("../src/engine/index.ts")
  const P = new Map<string, Info>([
    ["@blank-page", { container: true, type: "page" as never, label: "Blank page", parent: null }],
    ["@hero", { container: false, type: "hero" as never, label: "Hero", parent: "@blank-page" }],
    ["@cta", { container: false, type: "button" as never, label: "Cta", parent: "@blank-page" }],
  ])
  const g = interpret({ text: "make @hero and @cta sidebars, hero is a leftsidebar and cta is a right sidebar", handles: P, peek: () => undefined, memory: new Map() }).graph
  expect(g.nodes).toEqual([])
  expect(g.patches).toEqual([
    { target: "@hero", label: "Left Sidebar", type: "section" },
    { target: "@cta", label: "Right Sidebar", type: "section" },
  ])
})

describe("column layouts with named slots", () => {
  const C = new Map<string, Info>([
    ["@blank-page", { container: true, type: "page" as never, label: "Blank page", parent: null }],
    ["@hero", { container: false, type: "hero" as never, label: "Hero", parent: "@blank-page" }],
    ["@cta-button", { container: false, type: "button" as never, label: "Cta button", parent: "@blank-page" }],
    ["@two-columns", { container: true, type: "section" as never, label: "Two columns", parent: "@blank-page" }],
    ["@left-column", { container: true, type: "section" as never, label: "Left column", parent: "@two-columns" }],
  ])
  const run = async (text: string, target: string | null = null) => {
    const { interpret } = await import("../src/engine/index.ts")
    return interpret({ text, handles: C, peek: () => undefined, memory: new Map(), target }).graph
  }
  test("'a 2 column layout' makes a row with a Left and a Right column", async () => {
    const g = await run("a 2 column layout", "@blank-page")
    expect(g.nodes.map((n) => [n.label, n.parent])).toEqual([
      ["Two columns", "@blank-page"],
      ["Left column", "columns"],
      ["Right column", "columns"],
    ])
  })
  test("parts named for a side go in that column: existing ones move, new ones are made there", async () => {
    const g = await run("add a 2 column layout with the cta on the left and a pricing table on the right", "@blank-page")
    expect(g.patches).toEqual([{ target: "@cta-button", parent: "columns.0" }])
    expect(g.nodes.at(-1)).toMatchObject({ label: "Pricing table", parent: "columns.1" })
  })
  test("'put the hero in the left column' moves it into that slot", async () => {
    expect((await run("put the hero in the left column")).patches).toEqual([{ target: "@hero", parent: "@left-column" }])
  })
  test("a 'make …' edit on an existing element never spawns new elements", async () => {
    expect((await run("make @hero something weird and unknown")).nodes).toEqual([])
  })
})
