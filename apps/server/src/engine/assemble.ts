import type { EntryEdge, EntryGraph, EntryNode } from "@rtw/shared"
import { labelFrom } from "../classify/keywords.ts"
import type { PieceAnswers } from "./answers.ts"
import type { Piece } from "./split.ts"

const YES = 0.65

type MutableNode = { -readonly [K in keyof EntryNode]: EntryNode[K] }
const MAX_REPEAT = 8

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, few: 3 }
const COUNT = /^(?:a\s+)?(two|three|four|five|six|seven|eight|couple(?:\s+of)?|few|\d+)\s+/i
const LAYOUT_WORDS = /\b(in a row|side by side|horizontal(ly)?|inline|in a grid|grid of|stacked|vertical(ly)?|in a column)\b/gi

/** "three pricing cards" → 3; values are code-computed, never model-decided. */
export function countOf(text: string): number {
  const m = COUNT.exec(text.trim())
  if (!m) return 1
  const w = m[1]!.toLowerCase().replace(/\s+of$/, "")
  const n = NUMBER_WORDS[w] ?? Number.parseInt(w, 10)
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_REPEAT, n)) : 1
}

function pluralLabel(label: string) {
  return /s$/i.test(label) ? label : `${label}s`
}

/** A label without counts or layout phrases, singular when repeated. */
function cleanLabel(text: string, repeated: boolean): string {
  let t = text.replace(COUNT, "").replace(LAYOUT_WORDS, " ").replace(/\s+/g, " ").trim()
  if (repeated) t = t.replace(/(\w{3,}[^s])s$/i, "$1")
  return labelFrom(t || text)
}

/**
 * Pure: pieces + one answer per piece → the entry's full graph.
 *
 * Nesting rules:
 * - a sentence's first piece is top-level;
 * - "with …" (or a confident `childOfContainer`) nests under the previous
 *   piece when it's a container, else under that piece's parent;
 * - "," / "and" makes a sibling of the previous piece.
 * Layout phrases apply to a single container itself, otherwise to the parent.
 * Repeats ("three cards") become a group section holding the copies.
 * Relation verbs make arrows; arrow targets are top-level elements, and a
 * name used twice in one entry is the same element.
 */
export function assemble(pieces: readonly Piece[], answers: readonly PieceAnswers[]): EntryGraph {
  const nodes: MutableNode[] = []
  const edges: EntryEdge[] = []
  const byKey = new Map<string, MutableNode>()
  /** Which node key each piece became (a repeated name reuses the earlier node). */
  const keyOfPiece = new Map<number, string>()
  /** Top-level/edge nodes by label, so "api … api" is one element. */
  const byLabel = new Map<string, string>()
  let prev: { key: string; parent: string | null; container: boolean } | null = null

  const addEdge = (from: string | undefined, to: string, kind: EntryEdge["kind"]) => {
    if (!from || from === to || edges.some((e) => e.from === from && e.to === to && e.kind === kind)) return
    edges.push({ from, to, kind })
  }

  pieces.forEach((piece, i) => {
    const a = answers[i]
    if (!a) return
    const container = a.isContainer >= YES
    const edge = piece.connector === "edge" ? piece.edge : undefined

    // A name already used in this entry refers to the same element.
    const sameName = byLabel.get(cleanLabel(piece.text, false).toLowerCase())
    if (sameName && countOf(piece.text) === 1) {
      keyOfPiece.set(piece.index, sameName)
      if (edge) addEdge(keyOfPiece.get(edge.from), sameName, edge.kind)
      const n = byKey.get(sameName)!
      prev = { key: sameName, parent: n.parent, container: a.isContainer >= YES }
      return
    }

    let parent: string | null = null
    // Arrow targets are separate elements, never nested.
    if (!edge && piece.connector !== "start" && prev) {
      const nest = piece.connector === "with" || a.childOfContainer >= YES
      parent = nest && prev.container ? prev.key : prev.parent
    }

    const count = countOf(piece.text)
    const key = `p${piece.index}`
    const layout = a.layout.value !== "none" && a.layout.confidence >= YES ? a.layout.value : null

    if (count > 1) {
      // "three cards in a row" → a group section (row by default) holding the repeats,
      // so the surrounding page keeps its own layout.
      const label = cleanLabel(piece.text, true)
      const group: MutableNode = {
        key,
        type: "section",
        label: pluralLabel(label),
        parent,
        props: { layout: layout ?? "row" },
      }
      nodes.push(group)
      byKey.set(key, group)
      for (let r = 0; r < count; r++) {
        nodes.push({ key: `${key}.${r}`, type: a.nodeType.value, label, parent: key, props: {} })
      }
      keyOfPiece.set(piece.index, key)
      if (edge) addEdge(keyOfPiece.get(edge.from), key, edge.kind)
      prev = { key, parent, container: true }
      return
    }

    const node: MutableNode = { key, type: a.nodeType.value, label: cleanLabel(piece.text, false), parent, props: {} }
    nodes.push(node)
    byKey.set(key, node)
    keyOfPiece.set(piece.index, key)
    if (parent === null) byLabel.set(node.label.toLowerCase(), key)
    if (edge) addEdge(keyOfPiece.get(edge.from), key, edge.kind)

    if (layout) {
      // "section in a grid" lays out the section itself; a leaf's phrase lays out its parent.
      const target = container ? node : parent ? byKey.get(parent) : undefined
      if (target) target.props = { ...target.props, layout }
    }

    prev = { key, parent, container }
  })

  return { nodes, edges, suggestions: [] }
}
