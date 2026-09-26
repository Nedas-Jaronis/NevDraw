import type { EntryGraph } from "@rtw/shared"

/** Horizontal room between columns (for the arrow and its label). */
export const COLUMN_GAP = 140
/** Vertical distance between rows in a column. */
export const ROW_GAP = 110

/**
 * Flowchart layout for the top-level elements an entry connects: each
 * element's column is its depth in the flow (sources left, sinks right),
 * each column is centered vertically on 0, and rows are ordered by their
 * predecessors' rows (a barycenter pass) so arrows cross as little as
 * possible. Returns positions relative to column 0's center, or an empty map
 * when fewer than two elements are connected.
 */
export function layeredPositions(
  graph: Pick<EntryGraph, "nodes" | "edges">,
  widthOf: (key: string) => number,
): Map<string, { x: number; y: number }> {
  const tops = new Set(graph.nodes.filter((n) => n.parent === null).map((n) => n.key))
  const edges = graph.edges.filter((e) => tops.has(e.from) && tops.has(e.to) && e.from !== e.to)
  const involved = [...tops].filter((k) => edges.some((e) => e.from === k || e.to === k))
  if (involved.length < 2) return new Map()

  // Longest-path depth, relaxed at most |V| times so cycles can't loop forever.
  const depth = new Map(involved.map((k) => [k, 0]))
  for (let i = 0; i < involved.length; i++) {
    let changed = false
    for (const e of edges) {
      const d = depth.get(e.from)! + 1
      if (d > depth.get(e.to)! && d < involved.length) {
        depth.set(e.to, d)
        changed = true
      }
    }
    if (!changed) break
  }

  // Columns in first-mention order, then ordered by predecessors' average row.
  const columns: string[][] = []
  for (const k of involved) (columns[depth.get(k)!] ??= []).push(k)
  const row = new Map<string, number>()
  columns.forEach((col, c) => {
    if (c > 0) {
      const bary = (k: string) => {
        const preds = edges.filter((e) => e.to === k && row.has(e.from)).map((e) => row.get(e.from)!)
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.POSITIVE_INFINITY
      }
      col.sort((a, b) => bary(a) - bary(b))
    }
    col.forEach((k, i) => row.set(k, i - (col.length - 1) / 2))
  })

  const out = new Map<string, { x: number; y: number }>()
  let x = 0
  for (const col of columns) {
    if (!col) continue
    const w = Math.max(...col.map(widthOf))
    for (const k of col) out.set(k, { x: Math.round(x + (w - widthOf(k)) / 2), y: Math.round(row.get(k)! * ROW_GAP) })
    x += w + COLUMN_GAP
  }
  return out
}
