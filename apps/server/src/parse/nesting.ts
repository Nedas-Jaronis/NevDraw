import { type EntryGraph, SIDEBAR_RE } from "@rtw/shared"
import type { TaggedSpan } from "@rtw/parser"
import { classifyKeywords } from "../classify/keywords.ts"
import { norm } from "./Parser.ts"

/** A draft node placement can edit (its own copies). */
type Node = { -readonly [K in keyof EntryGraph["nodes"][number]]: EntryGraph["nodes"][number][K] }

/**
 * The model's reading applied to a draft. Today's reading builds the draft (types, labels,
 * groups, colors); the model then decides structure where it's confident:
 *
 *   nesting    what sits inside what ("a hero with a headline and two buttons, and a footer")
 *   placement  where things sit relative to each other ("on the right side of the sidebar we
 *              include a hero", "a footer below the pricing section", "an image on the left")
 *
 * Anything the model doesn't cover, or isn't sure of (< minConfidence), keeps today's reading.
 * Returns the same graph object when nothing changes.
 */
export function readWithModel(graph: EntryGraph, text: string, spans: readonly TaggedSpan[], minConfidence = 0.8): EntryGraph {
  return placeFromModel(nestFromModel(graph, text, spans, minConfidence), text, spans, minConfidence)
}

/**
 * Which draft node each INSTANCE span is. Exact names first ("two buttons" → the "Buttons"
 * group, not one of its "Button"s; repeated names pair up left to right); then a label that
 * is the name plus words the model says describe it ("Sidebar on the left"); then a label
 * that ends with the name ("On the right side of the sidebar we include a hero"). Labels
 * matched loosely are cleaned up to the name.
 */
function matchNodes(graph: EntryGraph, text: string, spans: readonly TaggedSpan[]) {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]))
  const depth = (key: string) => {
    let d = 0
    for (let n = byKey.get(key); n?.parent && byKey.has(n.parent) && d < 64; n = byKey.get(n.parent)) d++
    return d
  }
  const candidates = [...graph.nodes].sort((a, b) => depth(a.key) - depth(b.key))
  const said = (i: number) => text.slice(spans[i]!.start, spans[i]!.end)
  const words = (x: string) => x.toLowerCase().replace(/\b(a|an|the)\b/g, " ").split(/\s+/).filter(Boolean)
  const describedBy = (label: string, i: number) => {
    const mods = spans.flatMap((m, j) => (m.tag === "ATTR" && m.arcs?.some((a) => a.label === "mod" && a.head === i) ? [said(j)] : []))
    const want = new Set(words([said(i), ...mods].join(" ")))
    const have = words(label)
    return have.length > words(said(i)).length && have.every((w) => want.has(w)) && words(said(i)).every((w) => have.includes(w))
  }
  /**
   * How well a longer label holds the name: 3 when it starts with it ("Sidebar on the left"),
   * 2 when it ends with it, or ends cut off inside it ("… we include a h…" for "hero"), 1 when
   * the name is in the middle ("Chat panel to the left of the form" for "form"); 0 otherwise.
   */
  const fit = (label: string, i: number) => {
    const cut = label.endsWith("…")
    const have = words(label.replace(/…$/, ""))
    const name = words(said(i))
    if (have.length <= name.length || name.length === 0) return 0
    const at = (k: number) => name.every((w, j) => have[k + j] === w)
    if (at(0)) return 3
    if (at(have.length - name.length)) return 2
    // Truncated: the label's last words are the start of the name.
    if (cut)
      for (let k = Math.min(name.length, have.length); k >= 1; k--) {
        const tail = have.slice(have.length - k)
        if (tail.every((w, j) => (j < k - 1 ? name[j] === w : name[j]!.startsWith(w)))) return 2
      }
    for (let k = 1; k + name.length < have.length; k++) if (at(k)) return 1
    return 0
  }
  /** The best loose match: the highest fit, then the shortest label. */
  const bestFit = (i: number) => {
    let best: Node | undefined
    let score = 0
    for (const n of candidates) {
      if (used.has(n.key)) continue
      const f = fit(n.label, i)
      if (f > score || (f === score && f > 0 && best && n.label.length < best.label.length)) {
        best = n
        score = f
      }
    }
    return best
  }

  const used = new Set<string>()
  const nodeOf = new Map<number, string>()
  const relabel = new Map<string, string>()
  const retype = new Map<string, Node["type"]>()
  for (const pass of ["exact", "described", "contains"] as const)
    spans.forEach((s, i) => {
      if (s.tag !== "INSTANCE" || nodeOf.has(i)) return
      const name = norm(said(i))
      const hit =
        pass === "contains" ? bestFit(i) : candidates.find((n) => !used.has(n.key) && (norm(n.label) === name || (pass === "described" && describedBy(n.label, i))))
      if (!hit) return
      used.add(hit.key)
      nodeOf.set(i, hit.key)
      if (norm(hit.label) === name) return
      const clean = pass === "contains" ? capitalize(said(i)) : cleanLabel(said(i), hit.label)
      if (clean) relabel.set(hit.key, clean)
      // The old reading typed the whole phrase ("chat panel to the left of the form" → a form);
      // the name alone says what it is, when a keyword knows it.
      if (pass === "contains") {
        const guess = classifyKeywords(said(i))
        if (guess.type !== "box" && guess.type !== hit.type) retype.set(hit.key, guess.type)
      }
    })

  /** The node a span stands for: itself, or what a back-reference ("the sidebar") refers to. */
  const nodeFor = (i: number, hops = 0): string | undefined => {
    if (nodeOf.has(i)) return nodeOf.get(i)
    const same = spans[i]?.arcs?.find((a) => a.label === "same")
    return same && hops < 8 ? nodeFor(same.head, hops + 1) : undefined
  }
  return { nodeOf, nodeFor, relabel, retype, said }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What sits inside what, from the model's confident "in" links. */
export function nestFromModel(graph: EntryGraph, text: string, spans: readonly TaggedSpan[], minConfidence = 0.8): EntryGraph {
  const { nodeOf, relabel, retype } = matchNodes(graph, text, spans)
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
  if (!changed && relabel.size === 0 && retype.size === 0) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = parent.get(n.key)!
      const label = relabel.get(n.key)
      const type = retype.get(n.key)
      return p === n.parent && !label && !type ? n : { ...n, parent: p, ...(label ? { label } : {}), ...(type ? { type } : {}) }
    }),
  }
}

/**
 * The name without the position words the old reading left in it: "Sidebar on the left" → "Sidebar",
 * "Sidebar on the right" → "Right sidebar" (a sidebar's side is read from its label; left is the default).
 * Null when the extra words aren't only a position (a color or look stays in the label).
 */
export function cleanLabel(name: string, label: string): string | null {
  const extra = label
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !name.toLowerCase().split(/\s+/).includes(w))
  if (!extra.length || !extra.every((w) => /^(on|at|to|in|the|thr|teh|left|right|top|bottom|side|hand)$/.test(w))) return null
  return capitalize(extra.includes("right") && SIDEBAR_RE.test(name) ? `Right ${name.toLowerCase()}` : name)
}

export type Relation = "left" | "right" | "above" | "below" | "before" | "after" | "between" | "top" | "bottom"

/**
 * A position phrase, normalized. Relative to an anchor ("to the right of the sidebar", "next to
 * @editor", "below the pricing section") or, without one, an edge of what it sits in ("on the
 * left", "at the top", "last"). Null when it isn't a position.
 */
export function relationOf(phrase: string, anchored: boolean): Relation | null {
  const p = phrase.toLowerCase()
  if (/\bbetween\b/.test(p)) return anchored ? "between" : null
  if (/\bleft\b/.test(p)) return "left"
  if (/\bright\b/.test(p)) return "right"
  if (anchored) {
    if (/next to|beside|alongside|\bby\b/.test(p)) return "right"
    if (/above|\bover\b|on top of/.test(p)) return "above"
    if (/below|under|beneath/.test(p)) return "below"
    if (/before/.test(p)) return "before"
    if (/after/.test(p)) return "after"
    return null
  }
  if (/\btop\b|\bfirst\b|\bstart\b|beginning/.test(p)) return "top"
  if (/bottom|\blast\b|\bend\b/.test(p)) return "bottom"
  return null
}

/**
 * Where things sit, from the model's position phrases, with a few general rules:
 *
 *   relative to something ("right of X", "next to X", "below X", "between X and Y")
 *     the thing becomes X's sibling. Left / right put them side by side: a sidebar already
 *     lays out as a column; anything else gets a row around the two. Above / below / before /
 *     after / between set the order.
 *   an edge of what it sits in ("an image on the left", "a footer at the bottom")
 *     top / bottom set the order; left / right make the holder a row with it on that side.
 *
 * Anchors on the board (@handles) use the draft's after / before, which the board resolves.
 */
export function placeFromModel(graph: EntryGraph, text: string, spans: readonly TaggedSpan[], minConfidence = 0.8): EntryGraph {
  const { nodeFor, said } = matchNodes(graph, text, spans)
  const nodes: Node[] = graph.nodes.map((n) => ({ ...n, props: { ...n.props } }))
  const get = (key: string) => nodes.find((n) => n.key === key)
  let changed = false

  const move = (key: string, to: "before" | "after", anchorKey: string) => {
    const from = nodes.findIndex((n) => n.key === key)
    const [n] = nodes.splice(from, 1)
    const at = nodes.findIndex((m) => m.key === anchorKey)
    nodes.splice(to === "before" ? at : at + 1, 0, n!)
  }
  const siblingsOf = (key: string) => nodes.filter((n) => n.parent === get(key)?.parent && n.key !== key)
  const isSidebar = (n: Node | undefined) => !!n && SIDEBAR_RE.test(n.label)
  const toRight = (n: Node) => {
    if (!/\bright\b/i.test(n.label)) n.label = `Right ${n.label.charAt(0).toLowerCase()}${n.label.slice(1)}`
  }
  const inside = (key: string, maybeAncestor: string) => {
    for (let k: string | null | undefined = key, hops = 0; k && hops < 64; k = get(k)?.parent, hops++) if (k === maybeAncestor) return true
    return false
  }

  spans.forEach((p, pi) => {
    if (p.tag !== "ATTR" || p.confidence < minConfidence) return
    const mod = p.arcs?.find((a) => a.label === "mod" && a.confidence >= minConfidence)
    const thingKey = mod ? nodeFor(mod.head) : undefined
    const thing = thingKey ? get(thingKey) : undefined
    if (!thing) return
    const anchors = spans.flatMap((s, j) =>
      s.arcs?.some((a) => a.label === "dst" && a.head === pi && a.confidence >= minConfidence)
        ? [nodeFor(j) ?? (said(j).startsWith("@") ? said(j).toLowerCase() : undefined)]
        : [],
    )
    const rel = relationOf(said(pi), anchors.length > 0)
    if (!rel) return

    if (anchors.length === 0) {
      // An edge of what it sits in.
      if (rel === "top" || rel === "bottom") {
        const sibs = siblingsOf(thing.key)
        if (!sibs.length) return
        move(thing.key, rel === "top" ? "before" : "after", (rel === "top" ? sibs[0] : sibs.at(-1))!.key)
        changed = true
        return
      }
      if (rel === "left" || rel === "right") {
        if (isSidebar(thing)) {
          if (rel === "right" && !/\bright\b/i.test(thing.label)) {
            toRight(thing)
            changed = true
          }
          return
        }
        const holder = thing.parent ? get(thing.parent) : undefined
        if (!holder || holder.type === "page") return
        holder.props = { ...holder.props, layout: "row" }
        const sibs = siblingsOf(thing.key)
        if (sibs.length) move(thing.key, rel === "left" ? "before" : "after", (rel === "left" ? sibs[0] : sibs.at(-1))!.key)
        changed = true
      }
      return
    }

    const [first, second] = anchors
    if (!first || first === thing.key) return
    const anchor = get(first)
    if (!anchor) {
      // On the board: the board places it next to its anchor.
      if (!first.startsWith("@") || thing.after || thing.before) return
      if (rel === "right" || rel === "below" || rel === "after") thing.after = first
      else if (rel === "between" && second?.startsWith("@")) Object.assign(thing, { after: first, before: second })
      else thing.before = first
      changed = true
      return
    }
    // A sibling of the anchor, never inside it (or the anchor inside it).
    if (inside(anchor.key, thing.key)) return
    thing.parent = anchor.parent
    delete thing.after
    delete thing.before
    changed = true
    if (rel === "between" && second && get(second)) {
      move(thing.key, "after", first)
      return
    }
    if (rel === "left" || rel === "right") {
      if (isSidebar(anchor) || isSidebar(thing)) {
        // A sidebar is already a column beside the rest; its side is in its label.
        if ((isSidebar(thing) && rel === "right") || (isSidebar(anchor) && rel === "left")) toRight(isSidebar(thing) ? thing : anchor)
        move(thing.key, rel === "left" ? "before" : "after", anchor.key)
        return
      }
      // Side by side: a row around the two, where the anchor was.
      const rowKey = `row:${anchor.key}`
      if (!get(rowKey)) {
        const row: Node = { key: rowKey, type: "section", label: `${anchor.label} and ${thing.label.charAt(0).toLowerCase()}${thing.label.slice(1)}`, parent: anchor.parent, props: { layout: "row" } }
        if (anchor.after) row.after = anchor.after
        if (anchor.before) row.before = anchor.before
        nodes.splice(
          nodes.findIndex((n) => n.key === anchor.key),
          0,
          row,
        )
        anchor.parent = rowKey
        delete anchor.after
        delete anchor.before
      }
      thing.parent = rowKey
      move(thing.key, rel === "left" ? "before" : "after", anchor.key)
      return
    }
    move(thing.key, rel === "above" || rel === "before" ? "before" : "after", anchor.key)
  })
  return changed ? { ...graph, nodes } : graph
}
