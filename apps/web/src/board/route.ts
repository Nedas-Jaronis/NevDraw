export type Rect = { x: number; y: number; w: number; h: number }
type P = { x: number; y: number }

const HEAD = 7

/**
 * A soft curve from one element's edge to another's, leaving the side that
 * faces the target (left/right when they're side by side, top/bottom when
 * stacked). Returns SVG path data for the line and the arrowhead, plus the
 * curve's midpoint for the label.
 */
export function route(a: Rect, b: Rect): { d: string; head: string; mid: P } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  // Side by side (no horizontal overlap) → leave from the facing side, even when far apart
  // vertically, so flowchart columns read left to right. Stacked → top/bottom.
  const overlapX = a.x < b.x + b.w && b.x < a.x + a.w
  const horizontal = !overlapX || Math.abs(dx) * 0.8 >= Math.abs(dy)

  let s: P, e: P, c1: P, c2: P
  if (horizontal) {
    const dir = Math.sign(dx) || 1
    s = { x: dir > 0 ? a.x + a.w : a.x, y: ca.y }
    e = { x: dir > 0 ? b.x : b.x + b.w, y: cb.y }
    const k = Math.max(40, Math.abs(e.x - s.x) / 2)
    c1 = { x: s.x + dir * k, y: s.y }
    c2 = { x: e.x - dir * k, y: e.y }
  } else {
    const dir = Math.sign(dy) || 1
    s = { x: ca.x, y: dir > 0 ? a.y + a.h : a.y }
    e = { x: cb.x, y: dir > 0 ? b.y : b.y + b.h }
    const k = Math.max(40, Math.abs(e.y - s.y) / 2)
    c1 = { x: s.x, y: s.y + dir * k }
    c2 = { x: e.x, y: e.y - dir * k }
  }

  // Arrowhead aligned with the curve's final tangent (c2 → e).
  const tx = e.x - c2.x
  const ty = e.y - c2.y
  const len = Math.hypot(tx, ty) || 1
  const ux = tx / len
  const uy = ty / len
  const base = { x: e.x - ux * HEAD, y: e.y - uy * HEAD }
  const left = { x: base.x - uy * HEAD * 0.6, y: base.y + ux * HEAD * 0.6 }
  const right = { x: base.x + uy * HEAD * 0.6, y: base.y - ux * HEAD * 0.6 }

  // Cubic Bézier midpoint (t = 0.5).
  const mid = { x: (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8, y: (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8 }

  const f = (n: number) => Math.round(n * 10) / 10
  return {
    d: `M${f(s.x)},${f(s.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(base.x)},${f(base.y)}`,
    head: `M${f(e.x)},${f(e.y)} L${f(left.x)},${f(left.y)} L${f(right.x)},${f(right.y)} Z`,
    mid,
  }
}
