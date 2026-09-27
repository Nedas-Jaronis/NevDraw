import { ACCENTS, type EntryEdge, type EntryGraph, type EntryNode, type EntryPatch, type NodeType, REGISTRY } from "@rtw/shared"
import { bulkEditOf, editOf } from "./edits.ts"
import { collectionOf, explicitColor, isModifierOnly, sequenceItems, systemGroup, withoutValues } from "./modifiers.ts"
import { classifyKeywords, labelFrom } from "../classify/keywords.ts"
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

const NUMBER_WORDS_GROUP: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, pair: 2, trio: 3, couple: 2 }
/**
 * The values in a group Jev recognized: how many (the number written) and what
 * (the word it counts, past filler like "node"/"instance"), as "5 servers".
 */
function groupCount(text: string): { n: number; noun: string } | null {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean)
  const filler = /^(of|the|a|an|node|nodes|instance|instances|replica|replicas|x|copies|copy|identical|replicated)$/
  // "redis x3", "api 3x": the count after the thing it counts.
  const times = words.findIndex((w) => /^x\d+$|^\d+x$/.test(w))
  if (times > 0) {
    const n = Number(words[times]!.replace(/x/g, ""))
    const noun = [...words.slice(0, times)].reverse().find((w) => !filler.test(w))
    return n > 1 && noun ? { n, noun } : null
  }
  const at = words.findIndex((w) => /^\d+$/.test(w) || w in NUMBER_WORDS_GROUP)
  if (at < 0) return null
  const n = /^\d+$/.test(words[at]!) ? Number(words[at]) : NUMBER_WORDS_GROUP[words[at]!]!
  // "5 independent servers" → "independent server": every word it counts, past the filler.
  // It ends at the plural word ("independent servers"), else at the last word that names a kind ("server stack").
  const rest = words.slice(at + 1).filter((w) => !filler.test(w))
  const plural = rest.findIndex((w) => /[a-z]{2,}s$/.test(w) && !/(ss|us|is)$/.test(w))
  const kind = rest.findLastIndex((w) => classifyKeywords(w).type !== "box")
  const end = plural >= 0 ? plural : kind >= 0 ? kind : rest.length - 1
  const noun = rest.slice(0, end + 1).join(" ").replace(/(?<!s)s$/, "")
  return n > 1 && noun ? { n, noun } : null
}

/** The thing a phrase names, without what it says about it: "4 servers that are all orange" → "4 servers". */
const withoutDescription = (text: string) =>
  text
    .replace(/,?\s+(?:that|which|who)\s+(?:are|is|were|all|each)\b.*$/i, "")
    .replace(/,?\s+(?:all|each|both)\s+(?:in\s+|colou?red\s+)?[a-z]+$/i, "")
    .trim() || text

/** A piece of only pointer words ("in which they", "them", "each of those") names nothing new. */
const POINTER = /^(?:(?:in|of|to|with|for|on|at|from|where|which|that|who|whom|whose|they|them|it|its|those|these|this|each|all|both|then|so|and|every|one)\b[\s,]*)+$/i
/** "the …", "those …", "these …", "both …": something already mentioned. */
const DEFINITE = /^(?:the|those|these|both|all(?:\s+the)?|each\s+of\s+the)\s+/i

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
    }
  return d[a.length]![b.length]!
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
  const plain = withoutValues(text.replace(/@([a-z0-9][a-z0-9-]*)/gi, (_, h: string) => h.replace(/-/g, " "))) || text
  // Keep numbers that are values ("25 min timer"); drop the count of repeats.
  let t = (repeated ? plain.replace(COUNT, "") : plain)
    .replace(/\b(individual|separate|different|distinct|single)\s+/gi, "")
    .replace(/\bdata\s+base/gi, "database")
    .replace(LAYOUT_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim()
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
export type HandleInfo = ReadonlyMap<
  string,
  { container: boolean; type?: NodeType; label?: string; /** The container's @handle. */ parent?: string | null; /** Its list (fields, links, rows): own items or the defaults it shows. */ items?: readonly string[] }
>

/** Media that can sit inside any element ("embed an image in the hero"). */
const EMBEDDABLE = new Set<NodeType>(["image", "video", "chart", "map", "avatar"])

const nameKey = (s: string) => s.toLowerCase().replace(/^(?:the|our|my|a|an)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim()

/**
 * "an image in the hero area": the element named by its label (or handle
 * words) at the end of the phrase, if one exists on the board.
 */
export function namedTarget(text: string, handles: HandleInfo): { rest: string; handle: string } | null {
  const m = /^(.*?\S)\s+(?:in|into|inside|within|on|onto|to)\s+(?:the\s+|our\s+|my\s+)?(.+)$/i.exec(text.trim())
  if (!m || m[2]!.startsWith("@")) return null
  const want = nameKey(m[2]!)
  for (const [h, info] of handles) {
    if ((info.label && nameKey(info.label) === want) || nameKey(h.slice(1).replace(/-/g, " ")) === want) return { rest: m[1]!, handle: h }
  }
  return null
}

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

/** Sentinels for "at the top / bottom" of a container. */
export const TOP = "$top"
export const BOTTOM = "$bottom"

const WRAPPER_WORDS = /\b(box|wrapper|container|group|block|frame)\b/i

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
  const patches: EntryPatch[] = []
  const known = new Set(handles.keys())
  /** Move existing elements into a container of this entry (never into themselves). */
  const moveInto = (targets: readonly string[], containerKey: string) => {
    for (const t of targets) {
      if (!known.has(t) || t === containerKey) continue
      const existing = patches.find((p) => p.target === t)
      if (existing) Object.assign(existing, { parent: containerKey })
      else patches.push({ target: t, parent: containerKey })
    }
  }
  /** The container this entry made most recently: what "it" means in "it should include …". */
  const lastContainer = () => [...nodes].reverse().find((n) => REGISTRY[n.type].container)
  const byKey = new Map<string, MutableNode>()
  /** Which node key each piece became (a repeated name reuses the earlier node). */
  const keyOfPiece = new Map<number, string>()
  /** Top-level/edge nodes by label, so "api … api" is one element. */
  const byLabel = new Map<string, string>()
  let prev: { key: string; parent: string | null; container: boolean } | null = null
  /** Groups this entry made, by their members' name ("load balancer"). */
  const groupNames = new Map<string, string>()
  /** "the load balancers" / "those servers" (typos too): a group or element this entry already made. */
  const sameEntry = (text: string): string | null => {
    if (!DEFINITE.test(text.trim())) return null
    const name = cleanLabel(text.trim().replace(DEFINITE, ""), true).toLowerCase()
    const known: [string, string][] = [...groupNames, ...byLabel]
    const close = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 6 && editDistance(a, b) <= 2)
    return known.find(([l]) => close(l, name) || close(l, name.replace(/s$/, "")))?.[1] ?? null
  }

  /** "5 servers" on a system diagram: the group's key stands for each member. */
  const groups = new Map<string, string[]>()
  const addEdge = (from: string | undefined, to: string, kind: EntryEdge["kind"], label?: string) => {
    if (!from) return
    for (const f of groups.get(from) ?? [from])
      for (const t of groups.get(to) ?? [to]) {
        if (f === t || edges.some((e) => e.from === f && e.to === t && e.kind === kind)) continue
        edges.push({ from: f, to: t, kind, ...(label ? { label } : {}) })
      }
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
    if (piece.connector === "include") {
      // "it" is the element this entry just made; it becomes the container if it isn't one.
      const last = [...nodes].reverse().find((n) => n.parent === null)
      // A "wrapper / box / container / group" is a plain section, whatever else its name says.
      if (last && (!REGISTRY[last.type].container || WRAPPER_WORDS.test(last.label))) last.type = "section"
      let box = last ?? lastContainer()
      if (!box) {
        box = { key: `p${piece.index}`, type: "section", label: "Group", parent: null, props: {} }
        nodes.push(box)
        byKey.set(box.key, box)
      }
      moveInto(piece.include ?? [], box.key)
      prev = { key: box.key, parent: box.parent, container: true }
      return
    }
    // "make all servers red", "color everything blue": the same change to many existing elements.
    const bulk = piece.wrap ? null : bulkEditOf(piece.text, handles, recent)
    if (bulk) {
      for (const p of bulk) {
        const existing = patches.find((q) => q.target === p.target)
        if (existing) Object.assign(existing, p)
        else patches.push(p)
      }
      prev = null
      return
    }
    // "make @x red", "rename @x to Checkout": a change to an existing element, not a new one.
    const change = piece.wrap ? null : editOf(piece.text, known)
    if (change) {
      const existing = patches.find((p) => p.target === change.target)
      if (existing) Object.assign(existing, change)
      else patches.push(change)
      prev = { key: change.target, parent: null, container: handles.get(change.target)?.container ?? false }
      return
    }
    const a0 = answers[i]
    if (!a0) return
    // "with increments of 15": values for the element before it, not a new element.
    if (prev && !piece.edge && piece.connector !== "start" && isModifierOnly(piece.text)) {
      const target = byKey.get(prev.key)
      const values = target ? sequenceItems(piece.text, target.props.of ?? target.type) : null
      if (target && values) {
        target.props = { ...target.props, items: values }
        return
      }
    }
    // "a table of timers": the collection word is the head noun; the rest is its item type.
    const collection = collectionOf(piece.text)
    // A wrap's container is always a container: a page if it says so, else a section.
    const wrapType: NodeType | null = piece.wrap
      ? WRAPPER_WORDS.test(piece.text) || !REGISTRY[a0.nodeType.value].container
        ? "section"
        : a0.nodeType.value
      : null
    const a = collection
      ? { ...a0, nodeType: { value: collection.type, confidence: 1 }, isContainer: 0 }
      : wrapType
        ? { ...a0, nodeType: { value: wrapType, confidence: 1 }, isContainer: 1 }
        : a0
    const container = a.isContainer >= YES
    const edge = piece.connector === "edge" ? piece.edge : undefined

    // "@postgres", "the @postgres": a reference to a committed element, not a new one.
    // "in which they", "them", "each of those": no thing named, only a pointer back to the one before.
    const back = POINTER.test(piece.text) && prev ? prev.key : sameEntry(piece.text)
    if (back) {
      keyOfPiece.set(piece.index, back)
      if (edge) addEdge(keyOfPiece.get(edge.from), back, edge.kind, edge.label)
      const n = byKey.get(back)
      prev = { key: back, parent: n?.parent ?? null, container: n ? REGISTRY[n.type].container : false }
      return
    }

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
    /** The phrase without "in the hero area" when that named an existing element. */
    let namedRest: string | null = null
    // Arrow targets are separate elements, never nested.
    if (!edge && piece.connector !== "start" && prev) {
      // Jev's childOfContainer says it belongs in *a* container, not which: after "," / "and" that's the
      // previous element's own container (siblings), unless the previous element is the top-level one.
      const nest = piece.connector === "with" || (a.childOfContainer >= YES && prev.parent === null)
      // Media right after an element sits inside it ("a hero with an image"), container or not.
      const holds = prev.container || (piece.connector === "with" && EMBEDDABLE.has(a.nodeType.value))
      parent = nest && holds ? prev.key : prev.parent
    }
    // "add a form to @landing-page": into a known container; media ("embed an image in @hero")
    // can sit inside any element.
    if (piece.into && (handles.get(piece.into)?.container || EMBEDDABLE.has(a.nodeType.value))) parent = piece.into
    else if (!piece.into && !edge) {
      // Elements of this same entry come first: "a hero … an image inside the hero" means this hero.
      const scope: HandleInfo = new Map([
        ...nodes.map((n) => [n.key, { container: REGISTRY[n.type].container, type: n.type, label: n.label }] as const),
        ...handles,
      ])
      const named = namedTarget(piece.text, scope)
      if (named && (scope.get(named.handle)?.container || EMBEDDABLE.has(a.nodeType.value))) {
        parent = named.handle
        namedRest = named.rest
      }
    }
    // Services, databases, queues… are system pieces, never parts of a page.
    if (REGISTRY[a.nodeType.value].lane === "architecture") parent = null

    // "a stack of 5 servers" → "5 servers". When Jev says the piece is a group of copies ("a 5 server
    // stack", "a trio of api nodes"), code reads the number written and the thing it counts.
    const named = withoutDescription(piece.text)
    const grouped = (a.isGroup ?? 0) >= YES ? groupCount(named) : null
    const countText = systemGroup(named) ?? named
    const count = grouped ? Math.min(grouped.n, 12) : countOf(countText)
    const key = `p${piece.index}`
    const layout = a.layout.value !== "none" && a.layout.confidence >= YES ? a.layout.value : null

    if (count > 1 && REGISTRY[a.nodeType.value].lane === "architecture") {
      // System pieces repeat as separate, numbered elements ("Server 1 … Server 5"), never a box;
      // arrows to or from the group reach every member.
      const label = grouped ? grouped.noun.replace(/^./, (c) => c.toUpperCase()) : cleanLabel(countText, true)
      const members: string[] = []
      const color = explicitColor(piece.text)
      for (let r = 0; r < count; r++) {
        const m: MutableNode = { key: `${key}.${r}`, type: a.nodeType.value, label: `${label} ${r + 1}`, parent: null, props: color ? { color } : {} }
        nodes.push(m)
        byKey.set(m.key, m)
        members.push(m.key)
      }
      groups.set(key, members)
      groupNames.set(label.toLowerCase(), key)
      keyOfPiece.set(piece.index, key)
      if (edge) addEdge(keyOfPiece.get(edge.from), key, edge.kind, edge.label)
      prev = { key, parent: null, container: false }
      return
    }

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

    // Values code can read straight from the text: items, color.
    // Named colors always; implied ones ("delete" → red) only when Jev is sure, and not on whole pages/sections.
    const implied =
      a.accent.value !== "none" && a.accent.confidence >= 0.85 && !REGISTRY[a.nodeType.value].container ? ACCENTS[a.accent.value].hex : null
    const color = explicitColor(piece.text) ?? implied
    const items = piece.items ?? sequenceItems(piece.text, collection?.of ?? a.nodeType.value) ?? undefined
    const node: MutableNode = {
      key,
      type: a.nodeType.value,
      label: piece.aliasIsName && piece.alias ? titleCase(piece.alias) : aliasLabel(cleanLabel(namedRest ?? piece.text, false), piece.alias),
      parent,
      props: {
        ...(collection?.of ? { of: collection.of } : {}),
        ...(collection?.layout ? { layout: collection.layout } : {}),
        ...(items ? { items } : {}),
        ...(color ? { color } : {}),
      },
    }
    nodes.push(node)
    byKey.set(key, node)
    keyOfPiece.set(piece.index, key)
    // "between @a and @b", "above @x", "at the bottom of @page": position among siblings.
    if (piece.place && !edge) {
      const pl = piece.place
      if (pl.parent && handles.get(pl.parent)?.container && node.parent === null) node.parent = pl.parent
      if (pl.after) node.after = pl.after
      if (pl.before) node.before = pl.before
      if (pl.end === "top") node.before = TOP
      if (pl.end === "bottom") node.after = BOTTOM
    }
    if (parent === null) byLabel.set(node.label.toLowerCase(), key)
    if (piece.wrap) moveInto(piece.wrap === "recent" ? recent : piece.wrap, key)
    if (edge) addEdge(keyOfPiece.get(edge.from), key, edge.kind, edge.label)

    if (layout) {
      // "section in a grid" lays out the section itself; a leaf's phrase lays out its parent.
      const target = container ? node : parent ? byKey.get(parent) : undefined
      if (target) target.props = { ...target.props, layout }
    }

    prev = { key, parent, container }
  })

  return { nodes, edges, suggestions: [], patches }
}
