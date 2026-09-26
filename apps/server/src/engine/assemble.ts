import { type EntryEdge, type EntryGraph, type EntryNode, type NodeType, REGISTRY } from "@rtw/shared"
import { labelFrom } from "../classify/keywords.ts"
import type { PieceAnswers } from "./answers.ts"
import type { Piece } from "./split.ts"

const YES = 0.65

type MutableNode = { -readonly [K in keyof EntryNode]: EntryNode[K] }
const MAX_REPEAT = 8

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, few: 3 }
const COUNT = /^(?:a\s+)?(two|three|four|five|six|seven|eight|couple(?:\s+of)?|few|\d+)\s+/i
/** A number followed by one of these is a value ("25 min timer"), never a count. */
const UNIT =
  /^(?:m|min|mins|minute|minutes|s|sec|secs|second|seconds|ms|h|hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years|%|percent|px|pt|em|rem|k|m|b|kb|mb|gb|tb|x|star|stars|col|cols|column|step|steps|dollar|dollars|usd|\$)\b/i
const LAYOUT_WORDS = /\b(in a row|side by side|horizontal(ly)?|inline|in a grid|grid of|stacked|vertical(ly)?|in a column)\b/gi

/** Is the phrase about several things? ("pricing cards" yes, "status" no.) */
const pluralPhrase = (text: string) => {
  const last = text.replace(LAYOUT_WORDS, " ").trim().split(/\s+/).at(-1) ?? ""
  return /[a-z]{2,}s$/i.test(last) && !/(ss|us|is)$/i.test(last)
}

/**
 * "three pricing cards" → 3. Values are code-computed, never model-decided.
 * Only a number in front of a plural thing is a count: "25 min timer" (a unit)
 * and "2 column layout" (singular) are values.
 */
export function countOf(text: string): number {
  const t = text.trim()
  const m = COUNT.exec(t)
  if (!m) return 1
  const rest = t.slice(m[0].length)
  if (UNIT.test(rest) || !pluralPhrase(rest)) return 1
  const w = m[1]!.toLowerCase().replace(/\s+of$/, "")
  const n = NUMBER_WORDS[w] ?? Number.parseInt(w, 10)
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_REPEAT, n)) : 1
}

function pluralLabel(label: string) {
  return /s$/i.test(label) ? label : `${label}s`
}

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase())

/**
 * The label once an alias names the element: the same name stays ("server"
 * → "Server"), a short qualifier joins the element's noun ("sql" → "SQL
 * Database"), anything else is the element's name ("postgres" → "Postgres").
 */
export function aliasLabel(base: string, alias: string | undefined): string {
  const a = alias?.trim()
  if (!a) return base
  if (a.toLowerCase() === base.toLowerCase()) return base
  const noun = base.split(/\s+/).at(-1) ?? base
  if (a.toLowerCase().split(/\s+/).includes(noun.toLowerCase())) return titleCase(a)
  if (a.length <= 4) return `${a.toUpperCase()} ${titleCase(noun)}`
  return titleCase(a)
}

/**
 * What a classifier should look at: for a repeated group ("three pricing
 * cards in a row") that's one item ("pricing card"), since the group itself
 * is always a section.
 */
export function classificationText(text: string): string {
  if (countOf(text) <= 1) return text
  return cleanLabel(text, true).toLowerCase()
}

/** A label without counts or layout phrases, singular when repeated. */
function cleanLabel(text: string, repeated: boolean): string {
  // An unknown "@thing" is just text: the server never invents references.
  // An @token in a label is just its words: the server never invents references.
  const plain = text.replace(/@([a-z0-9][a-z0-9-]*)/gi, (_, h: string) => h.replace(/-/g, " "))
  // Keep numbers that are values ("25 min timer"); drop the count of repeats.
  let t = (repeated ? plain.replace(COUNT, "") : plain).replace(LAYOUT_WORDS, " ").replace(/\s+/g, " ").trim()
  if (repeated) t = t.replace(/(\w{3,}[^s])s$/i, "$1")
  return labelFrom(t || plain)
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
/** What the assembler may know about committed @handles. */
export type HandleInfo = ReadonlyMap<string, { container: boolean; type?: NodeType }>

/** Flow direction for "connect them": UI → client → service → queue/external → data stores. */
const TIER: Partial<Record<NodeType, number>> = {
  client: 1,
  service: 2,
  queue: 3,
  "external-api": 3,
  database: 4,
  cache: 4,
  storage: 4,
}
const tierOf = (t: NodeType | undefined) => (t ? (TIER[t] ?? (REGISTRY[t].lane === "ui" ? 0 : 2)) : 2)

const HANDLE_IN = /@[a-z0-9][a-z0-9-]*/gi
/** Words that can surround a reference without making it something new: "both the @server". */
const REF_FILLER = new Set(
  "the a an both also and or our my this that these those it existing same current link linked connect connected to with together up them all".split(" "),
)

/**
 * The known @handle a piece refers to, if the piece is just that reference
 * plus filler ("the @25-minute-timer", "both the @server"). Anything more
 * ("a timer like @x") is a new element.
 */
export function referenceOf(text: string, handles: HandleInfo): string | null {
  const found = [...text.matchAll(HANDLE_IN)].map((m) => m[0].toLowerCase()).filter((h) => handles.has(h))
  if (new Set(found).size !== 1) return null
  const rest = text
    .replace(HANDLE_IN, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !REF_FILLER.has(w))
  return rest.length === 0 ? found[0]! : null
}

export function assemble(
  pieces: readonly Piece[],
  answers: readonly PieceAnswers[],
  handles: HandleInfo = new Map(),
  /** The @handles this person added most recently: what "them" means. */
  recent: readonly string[] = [],
): EntryGraph {
  const nodes: MutableNode[] = []
  const edges: EntryEdge[] = []
  const byKey = new Map<string, MutableNode>()
  /** Which node key each piece became (a repeated name reuses the earlier node). */
  const keyOfPiece = new Map<number, string>()
  /** Top-level/edge nodes by label, so "api … api" is one element. */
  const byLabel = new Map<string, string>()
  let prev: { key: string; parent: string | null; container: boolean } | null = null

  const addEdge = (from: string | undefined, to: string, kind: EntryEdge["kind"], label?: string) => {
    if (!from || from === to || edges.some((e) => e.from === from && e.to === to && e.kind === kind)) return
    edges.push({ from, to, kind, ...(label ? { label } : {}) })
  }

  pieces.forEach((piece, i) => {
    if (piece.connector === "connect") {
      // "connect them together": chain the recent elements in flow order.
      const known = recent.filter((h) => handles.has(h))
      const ordered = known
        .map((h, at) => ({ h, at, tier: tierOf(handles.get(h)!.type) }))
        .sort((x, y) => x.tier - y.tier || x.at - y.at)
      for (let k = 1; k < ordered.length; k++) {
        const from = ordered[k - 1]!.h
        const to = ordered[k]!.h
        if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, kind: "calls", label: "connects" })
      }
      prev = null
      return
    }
    const a = answers[i]
    if (!a) return
    const container = a.isContainer >= YES
    const edge = piece.connector === "edge" ? piece.edge : undefined

    // "@postgres", "the @postgres": a reference to a committed element, not a new one.
    const ref = referenceOf(piece.text, handles)
    if (ref) {
      keyOfPiece.set(piece.index, ref)
      if (edge) addEdge(keyOfPiece.get(edge.from), ref, edge.kind, edge.label)
      prev = { key: ref, parent: null, container: handles.get(ref)!.container }
      return
    }

    // A name already used in this entry refers to the same element.
    const sameName = byLabel.get(cleanLabel(piece.text, false).toLowerCase())
    if (sameName && countOf(piece.text) === 1) {
      keyOfPiece.set(piece.index, sameName)
      if (edge) addEdge(keyOfPiece.get(edge.from), sameName, edge.kind, edge.label)
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
    // "add a form to @landing-page" (only into a known container).
    if (piece.into && handles.get(piece.into)?.container) parent = piece.into
    // Services, databases, queues… are system pieces, never parts of a page.
    if (REGISTRY[a.nodeType.value].lane === "architecture") parent = null

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
      if (edge) addEdge(keyOfPiece.get(edge.from), key, edge.kind, edge.label)
      prev = { key, parent, container: true }
      return
    }

    const node: MutableNode = { key, type: a.nodeType.value, label: aliasLabel(cleanLabel(piece.text, false), piece.alias), parent, props: {} }
    nodes.push(node)
    byKey.set(key, node)
    keyOfPiece.set(piece.index, key)
    if (parent === null) byLabel.set(node.label.toLowerCase(), key)
    if (edge) addEdge(keyOfPiece.get(edge.from), key, edge.kind, edge.label)

    if (layout) {
      // "section in a grid" lays out the section itself; a leaf's phrase lays out its parent.
      const target = container ? node : parent ? byKey.get(parent) : undefined
      if (target) target.props = { ...target.props, layout }
    }

    prev = { key, parent, container }
  })

  return { nodes, edges, suggestions: [] }
}
