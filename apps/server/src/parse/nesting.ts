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
 * doesn't cover, or isn't sure of, keeps today's parent. A label that carried the words
 * describing it ("Sidebar on the left") is cleaned to the name. Returns the same graph when
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
  const relabel = new Map<string, string>()
  const said = (i: number) => text.slice(spans[i]!.start, spans[i]!.end)
  // Exact names first; then a label that is the name plus words the model says describe it
  // ("Sidebar on the left" for [sidebar] with [on the left] modifying it).
  for (const loose of [false, true])
    spans.forEach((s, i) => {
      if (s.tag !== "INSTANCE" || nodeOf.has(i)) return
      const name = norm(said(i))
      const hit = candidates.find((n) => !used.has(n.key) && (norm(n.label) === name || (loose && describedBy(n.label, i))))
      if (!hit) return
      used.add(hit.key)
      nodeOf.set(i, hit.key)
      if (norm(hit.label) !== name) {
        const clean = cleanLabel(said(i), hit.label)
        if (clean) relabel.set(hit.key, clean)
      }
    })

  /** Whether `label` reads as span i plus the text of spans that modify it. */
  function describedBy(label: string, i: number): boolean {
    const mods = spans.flatMap((m, j) => (m.tag === "ATTR" && m.arcs?.some((a) => a.label === "mod" && a.head === i) ? [said(j)] : []))
    const words = (x: string) => x.toLowerCase().replace(/\b(a|an|the)\b/g, " ").split(/\s+/).filter(Boolean)
    const want = new Set(words([said(i), ...mods].join(" ")))
    const have = words(label)
    return have.length > words(said(i)).length && have.every((w) => want.has(w)) && words(said(i)).every((w) => have.includes(w))
  }

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
  if (!changed && relabel.size === 0) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = parent.get(n.key)!
      const label = relabel.get(n.key)
      return p === n.parent && !label ? n : { ...n, parent: p, ...(label ? { label } : {}) }
    }),
  }
}

/**
 * The name without the position words the old reading left in it: "Sidebar on the left" → "Sidebar",
 * "Sidebar on the right" → "Right sidebar" (layout reads the side from the label; left is the default).
 * Null when the extra words aren't only a position (a color or look stays in the label).
 */
export function cleanLabel(name: string, label: string): string | null {
  const extra = label
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !name.toLowerCase().split(/\s+/).includes(w))
  if (!extra.length || !extra.every((w) => /^(on|at|to|in|the|left|right|top|bottom|side|hand)$/.test(w))) return null
  const out = extra.includes("right") ? `Right ${name.toLowerCase()}` : name
  return out.charAt(0).toUpperCase() + out.slice(1)
}
