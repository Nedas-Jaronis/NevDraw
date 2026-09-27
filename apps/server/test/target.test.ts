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
    expect(readTargeted("rename the subtitle to Tagline", "@landing-page", H).rest).toBe("rename @subtitle to Tagline")
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
