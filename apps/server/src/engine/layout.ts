import { type BoardNode, type NodeType, REGISTRY } from "@rtw/shared"

/**
 * Deterministic top-level layout. The server can't measure the DOM, so it
 * estimates each element's size from its type and children (close to what
 * the web renders), which keeps every client's layout identical.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Size = { w: number; h: number }

export const ROOT_CONTAINER_W = 320
export const ROOT_LEAF_W = 240
/** Breathing room kept between top-level elements. */
export const MARGIN = 32

const SKETCH_H: Partial<Record<NodeType, number>> = {
  navbar: 20,
  hero: 64,
  button: 32,
  input: 32,
  image: 64,
  table: 80,
  list: 52,
  text: 28,
  box: 28,
}

const TITLE = 22
const ROOT_PAD = 24
const CHILD_PAD = 20
const GAP = 8

/** Estimated rendered size of every node, keyed by id. */
export function estimateSizes(nodes: readonly BoardNode[]): Map<string, Size> {
  const children = new Map<string, BoardNode[]>()
  for (const n of nodes) {
    if (n.parent === null) continue
    const list = children.get(n.parent) ?? []
    list.push(n)
    children.set(n.parent, list)
  }
  const sizes = new Map<string, Size>()

  const height = (n: BoardNode, root: boolean): number => {
    const pad = root ? ROOT_PAD : CHILD_PAD
    if (!REGISTRY[n.type].container) return pad + TITLE + (SKETCH_H[n.type] ?? 0)
    const kids = (children.get(n.id) ?? []).sort((a, b) => a.order - b.order)
    if (kids.length === 0) return pad + TITLE + 10 + 64
    const hs = kids.map((k) => height(k, false))
    const layout = n.props.layout ?? REGISTRY[n.type].defaultLayout
    let inner: number
    if (layout === "row") inner = Math.max(...hs)
    else if (layout === "grid") {
      inner = 0
      for (let i = 0; i < hs.length; i += 2) inner += Math.max(hs[i]!, hs[i + 1] ?? 0) + GAP
      inner -= GAP
    } else inner = hs.reduce((s, h) => s + h, 0) + GAP * (hs.length - 1)
    return pad + TITLE + 10 + inner
  }

  for (const n of nodes) {
    if (n.parent !== null) continue
    const w = REGISTRY[n.type].container ? ROOT_CONTAINER_W : ROOT_LEAF_W
    sizes.set(n.id, { w, h: height(n, true) })
  }
  return sizes
}

export const overlaps = (a: Rect, b: Rect, margin = MARGIN) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin

/** The smallest move of `r` along one axis that clears `obstacle`. */
function escape(r: Rect, obstacle: Rect): { dx: number; dy: number } {
  const right = obstacle.x + obstacle.w + MARGIN - r.x
  const left = obstacle.x - MARGIN - (r.x + r.w)
  const down = obstacle.y + obstacle.h + MARGIN - r.y
  const up = obstacle.y - MARGIN - (r.y + r.h)
  // Prefer the direction the element already sits in relative to the obstacle.
  const cx = r.x + r.w / 2 - (obstacle.x + obstacle.w / 2)
  const cy = r.y + r.h / 2 - (obstacle.y + obstacle.h / 2)
  const h = cx >= 0 ? right : left
  const v = cy >= 0 ? down : up
  return Math.abs(h) <= Math.abs(v) ? { dx: h, dy: 0 } : { dx: 0, dy: v }
}

/**
 * Push unpinned committed top-level elements out of the way of drafts
 * (and of each other, as pushes cascade). Drafts and pinned elements never
 * move. Returns only the displaced positions: they're derived, so discarding
 * a draft makes everything settle back to its saved spot.
 */
export function pushAside(input: {
  committed: readonly BoardNode[]
  drafts: readonly BoardNode[]
  sizes: ReadonlyMap<string, Size>
}): Map<string, { x: number; y: number }> {
  const rect = (n: BoardNode): Rect => ({ x: n.x, y: n.y, ...(input.sizes.get(n.id) ?? { w: ROOT_LEAF_W, h: 60 }) })
  const byId = new Map(input.committed.map((n) => [n.id, n]))
  // A committed container that a draft is adding children to is growing too: it holds still.
  const hosts = new Set<string>()
  for (const d of input.drafts) {
    let p = d.parent ? byId.get(d.parent) : undefined
    while (p && p.parent !== null) p = byId.get(p.parent)
    if (p) hosts.add(p.id)
  }
  const fixed: Rect[] = [...input.drafts.filter((n) => n.parent === null).map(rect), ...[...hosts].map((id) => rect(byId.get(id)!))]
  if (fixed.length === 0) return new Map()
  for (const n of input.committed) if (n.parent === null && n.pinned && !hosts.has(n.id)) fixed.push(rect(n))

  const movable = input.committed
    .filter((n) => n.parent === null && !n.pinned && !hosts.has(n.id))
    .map((n) => ({ id: n.id, r: rect(n), base: rect(n) }))
  // Only elements actually hit by a draft (directly or by a cascade) move.
  for (let pass = 0; pass < 24; pass++) {
    let moved = false
    for (const m of movable) {
      const blockers = [...fixed, ...movable.filter((o) => o !== m && o.r !== o.base).map((o) => o.r)]
      const hit = blockers.find((b) => overlaps(m.r, b))
      if (!hit) continue
      const { dx, dy } = escape(m.r, hit)
      m.r = { ...m.r, x: m.r.x + dx, y: m.r.y + dy }
      moved = true
    }
    if (!moved) break
  }
  const out = new Map<string, { x: number; y: number }>()
  for (const m of movable) if (m.r.x !== m.base.x || m.r.y !== m.base.y) out.set(m.id, { x: Math.round(m.r.x), y: Math.round(m.r.y) })
  return out
}

/**
 * Slide a new draft element right (then down) until it clears every obstacle:
 * pinned elements and other people's drafts are never pushed, so new drafts
 * go around them.
 */
export function avoid(r: Rect, obstacles: readonly Rect[]): { x: number; y: number } {
  let cur = { ...r }
  for (let i = 0; i < 40; i++) {
    const hit = obstacles.find((o) => overlaps(cur, o))
    if (!hit) break
    cur = { ...cur, x: hit.x + hit.w + MARGIN }
  }
  return { x: Math.round(cur.x), y: Math.round(cur.y) }
}
