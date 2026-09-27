import { type Accent, type EdgeKind, type Layout, type NodeType, REGISTRY } from "@rtw/shared"
import { classifyKeywords } from "../classify/keywords.ts"
import { classificationText } from "./assemble.ts"
import type { Piece } from "./split.ts"

/**
 * What a classifier decides about one piece. The shape mirrors the Jev
 * question set (#6): choices carry a confidence, yes/no answers are 0..1.
 * Values (counts, labels, layout phrases) are computed by code, not here.
 */
export type PieceAnswers = {
  nodeType: { value: NodeType; confidence: number }
  /** Should this piece hold children? */
  isContainer: number
  /** Does this piece belong inside the previous container even without "with"? */
  childOfContainer: number
  /** Jev: does this piece describe several copies of one element as a group ("a 5 server stack")? */
  isGroup?: number
  /** A layout the text asks for, if any. */
  layout: { value: Layout | "none"; confidence: number }
  /** A relationship between two elements (#7). */
  edgeKind: { value: EdgeKind | "none"; confidence: number }
  /** Refers to an existing @handle on the board (#9). */
  targetsHandle: number
  /** A color the text implies without naming it ("delete button" → red). */
  accent: { value: Accent | "none"; confidence: number }
  /** Keyword answers are provisional placeholders until Jev answers. */
  source: "keyword" | "jev"
}

const ROW = /\b(in a row|side by side|horizontal(ly)?|inline|columns?)\b/i
const GRID = /\b(grid|in a grid|tiles?)\b/i
const STACK = /\b(stacked|vertical(ly)?|in a column)\b/i

export function layoutPhrase(text: string): Layout | "none" {
  if (GRID.test(text)) return "grid"
  if (ROW.test(text)) return "row"
  if (STACK.test(text)) return "stack"
  return "none"
}

/** Offline answers from keywords: instant, and the fallback whenever Jev is unavailable. */
export function keywordAnswers(piece: Piece): PieceAnswers {
  // Repeats are classified by their item ("pricing card"), counted by code.
  // "an image in the hero area": the element is what comes before the placement words.
  const own = piece.text.replace(/\s+(?:in|into|inside|within|on|onto)\s+(?:the\s+|our\s+|my\s+)?[^,]+$/i, "")
  const guess = classifyKeywords(classificationText(own || piece.text))
  const layout = layoutPhrase(piece.text)
  return {
    nodeType: { value: guess.type, confidence: guess.confidence },
    isContainer: REGISTRY[guess.type].container ? 1 : 0,
    childOfContainer: piece.connector === "with" ? 1 : 0,
    layout: { value: layout, confidence: layout === "none" ? 0 : 0.9 },
    edgeKind: { value: "none", confidence: 1 },
    targetsHandle: 0,
    accent: { value: "none", confidence: 1 },
    source: "keyword",
  }
}
