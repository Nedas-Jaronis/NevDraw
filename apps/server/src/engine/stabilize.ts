import type { NodeType } from "@rtw/shared"
import type { PieceAnswers } from "./answers.ts"

/**
 * Calm-UI hysteresis per piece, ported from Shapeshift's decide.ts. Raw
 * classifier output flickers while typing; the shown type only changes when:
 * - the current type came from the keyword placeholder and Jev has answered, or
 * - a challenger is very sure (≥ 0.85), or
 * - the same challenger wins twice in a row with reasonable confidence.
 */
export const THRESHOLDS = {
  challengerOverride: 0.85,
  challengerWins: 2,
  challengerFloor: 0.4,
} as const

export type PieceMemory = {
  type: NodeType
  source: PieceAnswers["source"]
  challenger: { type: NodeType; wins: number } | null
}

export function stabilize(prev: PieceMemory | undefined, a: PieceAnswers): { answers: PieceAnswers; memory: PieceMemory } {
  const next = (type: NodeType, challenger: PieceMemory["challenger"] = null) => ({
    answers: type === a.nodeType.value ? a : { ...a, nodeType: { value: type, confidence: a.nodeType.confidence } },
    memory: { type, source: type === a.nodeType.value ? a.source : prev?.source ?? a.source, challenger },
  })

  const top = a.nodeType.value
  const conf = a.nodeType.confidence
  if (!prev || top === prev.type) return next(top)
  if (prev.source === "keyword" && a.source === "jev") return next(top)
  if (conf >= THRESHOLDS.challengerOverride) return next(top)

  const wins = prev.challenger?.type === top ? prev.challenger.wins + 1 : 1
  if (wins >= THRESHOLDS.challengerWins && conf >= THRESHOLDS.challengerFloor) return next(top)
  return next(prev.type, { type: top, wins })
}
