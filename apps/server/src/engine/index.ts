import type { EntryGraph } from "@rtw/shared"
import type { PieceState } from "../classify/Jev.ts"
import { keywordAnswers, type PieceAnswers } from "./answers.ts"
import { assemble, type HandleInfo } from "./assemble.ts"
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
    piece: p.text,
    previous: i > 0 ? pieces[i - 1]!.text : null,
    container: textOf(parentOf.get(`p${p.index}`)),
    handles,
  }))
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
  peek: (s: PieceState) => PieceAnswers | undefined
  memory: ReadonlyMap<number, PieceMemory>
}) {
  const pieces = split(input.text)
  const states = pieceStates(pieces, [...input.handles.keys()], input.handles)
  const memory = new Map<number, PieceMemory>()
  const missing: PieceState[] = []
  const answers = pieces.map((p, i) => {
    const cached = input.peek(states[i]!)
    if (!cached) missing.push(states[i]!)
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
  return { graph: assemble(pieces, answers, input.handles), memory, missing, debug, pieces }
}
