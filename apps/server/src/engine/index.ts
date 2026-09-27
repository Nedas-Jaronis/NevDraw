import { REGISTRY } from "@rtw/shared"
import type { EntryGraph } from "@rtw/shared"
import type { PieceState } from "../classify/Jev.ts"
import { keywordAnswers, type PieceAnswers } from "./answers.ts"
import { detachOf, noteOf } from "./edits.ts"
import { assemble, classificationText, type HandleInfo } from "./assemble.ts"
import { type Piece, split } from "./split.ts"
import { type PieceMemory, stabilize } from "./stabilize.ts"

export type { HandleInfo } from "./assemble.ts"
export { type BoardView, type DraftMemory, materialize, validateHandles } from "./materialize.ts"
export type { PieceMemory } from "./stabilize.ts"

/** Offline interpretation of an entry: split → keyword answers per piece → graph. */
export function interpretOffline(text: string, handles: HandleInfo = new Map()): EntryGraph {
  const pieces = split(text)
  return assemble(pieces, pieces.map(keywordAnswers), handles)
}

/**
 * The Jev state for each piece. `container` comes from the offline reading so
 * the state (and so the cache key) is stable and computable instantly.
 */
export function pieceStates(pieces: readonly Piece[], handles: readonly string[], info: HandleInfo = new Map()): PieceState[] {
  const offline = assemble(pieces, pieces.map(keywordAnswers), info)
  const parentOf = new Map(offline.nodes.map((n) => [n.key.split(".")[0]!, n.parent]))
  const textOf = (key: string | null | undefined) => {
    if (key?.startsWith("@")) return key
    const i = key ? Number(key.split(".")[0]!.slice(1)) : Number.NaN
    return Number.isInteger(i) ? (pieces[i]?.text ?? null) : null
  }
  return pieces.map((p, i) => ({
    piece: classificationText(p.text),
    previous: i > 0 ? pieces[i - 1]!.text : null,
    container: textOf(parentOf.get(`p${p.index}`)),
    handles,
  }))
}

/**
 * "Jev decides, code computes": when the LLM's reading replaces the instant
 * one, values code read straight from the text (named colors, sequences,
 * colon lists, collection item types) win over the LLM's guesses for the
 * same element (same key).
 */
export function keepComputed(llmRaw: EntryGraph, instant: EntryGraph): EntryGraph {
  const llm = completeFromInstant(llmRaw, instant)
  const computed = new Map(instant.nodes.map((n) => [n.key, n.props]))
  const placed = new Map(instant.nodes.map((n) => [n.key, n]))
  // Code-read changes (named colors, explicit renames/moves) win for the same element.
  const patches = new Map(llm.patches.map((p) => [p.target, p]))
  for (const p of instant.patches) patches.set(p.target, { ...patches.get(p.target), ...p })
  return {
    ...llm,
    patches: [...patches.values()],
    nodes: llm.nodes.map((n) => {
      const c = computed.get(n.key)
      if (!c) return n
      const at = placed.get(n.key)
      return {
        ...n,
        ...(at?.after ? { after: at.after } : {}),
        ...(at?.before ? { before: at.before } : {}),
        props: {
          ...n.props,
          ...(c.color ? { color: c.color } : {}),
          ...(c.items?.length ? { items: c.items } : {}),
          ...(c.of ? { of: c.of } : {}),
        },
      }
    }),
  }
}

/**
 * The LLM sometimes answers with only what it changed: arrows between the
 * draft's keys without the nodes, or a "patch" on a draft key. Elements it
 * mentions but didn't return are carried over from the instant graph (with
 * its fixes applied); an answer with no elements at all keeps the instant one.
 */
export function completeFromInstant(llm: EntryGraph, instant: EntryGraph): EntryGraph {
  const boardPatches = llm.patches.filter((p) => p.target.startsWith("@"))
  const localFixes = new Map(llm.patches.filter((p) => !p.target.startsWith("@")).map((p) => [p.target, p]))
  if (llm.nodes.length === 0 && instant.nodes.length > 0 && llm.edges.length === 0 && boardPatches.length === 0) return instant
  const have = new Set(llm.nodes.map((n) => n.key))
  const wanted = new Set([...llm.edges.flatMap((e) => [e.from, e.to]), ...localFixes.keys(), ...llm.nodes.flatMap((n) => (n.parent ? [n.parent] : []))])
  // Nothing returned: the model agreed with the draft, so every draft element stays.
  if (llm.nodes.length === 0) for (const n of instant.nodes) wanted.add(n.key)
  const carried = instant.nodes
    .filter((n) => wanted.has(n.key) && !have.has(n.key))
    .map((n) => {
      const fix = localFixes.get(n.key)
      return fix ? { ...n, ...(fix.label ? { label: fix.label } : {}), ...(fix.type ? { type: fix.type } : {}), props: { ...n.props, ...(fix.color ? { color: fix.color } : {}) } } : n
    })
  // Children of a carried container come along with it.
  const keys = new Set([...have, ...carried.map((n) => n.key)])
  const kids = instant.nodes.filter((n) => !keys.has(n.key) && n.parent !== null && carried.some((c) => c.key === n.parent))
  return { ...llm, nodes: [...llm.nodes, ...carried, ...kids], patches: boardPatches }
}

const labelKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/**
 * Elements that already exist are references, not new elements: a node keyed
 * by an existing @handle (one keyed by an invented handle is new, under a local key), or named like an existing element when the text says "the
 * <name>" (plus containers named like existing ones that the text never
 * mentions: context the model added).
 * "a signup page" (a new one) stays new. Arrows and parents are re-pointed.
 */
export function referToExisting(graph: EntryGraph, handles: HandleInfo, text: string): EntryGraph {
  const said = ` ${labelKey(text)} `
  const byLabel = new Map<string, string>()
  for (const [h, info] of handles) if (info.label && !byLabel.has(labelKey(info.label))) byLabel.set(labelKey(info.label), h)
  const alias = new Map<string, string>()
  for (const n of graph.nodes) {
    if (n.key.startsWith("@")) {
      // An existing element, or a handle the model invented for a new one (then it's just its key).
      alias.set(n.key, handles.has(n.key.toLowerCase()) ? n.key.toLowerCase() : `new:${n.key.slice(1)}`)
      continue
    }
    const name = labelKey(n.label)
    const h = byLabel.get(name)
    if (!h || !name) continue
    if (said.includes(` the ${name} `)) alias.set(n.key, h)
  }
  // Context the model added around a reference ("the signup form" → a new "Signup page"): a
  // container named like an existing one that the text never mentions is that one.
  for (const n of graph.nodes) {
    const name = labelKey(n.label)
    const h = byLabel.get(name)
    if (h && !alias.has(n.key) && REGISTRY[n.type].container && !said.includes(` ${name} `)) alias.set(n.key, h)
  }
  if (alias.size === 0) return graph
  const to = (k: string) => alias.get(k) ?? k
  const edges = graph.edges.map((e) => ({ ...e, from: to(e.from), to: to(e.to) })).filter((e) => e.from !== e.to)
  return {
    ...graph,
    nodes: graph.nodes
      .filter((n) => !alias.has(n.key) || alias.get(n.key)!.startsWith("new:"))
      .map((n) => ({
        ...n,
        key: to(n.key),
        parent: n.parent === null ? null : to(n.parent),
        ...(n.after ? { after: to(n.after) } : {}),
        ...(n.before ? { before: to(n.before) } : {}),
      })),
    edges: edges.filter((e, i) => edges.findIndex((x) => x.from === e.from && x.to === e.to && x.kind === e.kind) === i),
    patches: graph.patches.map((p) => (p.parent ? { ...p, parent: to(p.parent) } : p)),
  }
}

export type PieceDebug = { text: string; type: string; confidence: number; source: "keyword" | "jev" }

/**
 * Pure: text + whatever Jev answers are cached → the entry graph to show now.
 * Missing answers use the keyword placeholder; every answer goes through the
 * per-piece hysteresis so types don't flip-flop while typing.
 */
export function interpret(input: {
  text: string
  /** Committed @handles and whether each is a container. */
  handles: HandleInfo
  /** What "them" means in "connect them": this person's most recent elements. */
  recent?: readonly string[]
  peek: (s: PieceState) => PieceAnswers | undefined
  memory: ReadonlyMap<number, PieceMemory>
}) {
  // "detach @a from @b", "disconnect @a and @b": one command, not a sentence to split.
  const detach = noteOf(input.text, input.handles) ?? detachOf(input.text, input.handles)
  if (detach) return { graph: { nodes: [], edges: [], suggestions: [], patches: detach }, memory: new Map<number, PieceMemory>(), missing: [], debug: [], pieces: [] }
  const pieces = split(input.text)
  const states = pieceStates(pieces, [...input.handles.keys()], input.handles)
  const memory = new Map<number, PieceMemory>()
  const missing: PieceState[] = []
  const answers = pieces.map((p, i) => {
    const cached = p.text ? input.peek(states[i]!) : undefined
    if (!cached && p.text) missing.push(states[i]!)
    const s = stabilize(input.memory.get(p.index), cached ?? keywordAnswers(p))
    memory.set(p.index, s.memory)
    return s.answers
  })
  const debug: PieceDebug[] = pieces.map((p, i) => ({
    text: p.text,
    type: answers[i]!.nodeType.value,
    confidence: Math.round(answers[i]!.nodeType.confidence * 100) / 100,
    source: answers[i]!.source,
  }))
  return { graph: assemble(pieces, answers, input.handles, input.recent ?? []), memory, missing, debug, pieces }
}
