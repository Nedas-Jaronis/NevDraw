/**
 * Drawing mode: strokes in, a component out. Code reads the geometry (what
 * shapes, what's inside what, how many lines) and describes it in words; Jev
 * picks the component from that description. These rules are the fallback
 * (and version 1) when Jev isn't there. Counting always stays in code.
 */
import type { NodeType } from "@rtw/shared"

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
export type Shape =
  | { kind: "rect" | "ellipse"; box: Box }
  | { kind: "line"; box: Box; from: Pt; to: Pt; dir: "h" | "v" | "diag" }
  | { kind: "arrow"; box: Box; from: Pt; to: Pt }
  | { kind: "scribble" | "peak"; box: Box }

/** The components a sketch can become (registry types), each with how it's drawn. */
export const DRAWABLE: Record<string, { type: NodeType; drawn: string }> = {
  modal: { type: "modal", drawn: "a large box with a bar or line across its top" },
  form: { type: "form", drawn: "a box holding several short horizontal lines or thin boxes, one per field" },
  input: { type: "input", drawn: "a wide, short box on its own" },
  button: { type: "button", drawn: "a small box, or a box with a scribble inside" },
  image: { type: "image", drawn: "a box with an X or a mountain peak inside" },
  card: { type: "card", drawn: "a box holding a smaller box (a picture) and a few lines of text" },
  contact: { type: "contact", drawn: "a box holding a small circle (a face) and a few lines" },
  text: { type: "text", drawn: "a few scribbled or straight lines with no box around them" },
  avatar: { type: "avatar", drawn: "a single circle" },
  database: { type: "database", drawn: "a cylinder: a flat oval on top of two vertical sides" },
  service: { type: "service", drawn: "a plain box with nothing inside" },
  queue: { type: "queue", drawn: "a box divided by vertical stripes" },
}
export type Drawable = keyof typeof DRAWABLE

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const boxOf = (pts: readonly Pt[]): Box => {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const inside = (p: Pt, b: Box, pad = 6) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad
const pathLength = (pts: readonly Pt[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i]!, p), 0)

/** Ramer–Douglas–Peucker: the stroke's corners. */
function simplify(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length < 3) return [...pts]
  const a = pts[0]!
  const b = pts.at(-1)!
  let far = 0
  let at = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!
    const d = dist(a, b) === 0 ? dist(p, a) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / dist(a, b)
    if (d > far) {
      far = d
      at = i
    }
  }
  if (far <= eps) return [a, b]
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)]
}

const angle = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x)
const turn = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

/** One stroke as a primitive shape. */
export function shapeOf(pts: readonly Pt[]): Shape | null {
  if (pts.length < 2) return null
  const box = boxOf(pts)
  const diag = Math.hypot(box.w, box.h)
  if (diag < 6) return null
  const len = pathLength(pts)
  const first = pts[0]!
  const last = pts.at(-1)!
  const closed = dist(first, last) < Math.max(18, 0.22 * diag) && len > 1.6 * diag
  if (closed) {
    // Rectangle or ellipse: which outline do the points hug?
    const c = center(box)
    const rx = Math.max(box.w / 2, 1)
    const ry = Math.max(box.h / 2, 1)
    const ellipseErr = pts.reduce((s, p) => s + Math.abs(Math.hypot((p.x - c.x) / rx, (p.y - c.y) / ry) - 1), 0) / pts.length
    const rectErr =
      pts.reduce((s, p) => s + Math.min(Math.abs(p.x - box.x), Math.abs(p.x - box.x - box.w), Math.abs(p.y - box.y), Math.abs(p.y - box.y - box.h)), 0) /
      pts.length /
      Math.max(Math.min(box.w, box.h), 1)
    return { kind: ellipseErr < rectErr * 1.1 && ellipseErr < 0.2 ? "ellipse" : "rect", box }
  }
  // A line with a head in one stroke: out to a tip, then a short flick back.
  let tip = 0
  for (let i = 1; i < pts.length; i++) if (dist(first, pts[i]!) > dist(first, pts[tip]!)) tip = i
  const reach = dist(first, pts[tip]!)
  const back = dist(pts[tip]!, last)
  if (tip < pts.length - 1 && reach > 40 && back > 6 && back < 0.4 * reach && pathLength(pts.slice(0, tip + 1)) < 1.15 * reach)
    return { kind: "arrow", box, from: first, to: pts[tip]! }
  const simple = simplify(pts, Math.max(4, 0.06 * diag))
  const chord = dist(first, last)
  // A line with a head: the stroke doubles back sharply near its end.
  if (simple.length >= 3 && simple.length <= 5) {
    const main = angle(simple[0]!, simple[1]!)
    const tail = angle(simple.at(-2)!, simple.at(-1)!)
    const mainLen = dist(simple[0]!, simple[1]!)
    if (turn(main, tail) > (2 * Math.PI) / 3 && dist(simple.at(-2)!, simple.at(-1)!) < 0.45 * mainLen)
      return { kind: "arrow", box, from: simple[0]!, to: simple[1]! }
  }
  if (chord > 0.9 * len) {
    const dx = Math.abs(last.x - first.x)
    const dy = Math.abs(last.y - first.y)
    return { kind: "line", box, from: first, to: last, dir: dx > 2 * dy ? "h" : dy > 2 * dx ? "v" : "diag" }
  }
  // "^": a single peak (a mountain in an image placeholder).
  if (simple.length === 3 && simple[1]!.y < Math.min(simple[0]!.y, simple[2]!.y) - 0.3 * box.h) return { kind: "peak", box }
  return { kind: "scribble", box }
}

/** A line + a small "v" at one of its ends = an arrow (drawn in two strokes). */
function joinArrowHeads(shapes: Shape[]): Shape[] {
  const out = [...shapes]
  for (const line of shapes) {
    if (line.kind !== "line") continue
    const len = dist(line.from, line.to)
    const head = out.find(
      (s) => s !== line && (s.kind === "scribble" || s.kind === "peak" || s.kind === "line") && Math.hypot(s.box.w, s.box.h) < 0.5 * len && (inside(line.to, s.box, 10) || inside(line.from, s.box, 10)),
    )
    if (!head) continue
    const atStart = inside(line.from, head.box, 10) && !inside(line.to, head.box, 10)
    out.splice(out.indexOf(head), 1)
    out.splice(out.indexOf(line), 1, { kind: "arrow", box: line.box, from: atStart ? line.to : line.from, to: atStart ? line.from : line.to })
  }
  return out
}

export type Sketch = {
  shapes: Shape[]
  box: Box
  /** The biggest closed shape, and what's drawn inside it. */
  outer: Shape | null
  inner: Shape[]
  arrow: (Shape & { kind: "arrow" }) | null
  /** Lines / thin boxes stacked inside: a form's fields. */
  fieldCount: number
}

export function analyzeSketch(strokes: readonly (readonly Pt[])[]): Sketch | null {
  const shapes = joinArrowHeads(strokes.map(shapeOf).filter((s): s is Shape => s !== null))
  if (!shapes.length) return null
  const box = boxOf(shapes.flatMap((s) => [{ x: s.box.x, y: s.box.y }, { x: s.box.x + s.box.w, y: s.box.y + s.box.h }]))
  const closed = shapes.filter((s) => s.kind === "rect" || s.kind === "ellipse").sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
  const outer = closed[0] ?? null
  const inner = outer ? shapes.filter((s) => s !== outer && inside(center(s.box), outer.box)) : []
  const arrow = shapes.length === 1 && shapes[0]!.kind === "arrow" ? (shapes[0] as Shape & { kind: "arrow" }) : null
  const fieldCount = inner.filter((s) => (s.kind === "line" && s.dir === "h") || (s.kind === "rect" && s.box.w > 2.5 * s.box.h)).length
  return { shapes, box, outer, inner, arrow, fieldCount }
}

/** The geometry's own reading, best first (the fallback, and ‹ › alternatives). */
export function guessSketch(s: Sketch): Drawable[] {
  const { outer, inner, shapes, box } = s
  const count = (f: (x: Shape) => boolean) => inner.filter(f).length
  const flatOvalOnTop = shapes.some((x) => x.kind === "ellipse" && x.box.w > 1.8 * x.box.h && x.box.y - box.y < 0.25 * box.h && box.h > 1.4 * x.box.h)
  if (flatOvalOnTop) return ["database", "service", "avatar"]
  if (!outer) return shapes.some((x) => x.kind === "ellipse") ? ["avatar", "database", "text"] : ["text", "input", "button"]
  if (outer.kind === "ellipse") return inner.length ? ["contact", "avatar", "card"] : ["avatar", "database", "button"]
  const o = outer.box
  const circles = count((x) => x.kind === "ellipse")
  const lines = count((x) => x.kind === "line" || x.kind === "scribble")
  const diag = count((x) => x.kind === "line" && x.dir === "diag")
  const verticals = count((x) => x.kind === "line" && x.dir === "v")
  const innerBoxes = count((x) => x.kind === "rect")
  const topBar = inner.some(
    // A title bar hugs the very top and spans nearly the whole width (a form's first field doesn't).
    (x) => ((x.kind === "line" && x.dir === "h") || (x.kind === "rect" && x.box.w > 2.5 * x.box.h) ? x.box.y - o.y < 0.18 * o.h && x.box.w > 0.8 * o.w : false),
  )
  if (circles && lines) return ["contact", "card", "form"]
  if (diag >= 2 || count((x) => x.kind === "peak") >= 1) return ["image", "card", "service"]
  if (verticals >= 2) return ["queue", "table" as Drawable, "service"].filter((t) => t in DRAWABLE) as Drawable[]
  if (topBar && inner.length >= 1) return ["modal", "form", "card"]
  if (s.fieldCount >= 2) return ["form", "modal", "card"]
  if (innerBoxes && lines) return ["card", "form", "modal"]
  if (count((x) => x.kind === "scribble") >= 1 && o.w * o.h < 60000) return ["button", "input", "text"]
  if (!inner.length && o.w > 3.5 * o.h && o.h < 90) return ["input", "button", "service"]
  if (!inner.length && o.w * o.h < 14000) return ["button", "input", "service"]
  return ["service", "card", "modal"]
}

/** The geometry in words, for Jev: what shapes, where, and what's inside what. */
export function describeSketch(s: Sketch, container: string | null): string {
  const size = (b: Box) => (b.w * b.h > 60000 ? "large" : b.w * b.h > 15000 ? "medium" : "small")
  const shape = (x: Shape) => {
    if (x.kind === "rect") return x.box.w > 3 * x.box.h ? "a wide, short box" : x.box.h > 2 * x.box.w ? "a tall, narrow box" : "a box"
    if (x.kind === "ellipse") return x.box.w > 1.8 * x.box.h ? "a flat oval" : "a circle"
    if (x.kind === "line") return x.dir === "h" ? "a short horizontal line" : x.dir === "v" ? "a vertical line" : "a diagonal line"
    if (x.kind === "arrow") return "an arrow"
    if (x.kind === "peak") return "a mountain-peak zigzag"
    return "a scribble"
  }
  const where = (x: Shape, o: Box) => {
    const c = center(x.box)
    const v = c.y < o.y + o.h / 3 ? "top" : c.y > o.y + (2 * o.h) / 3 ? "bottom" : "middle"
    const h = c.x < o.x + o.w / 3 ? "left" : c.x > o.x + (2 * o.w) / 3 ? "right" : ""
    return `${v}${h ? ` ${h}` : ""}`
  }
  const parts: string[] = []
  if (s.outer) {
    parts.push(`a sketch of a ${size(s.outer.box)} ${shape(s.outer).replace(/^an? /, "")}`)
    if (s.inner.length) {
      const groups = new Map<string, string[]>()
      for (const x of s.inner) {
        const o = s.outer.box
        // A line hugging the top across nearly the whole width reads as a title bar.
        const bar =
          ((x.kind === "line" && x.dir === "h") || (x.kind === "rect" && x.box.w > 2.5 * x.box.h)) && x.box.y - o.y < 0.18 * o.h && x.box.w > 0.8 * o.w
        const k = bar ? "a bar across the whole top (like a title bar)" : shape(x)
        groups.set(k, [...(groups.get(k) ?? []), where(x, s.outer.box)])
      }
      const inside = [...groups].map(([k, at]) => (at.length > 1 ? `${at.length} ${k.replace(/^an? /, "")}s stacked (${[...new Set(at)].join(", ")})` : `${k} at the ${at[0]}`))
      parts.push(`containing ${inside.join(", ")}`)
    } else parts.push("with nothing inside")
    const outside = s.shapes.filter((x) => x !== s.outer && !s.inner.includes(x))
    if (outside.length) parts.push(`plus ${outside.map(shape).join(", ")} beside it`)
  } else parts.push(`a sketch of ${s.shapes.map(shape).join(", ")} with no box around them`)
  if (container) parts.push(`drawn inside: ${container}`)
  return parts.join("; ")
}
