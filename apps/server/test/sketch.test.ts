import { describe, expect, test } from "bun:test"
import { analyzeSketch, describeSketch, guessSketch, type Pt, shapeOf } from "../src/engine/sketch.ts"

/** A hand-drawn-ish outline: points along the edges with a little wobble. */
const rect = (x: number, y: number, w: number, h: number, n = 40): Pt[] => {
  const out: Pt[] = []
  const per = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ] as const
  for (const [x1, y1, x2, y2] of per)
    for (let i = 0; i < n / 4; i++) {
      const t = i / (n / 4)
      out.push({ x: x1 + (x2 - x1) * t + Math.sin(i) * 1.5, y: y1 + (y2 - y1) * t + Math.cos(i) * 1.5 })
    }
  out.push({ x: x + 2, y: y + 1 })
  return out
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 36): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) }))
const line = (x1: number, y1: number, x2: number, y2: number, n = 12): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n }))
const scribble = (x: number, y: number, w: number): Pt[] => Array.from({ length: 14 }, (_, i) => ({ x: x + (w * i) / 13, y: y + (i % 2 ? 8 : 0) }))
const guess = (...strokes: Pt[][]) => guessSketch(analyzeSketch(strokes)!)[0]

describe("strokes → shapes", () => {
  test("rectangle, circle, line, arrow", () => {
    expect(shapeOf(rect(0, 0, 200, 120))?.kind).toBe("rect")
    expect(shapeOf(ellipse(50, 50, 40, 40))?.kind).toBe("ellipse")
    expect(shapeOf(line(0, 0, 200, 4))).toMatchObject({ kind: "line", dir: "h" })
    // A line that doubles back at its end: an arrow.
    expect(shapeOf([...line(0, 0, 200, 0), { x: 180, y: -15 }])?.kind).toBe("arrow")
  })
})

describe("the cheat sheet, read by geometry", () => {
  test.each([
    ["modal: big box with a bar across the top", [rect(0, 0, 320, 240), line(10, 30, 310, 30), line(40, 120, 200, 120)], "modal"],
    ["form: box with stacked short lines", [rect(0, 0, 260, 260), line(20, 60, 200, 60), line(20, 120, 200, 120), line(20, 180, 200, 180)], "form"],
    ["input: wide, short box", [rect(0, 0, 260, 44)], "input"],
    ["button: small box with a scribble", [rect(0, 0, 120, 50), scribble(20, 20, 70)], "button"],
    ["image: box with an X", [rect(0, 0, 200, 150), line(0, 0, 200, 150), line(200, 0, 0, 150)], "image"],
    ["contact: box with a circle and lines", [rect(0, 0, 260, 120), ellipse(50, 60, 25, 25), line(100, 40, 220, 40), line(100, 80, 200, 80)], "contact"],
    ["text: lines with no box", [scribble(0, 0, 200), scribble(0, 30, 180)], "text"],
    ["avatar: a circle", [ellipse(60, 60, 50, 50)], "avatar"],
    ["database: flat oval on two sides", [ellipse(100, 20, 80, 18), line(20, 20, 20, 160), line(180, 20, 180, 160), line(20, 160, 180, 160)], "database"],
    ["service: plain box", [rect(0, 0, 220, 140)], "service"],
    ["queue: box with vertical stripes", [rect(0, 0, 260, 80), line(70, 5, 70, 75), line(130, 5, 130, 75), line(190, 5, 190, 75)], "queue"],
  ] as const)("%s", (_, strokes, want) => {
    expect(guess(...(strokes as unknown as Pt[][]))).toBe(want)
  })
  test("a form's field count comes from the lines drawn", () => {
    const s = analyzeSketch([rect(0, 0, 260, 260), line(20, 60, 200, 60), line(20, 120, 200, 120), line(20, 180, 200, 180)])!
    expect(s.fieldCount).toBe(3)
  })
})

test("the description Jev reads says what's drawn and what's inside what", () => {
  const s = analyzeSketch([rect(0, 0, 320, 240), line(10, 30, 310, 30), line(40, 120, 200, 120)])!
  const d = describeSketch(s, "Landing page (page)")
  expect(d).toContain("a sketch of a large box")
  expect(d).toContain("horizontal line")
  expect(d).toContain("drawn inside: Landing page (page)")
})

import { Commit, Join, SetInput, SetSketch, StepDraft } from "@rtw/shared"
import { afterEach } from "bun:test"
import { is, startServer, TestClient } from "./helpers.ts"

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function room() {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const a = await TestClient.connect(server.url, "r")
  const b = await TestClient.connect(server.url, "r")
  cleanups.push(() => a.close(), () => b.close())
  a.send(new Join({ name: "Ada", color: "#e11d48" }))
  await a.waitFor(is("Welcome"))
  b.send(new Join({ name: "Bo", color: "#2563eb" }))
  await b.waitFor(is("Welcome"))
  return { a, b }
}

describe("drawing mode over the protocol", () => {
  test("a drawn form becomes a private draft where it was drawn, with its fields; Enter commits it", async () => {
    const { a, b } = await room()
    const form = [rect(400, 300, 260, 260), line(420, 360, 600, 360), line(420, 420, 600, 420), line(420, 480, 600, 480)]
    a.send(new SetSketch({ strokes: form }))
    const d = await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes.length === 1))
    expect(d.draft.nodes[0]).toMatchObject({ type: "form", label: "Form", parent: null, props: { items: ["Name", "Email", "Password"] } })
    // Where it was drawn (give or take the hand's wobble).
    expect(Math.abs(d.draft.nodes[0]!.x - 400)).toBeLessThan(4)
    expect(Math.abs(d.draft.nodes[0]!.y - 300)).toBeLessThan(4)
    expect(d.draft.history).toMatchObject({ at: 1, total: 1, label: "Form" })
    // Bo only sees that Ada is drawing.
    const presence = await b.waitFor(is("UserTyping", (m) => m.typing))
    expect(presence.drawing).toBe(true)
    expect(b.received.some((m) => m._tag === "DraftUpdated")).toBe(false)
    a.send(new Commit())
    const c = await b.waitFor(is("NodesCommitted"))
    expect(c.nodes[0]).toMatchObject({ type: "form", handle: "@form" })
  })

  test("drawn inside a page: it becomes the page's child; › offers the next-best", async () => {
    const { a } = await room()
    a.send(new SetInput({ text: "a landing page with a hero", anchor: { x: 0, y: 0 } }))
    a.send(new Commit())
    const page = (await a.waitFor(is("NodesCommitted"))).nodes.find((n) => n.type === "page")!
    a.send(new SetSketch({ strokes: [rect(10, 10, 260, 44)], inside: page.id }))
    const d = await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes[0]?.type === "input"))
    expect(d.draft.nodes[0]!.parent).toBe(page.id)
    a.send(new StepDraft({ delta: 1 }))
    const next = await a.waitFor(is("DraftUpdated", (m) => m.draft.history?.at === 2))
    expect(next.draft.history).toMatchObject({ total: 2, label: "Button" })
    expect(next.draft.nodes[0]!.type).toBe("button")
  })

  test("an arrow from one element to another becomes a real arrow between them", async () => {
    const { a } = await room()
    a.send(new SetInput({ text: "an api. a postgres database", anchor: { x: 0, y: 0 } }))
    a.send(new Commit())
    const made = (await a.waitFor(is("NodesCommitted"))).nodes
    const [api, pg] = [made.find((n) => n.type === "service")!, made.find((n) => n.type === "database")!]
    const stroke = [...line(100, 100, 400, 100), { x: 380, y: 85 }]
    a.send(new SetSketch({ strokes: [stroke], hits: [{ start: api.id, end: pg.id }] }))
    const d = await a.waitFor(is("DraftUpdated", (m) => m.draft.edges.length === 1))
    expect(d.draft.edges[0]).toMatchObject({ from: api.id, to: pg.id, kind: "writes" })
    a.send(new Commit())
    const c = await a.waitFor(is("NodesCommitted", (m) => m.edges.length === 1))
    expect(c.edges[0]).toMatchObject({ from: api.id, to: pg.id })
  })

  test("clearing the sketch clears the draft", async () => {
    const { a } = await room()
    a.send(new SetSketch({ strokes: [rect(0, 0, 200, 140)] }))
    await a.waitFor(is("DraftUpdated"))
    a.send(new SetSketch({ strokes: [] }))
    await a.waitFor(is("DraftCleared"))
  })
})

test("a curved, hand-drawn arrow (head as its own stroke) still connects the two elements", async () => {
  const { a } = await room()
  a.send(new SetInput({ text: "a checkout page. a payments service", anchor: { x: 0, y: 0 } }))
  a.send(new Commit())
  const made = (await a.waitFor(is("NodesCommitted"))).nodes
  const [page, svc] = [made.find((n) => n.type === "page")!, made.find((n) => n.type === "service")!]
  // A wobbly arc from the page to the service, then a separate "v" head.
  const arc = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 12, y: 200 - Math.sin((i / 29) * Math.PI) * 90 + (i % 3) * 2 }))
  const head = [{ x: 440, y: 185 }, { x: 448, y: 200 }, { x: 432, y: 206 }]
  a.send(new SetSketch({ strokes: [arc, head], hits: [{ start: page.id, end: svc.id }, { start: svc.id, end: svc.id }] }))
  const d = await a.waitFor(is("DraftUpdated", (m) => m.draft.edges.length === 1))
  expect(d.draft.edges[0]).toMatchObject({ from: page.id, to: svc.id, kind: "calls" })
  expect(d.draft.nodes).toEqual([])
})

describe("hand-drawn realities", () => {
  test("a box drawn in two strokes (two L's) is still a box", () => {
    const l1 = [...line(0, 0, 200, 0), ...line(200, 0, 200, 140)]
    const l2 = [...line(200, 140, 0, 140), ...line(0, 140, 0, 4)]
    expect(guess(l1, l2)).toBe("service")
  })
  test("a box that doesn't quite close is still a box", () => {
    const open = [...line(0, 0, 220, 0), ...line(220, 0, 220, 150), ...line(220, 150, 0, 150), ...line(0, 150, 0, 40)]
    expect(guess(open)).toBe("service")
  })
  test("an X drawn in one stroke inside a box is an image, and the geometry's reading stands", async () => {
    const { strongGuess } = await import("../src/engine/sketch.ts")
    const x = [...line(10, 10, 190, 140), ...line(190, 140, 190, 10), ...line(190, 10, 10, 140)]
    const s = analyzeSketch([rect(0, 0, 200, 150), x])!
    expect(guessSketch(s)[0]).toBe("image")
    expect(strongGuess(s)).toBe(true)
    expect(describeSketch(s, null)).toContain("an X across it")
  })
})

test("real mouse input: a box drawn as two L's with an X in one stroke is an image", () => {
  const l1 = [...line(250, 200, 470, 200), ...line(470, 200, 470, 360)]
  const l2 = [...line(470, 360, 250, 360), ...line(250, 360, 250, 205)]
  const x = [...line(265, 215, 455, 345), ...line(455, 345, 455, 215), ...line(455, 215, 265, 345)]
  expect(guess(l1, l2, x)).toBe("image")
})

test("a stroke that starts on an element but reaches nothing makes nothing (never a Text element)", async () => {
  const { a } = await room()
  a.send(new SetInput({ text: "an api", anchor: { x: 0, y: 0 } }))
  a.send(new Commit())
  const [api] = (await a.waitFor(is("NodesCommitted"))).nodes
  const seen = a.received.length
  const arc = Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 10, y: 200 - Math.sin((i / 19) * Math.PI) * 40 }))
  a.send(new SetSketch({ strokes: [arc], hits: [{ start: api!.id, end: null }] }))
  await Bun.sleep(150)
  expect(a.received.slice(seen).some((m) => m._tag === "DraftUpdated" && m.draft.nodes.length > 0)).toBe(false)
})
