import { describe, expect, test } from "bun:test"
import type { BoardNode } from "@rtw/shared"
import { parse as markup, Tagger, type TaggedSpan } from "@rtw/parser"
import { existsSync } from "node:fs"
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
