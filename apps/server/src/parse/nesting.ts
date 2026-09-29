import type { EntryGraph } from "@rtw/shared"
import type { TaggedSpan } from "@rtw/parser"
import { norm } from "./Parser.ts"

/**
 * The model decides what sits inside what. Today's reading builds the draft (types, labels,
 * groups, colors); where the model is confident that one new thing is inside another
 * ("a hero with a headline and two buttons, and a footer"), the draft's parents follow it.
 *
 * Spans are matched to draft nodes by name ("two buttons" → the "Buttons" group, not one of
 * its "Button"s), in order, so repeated names pair up left to right. Anything the model
 * doesn't cover, or isn't sure of, keeps today's parent. Returns the same graph when
 * nothing changes.
 */
export function nestFromModel(graph: EntryGraph, text: string, spans: readonly TaggedSpan[], minConfidence = 0.8): EntryGraph {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]))
  const depth = (key: string) => {
    let d = 0
    for (let n = byKey.get(key); n?.parent && byKey.has(n.parent) && d < 64; n = byKey.get(n.parent)) d++
    return d
  }
  // Shallowest first, so a group ("Buttons") is matched before the copies inside it.
  const candidates = [...graph.nodes].sort((a, b) => depth(a.key) - depth(b.key))
  const used = new Set<string>()
  const nodeOf = new Map<number, string>()
  spans.forEach((s, i) => {
    if (s.tag !== "INSTANCE") return
    const name = norm(text.slice(s.start, s.end))
    const hit = candidates.find((n) => !used.has(n.key) && norm(n.label) === name)
    if (!hit) return
    used.add(hit.key)
    nodeOf.set(i, hit.key)
  })

  const parent = new Map(graph.nodes.map((n) => [n.key, n.parent]))
  const inside = (key: string, maybeAncestor: string) => {
    for (let k: string | null | undefined = key, hops = 0; k && hops < 64; k = parent.get(k), hops++) if (k === maybeAncestor) return true
    return false
  }
  let changed = false
  spans.forEach((s, i) => {
    const child = nodeOf.get(i)
    if (!child || s.confidence < minConfidence) return
    const arc = s.arcs?.find((a) => a.label === "in" && a.confidence >= minConfidence && spans[a.head]?.tag === "INSTANCE")
    const holder = arc ? nodeOf.get(arc.head) : undefined
    // Never a loop: the new parent can't already sit inside the child.
    if (!holder || parent.get(child) === holder || inside(holder, child)) return
    parent.set(child, holder)
    changed = true
  })
  if (!changed) return graph
  return { ...graph, nodes: graph.nodes.map((n) => (parent.get(n.key) === n.parent ? n : { ...n, parent: parent.get(n.key)! })) }
}
