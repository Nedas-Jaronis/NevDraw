import type { EntryGraph } from "@rtw/shared"
import { describe, expect, test } from "bun:test"
import { keywordAnswers, type PieceAnswers } from "../src/engine/answers.ts"
import { assemble, countOf } from "../src/engine/assemble.ts"
import { interpretOffline, materialize } from "../src/engine/index.ts"
import { split } from "../src/engine/split.ts"

const user = { id: "u1", name: "Ada", color: "#e11d48", cursor: null }
const anchor = { x: 500, y: 400 }

/** Compact view of a graph: "type:label<parent-type" per node. */
function shape(g: EntryGraph) {
  const byKey = new Map(g.nodes.map((n) => [n.key, n]))
  return g.nodes.map((n) => `${n.type}:${n.label}${n.parent ? `<${byKey.get(n.parent)?.type}` : ""}`)
}

describe("split", () => {
  test("joiners become connectors", () => {
    expect(split("landing page with navbar, hero and pricing table")).toEqual([
      { index: 0, text: "landing page", connector: "start" },
      { index: 1, text: "navbar", connector: "with" },
      { index: 2, text: "hero", connector: "and" },
      { index: 3, text: "pricing table", connector: "and" },
    ])
  })

  test("sentences restart at top level", () => {
    expect(split("login page. api server and postgres").map((p) => p.connector)).toEqual(["start", "start", "and"])
  })

  test("half-typed joiners and filler are ignored", () => {
    expect(split("landing page with").map((p) => p.text)).toEqual(["landing page"])
    expect(split("landing page with a").map((p) => p.text)).toEqual(["landing page"])
    expect(split("landing page, ").map((p) => p.text)).toEqual(["landing page"])
  })

  test("indexes of earlier pieces never change while typing at the end", () => {
    const a = split("page with navbar, hero")
    const b = split("page with navbar, hero and pricing")
    expect(b.slice(0, a.length)).toEqual(a)
  })
})

describe("assemble (offline answers)", () => {
  test("the acceptance example nests four children in a page, in order", () => {
    expect(shape(interpretOffline("landing page with navbar, hero, pricing table and signup form"))).toEqual([
      "page:Landing page",
      "navbar:Navbar<page",
      "hero:Hero<page",
      "table:Pricing table<page",
      "form:Signup form<page",
    ])
  })

  test("nested containers: a form inside a page gets its own children", () => {
    expect(shape(interpretOffline("settings page with a form with email input and save button"))).toEqual([
      "page:Settings page",
      "form:Form<page",
      "input:Email input<form",
      "button:Save button<form",
    ])
  })

  test("'with' after a leaf nests under that leaf's parent", () => {
    const g = interpretOffline("page with hero with a signup button")
    expect(shape(g)).toEqual(["page:Page", "hero:Hero<page", "button:Signup button<page"])
  })

  test("layout phrases set the container's layout", () => {
    const g = interpretOffline("pricing section in a grid with three cards")
    expect(g.nodes[0]!.props.layout).toBe("grid")
    const grid = interpretOffline("landing page with six cards in a grid")
    expect(grid.nodes[0]!.props.layout).toBeUndefined()
    expect(grid.nodes[1]).toMatchObject({ type: "section", props: { layout: "grid" } })
  })

  test("counts become a row group of singular copies, leaving the page stacked", () => {
    const g = interpretOffline("dashboard page with navbar, three cards and a footer")
    expect(shape(g)).toEqual([
      "page:Dashboard page",
      "navbar:Navbar<page",
      "section:Cards<page",
      "card:Card<section",
      "card:Card<section",
      "card:Card<section",
      "section:Footer<page",
    ])
    expect(g.nodes.map((n) => n.key)).toEqual(["p0", "p1", "p2", "p2.0", "p2.1", "p2.2", "p3"])
    expect(g.nodes[0]!.props.layout).toBeUndefined()
    expect(g.nodes[2]!.props.layout).toBe("row")
    expect(countOf("12 widgets")).toBe(8) // capped
  })

  test("unknown text becomes a labeled box", () => {
    expect(shape(interpretOffline("zebra crossing"))).toEqual(["box:Zebra crossing"])
  })

  test("a confident childOfContainer answer nests without 'with' (the Jev hook)", () => {
    const pieces = split("checkout page, card input")
    const answers: PieceAnswers[] = pieces.map(keywordAnswers)
    answers[1] = { ...answers[1]!, childOfContainer: 0.9 }
    expect(shape(assemble(pieces, answers))).toEqual(["page:Checkout page", "input:Card input<page"])
  })
})

describe("materialize (key diff)", () => {
  let n = 0
  const newId = () => `id${++n}`

  test("typing more never changes earlier ids or positions", () => {
    const first = materialize({ graph: interpretOffline("landing page with navbar"), prev: undefined, anchor, user, newId })
    const second = materialize({
      graph: interpretOffline("landing page with navbar, hero and pricing"),
      prev: first,
      anchor: { x: 9999, y: 9999 }, // the viewport moved; existing nodes must not
      user,
      newId,
    })
    expect(second.nodes.slice(0, 2).map((x) => [x.id, x.x, x.y])).toEqual(first.nodes.map((x) => [x.id, x.x, x.y]))
    expect(second.nodes).toHaveLength(4)
  })

  test("a type change keeps the element's identity (it morphs instead of popping)", () => {
    const a = materialize({ graph: interpretOffline("post"), prev: undefined, anchor, user, newId })
    const b = materialize({ graph: interpretOffline("postgres"), prev: a, anchor, user, newId })
    expect(b.nodes[0]!.id).toBe(a.nodes[0]!.id)
    expect([a.nodes[0]!.type, b.nodes[0]!.type]).toEqual(["box", "database"])
  })

  test("children reference parent ids and carry sibling order", () => {
    const m = materialize({ graph: interpretOffline("page with navbar, hero and footer"), prev: undefined, anchor, user, newId })
    const [page, ...kids] = m.nodes
    expect(kids.every((k) => k.parent === page!.id)).toBe(true)
    expect(kids.map((k) => k.order)).toEqual([0, 1, 2])
  })

  test("several top-level elements are laid out left to right without overlapping", () => {
    const m = materialize({ graph: interpretOffline("login page. signup page"), prev: undefined, anchor, user, newId })
    const [a, b] = m.nodes
    expect(b!.x).toBeGreaterThan(a!.x + 320)
    expect(b!.y).toBe(a!.y)
  })

  test("removed keys disappear", () => {
    const a = materialize({ graph: interpretOffline("page with navbar and hero"), prev: undefined, anchor, user, newId })
    const b = materialize({ graph: interpretOffline("page with navbar"), prev: a, anchor, user, newId })
    expect(b.nodes.map((x) => x.label)).toEqual(["Page", "Navbar"])
  })
})
