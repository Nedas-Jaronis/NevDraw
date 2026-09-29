import { describe, expect, test } from "bun:test"
import type { BoardNode, EntryGraph } from "@rtw/shared"
import { parse as markup, Tagger, type TaggedSpan } from "@rtw/parser"
import { existsSync } from "node:fs"
import { interpretOffline } from "../src/engine/index.ts"
import { sensibleParents } from "../src/engine/materialize.ts"
import { cleanLabel, nestFromModel, placeFromModel, readWithModel, relationOf } from "../src/parse/nesting.ts"
import { DEFAULT_MODEL_DIR, norm, shadowEntry } from "../src/parse/Parser.ts"

/** Spans from markup, as if the model had read them (confidence 1). */
const read = (line: string): { text: string; spans: TaggedSpan[] } => {
  const ex = markup(line)
  return { text: ex.text, spans: ex.spans.map((s) => ({ ...s, confidence: 1, arcs: s.arcs?.map((a) => ({ ...a, confidence: 1 })) })) }
}

let seq = 0
const node = (label: string, parent: BoardNode | null = null): BoardNode =>
  ({ id: `n${seq++}`, label, type: "section", parent: parent?.id ?? null, order: 0, x: 0, y: 0, props: {} }) as unknown as BoardNode

describe("shadow comparison", () => {
  test("names compare across numbering, plurals and articles", () => {
    expect(norm("Load balancer 2")).toBe(norm("load balancers"))
    expect(norm("the Independent database 1")).toBe(norm("independent databases"))
    expect(norm("@hero")).toBe(norm("Hero"))
  })

  test("the same nesting agrees", () => {
    const { text, spans } = read("a [landing page](INSTANCE) with a [hero](INSTANCE in:landing page) with a [headline](INSTANCE in:hero)")
    const page = node("Landing page")
    const hero = node("Hero", page)
    const e = shadowEntry(text, spans, { nodes: [page, hero, node("Headline", hero)], edges: [] }, "test")
    expect(e.agree).toBe(true)
  })

  test("a flat board disagrees with a nested reading (the headline outside the hero)", () => {
    const { text, spans } = read("a [landing page](INSTANCE) with a [hero](INSTANCE in:landing page) with a [headline](INSTANCE in:hero)")
    const page = node("Landing page")
    const e = shadowEntry(text, spans, { nodes: [page, node("Hero", page), node("Headline", page)], edges: [] }, "test")
    expect(e.agree).toBe(false)
    expect(e.modelInside).toContain(`${norm("headline")}<${norm("hero")}`)
    expect(e.boardInside).toContain(`${norm("headline")}<${norm("landing page")}`)
  })

  test("back-references stand for what they mean, so edges compare by the thing", () => {
    const { text, spans } = read(
      "[2](COUNT mod:load balancers) [load balancers](INSTANCE) and [5](COUNT mod:independent data bases) [independent data bases](INSTANCE). the [load balancers](REF same:load balancers~1 src:connect to) [connect to](RELATION) the [databases](REF same:independent data bases dst:connect to)",
    )
    const lb = node("Load balancer 1")
    const db = node("Independent database 1")
    const e = shadowEntry(text, spans, { nodes: [lb, db], edges: [{ id: "e1", from: lb.id, to: db.id } as never] }, "test")
    expect(e.modelEdges).toEqual([`${norm("load balancers")}>${norm("independent data bases")}`])
    expect(e.agree).toBe(true)
  })
})

// The real model, only where it has been fetched (`bun run fetch-model`); CI without it skips.
describe.skipIf(!existsSync(`${DEFAULT_MODEL_DIR}/model.onnx`))("the fetched model", () => {
  test("reads nesting and back-references", async () => {
    const tagger = await Tagger.load(DEFAULT_MODEL_DIR, { int8: false })
    const text = "a landing page with a navbar, a hero with a headline and two buttons, and a footer"
    const spans = await tagger.tag(text)
    const said = (i: number) => text.slice(spans[i]!.start, spans[i]!.end)
    const inside = spans.flatMap((s, i) => (s.arcs ?? []).filter((a) => a.label === "in").map((a) => `${said(i)} < ${said(a.head)}`))
    expect(inside).toEqual(["navbar < landing page", "hero < landing page", "headline < hero", "buttons < hero", "footer < landing page"])
  })
})

describe("the model decides nesting (PARSER=on)", () => {
  const sentence =
    "a [landing page](INSTANCE) with a [navbar](INSTANCE in:landing page), a [hero](INSTANCE in:landing page) with a [headline](INSTANCE in:hero) and [two](COUNT mod:buttons) [buttons](INSTANCE in:hero), and a [footer](INSTANCE in:landing page)"

  test("today's reading puts the headline and buttons in the page; the model moves them into the hero", () => {
    const { text, spans } = read(sentence)
    const before = interpretOffline(text)
    const label = (key: string | null) => before.nodes.find((n) => n.key === key)?.label ?? null
    const headline = before.nodes.find((n) => n.label === "Headline")!
    expect(label(headline.parent)).toBe("Landing page")

    const after = nestFromModel(before, text, spans)
    const byKey = new Map(after.nodes.map((n) => [n.key, n]))
    const parentLabel = (l: string) => byKey.get(after.nodes.find((n) => n.label === l)!.parent ?? "")?.label ?? null
    expect(parentLabel("Headline")).toBe("Hero")
    expect(parentLabel("Buttons")).toBe("Hero")
    expect(parentLabel("Hero")).toBe("Landing page")
    expect(parentLabel("Footer")).toBe("Landing page")
    // The two buttons stay inside their group; only the group moved.
    expect(after.nodes.filter((n) => n.label === "Button").every((n) => byKey.get(n.parent!)?.label === "Buttons")).toBe(true)
  })

  test("the hero keeps them when the draft is materialized (it holds text, buttons and groups)", () => {
    const { text, spans } = read(sentence)
    const g = nestFromModel(interpretOffline(text), text, spans)
    const kept = sensibleParents(g, { byHandle: new Map(), byId: new Map() } as never)
    const hero = kept.nodes.find((n) => n.label === "Hero")!
    expect(kept.nodes.filter((n) => n.parent === hero.key).map((n) => n.label).sort()).toEqual(["Buttons", "Headline"])
  })

  test("unsure links and names it can't match leave today's reading alone", () => {
    const { text, spans } = read(sentence)
    const unsure = spans.map((s) => ({ ...s, arcs: s.arcs?.map((a) => ({ ...a, confidence: 0.4 })) }))
    const g = interpretOffline(text)
    expect(nestFromModel(g, text, unsure)).toBe(g)
    const other = read("a [pricing table](INSTANCE) with a [toggle](INSTANCE in:pricing table)")
    expect(nestFromModel(g, other.text, other.spans)).toBe(g)
  })

  test("never makes a loop", () => {
    const { text, spans } = read("a [hero](INSTANCE in:headline) with a [headline](INSTANCE in:hero)")
    const g: EntryGraph = {
      nodes: [
        { key: "a", type: "hero", label: "Hero", parent: null, props: {} },
        { key: "b", type: "text", label: "Headline", parent: "a", props: {} },
      ],
      edges: [],
      suggestions: [],
      patches: [],
    }
    expect(nestFromModel(g, text, spans).nodes.find((n) => n.key === "a")!.parent).toBe(null)
  })

  test("a label carrying its position still matches ('Sidebar on the left'), and loses the position words", () => {
    const { text, spans } = read(
      "a [dashboard](INSTANCE) with a [sidebar](INSTANCE in:dashboard) [on the left](ATTR mod:sidebar) containing a [search bar](INSTANCE in:sidebar) and [5](COUNT mod:nav links) [nav links](INSTANCE in:sidebar)",
    )
    // As Jev read it: everything straight inside the dashboard.
    const g = interpretOffline(text)
    const dash = g.nodes.find((n) => n.label === "Dashboard")!.key
    const flat: EntryGraph = { ...g, nodes: g.nodes.map((n) => (n.label === "Search bar" || n.label === "Nav links" ? { ...n, parent: dash } : n)) }
    const out = nestFromModel(flat, text, spans)
    const side = out.nodes.find((n) => n.type === "section" && /sidebar/i.test(n.label))!
    expect(side.label).toBe("Sidebar")
    expect(out.nodes.filter((n) => n.parent === side.key).map((n) => n.label).sort()).toEqual(["Nav links", "Search bar"])
    expect(out.nodes.filter((n) => n.label === "Nav link").every((n) => n.type === "link")).toBe(true)
  })

  test("only position words come out of a label; right stays as a leading word", () => {
    expect(cleanLabel("sidebar", "Sidebar on the left")).toBe("Sidebar")
    expect(cleanLabel("sidebar", "Sidebar on the right")).toBe("Right sidebar")
    expect(cleanLabel("navbar", "Navy navbar")).toBe(null)
  })
})

describe("the model decides placement (PARSER=on)", () => {
  /** Top-down tree as "label(children)", siblings in draft order. */
  const tree = (g: EntryGraph, parent: string | null = null): string =>
    g.nodes
      .filter((n) => n.parent === parent)
      .map((n) => {
        const kids = tree(g, n.key)
        return kids ? `${n.label}(${kids})` : n.label
      })
      .join(", ")
  const place = (line: string) => {
    const { text, spans } = read(line)
    return readWithModel(interpretOffline(text), text, spans)
  }

  test("positions normalize to a few relations", () => {
    expect(relationOf("on thr right side", true)).toBe("right")
    expect(relationOf("to the left", true)).toBe("left")
    expect(relationOf("next to", true)).toBe("right")
    expect(relationOf("underneath", true)).toBe("below")
    expect(relationOf("at the top", false)).toBe("top")
    expect(relationOf("last", false)).toBe("bottom")
    expect(relationOf("dashed border", false)).toBe(null)
  })

  test("'on the right side of the sidebar we include a hero': the hero sits beside the sidebar, in the dashboard", () => {
    const g = place(
      "a [dashboard](INSTANCE) with a [sidebar](INSTANCE in:dashboard) [on the left](ATTR mod:sidebar) containing a [search bar](INSTANCE in:sidebar) and [5](COUNT mod:nav links) [nav links](INSTANCE in:sidebar). [on thr right side](ATTR mod:hero) of the [sidebar](REF same:sidebar dst:on thr right side) we include a [hero](INSTANCE)",
    )
    const dash = g.nodes.find((n) => n.label === "Dashboard")!
    const kids = g.nodes.filter((n) => n.parent === dash.key).map((n) => n.label)
    expect(kids).toEqual(["Sidebar", "Hero"])
    const side = g.nodes.find((n) => n.label === "Sidebar")!
    expect(g.nodes.filter((n) => n.parent === side.key).map((n) => n.label)).toEqual(["Search bar", "Nav links"])
  })

  test("side by side with something that isn't a sidebar: a row around the two, left one first", () => {
    const g = place(
      "a [settings page](INSTANCE) with a [form](INSTANCE in:settings page) and a [chat panel](INSTANCE) [to the left](ATTR mod:chat panel) of the [form](REF same:form dst:to the left)",
    )
    const row = g.nodes.find((n) => n.props.layout === "row")!
    expect(row.type).toBe("section")
    expect(g.nodes.find((n) => n.key === row.parent)!.label).toBe("Settings page")
    expect(g.nodes.filter((n) => n.parent === row.key).map((n) => n.label)).toEqual(["Chat panel", "Form"])
  })

  test("edges inside a holder: 'an image on the left and a headline on the right' makes the hero a row", () => {
    const g = place("a [hero](INSTANCE) with an [image](INSTANCE in:hero) [on the left](ATTR mod:image) and a [headline](INSTANCE in:hero) [on the right](ATTR mod:headline)")
    const hero = g.nodes.find((n) => n.label === "Hero")!
    expect(hero.props.layout).toBe("row")
    expect(g.nodes.filter((n) => n.parent === hero.key).map((n) => n.label)).toEqual(["Image", "Headline"])
  })

  test("below / above set the order among siblings", () => {
    const g = place(
      "a [landing page](INSTANCE) with a [hero](INSTANCE in:landing page) and a [pricing section](INSTANCE in:landing page). add a [faq section](INSTANCE) [below](ATTR mod:faq section) the [pricing section](REF same:pricing section dst:below)",
    )
    const page = g.nodes.find((n) => n.label === "Landing page")!
    expect(g.nodes.filter((n) => n.parent === page.key).map((n) => n.label)).toEqual(["Hero", "Pricing section", "Faq section"])
  })

  test("an anchor on the board is left to the board: after / before its @handle", () => {
    const { text, spans } = read("put a [chat panel](INSTANCE) [next to](ATTR mod:chat panel) [@editor](REF dst:next to)")
    const g = placeFromModel(
      { nodes: [{ key: "p0", type: "chat", label: "Chat panel", parent: null, props: {} }], edges: [], suggestions: [], patches: [] },
      text,
      spans,
    )
    expect(g.nodes[0]!.after).toBe("@editor")
  })
})
