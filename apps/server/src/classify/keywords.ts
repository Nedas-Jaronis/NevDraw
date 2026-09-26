import { NODE_TYPES, type NodeType, REGISTRY } from "@rtw/shared"

export type KeywordGuess = {
  type: NodeType
  /** 0..1. The catch-all `box` reports low confidence. */
  confidence: number
  probabilities: Partial<Record<NodeType, number>>
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

/** Whole-phrase matchers, compiled once. */
const MATCHERS = NODE_TYPES.flatMap((type) =>
  REGISTRY[type].keywords.map((kw) => ({ type, kw, re: new RegExp(`(^|[^a-z0-9])${escape(kw)}s?(?=$|[^a-z0-9])`, "i") })),
)

/**
 * Offline classifier with the same output shape Jev will produce.
 * Scores each type by its matched keywords (longer phrases weigh more). The
 * rightmost mention wins, because the head noun of an English noun phrase
 * comes last: "signup button" is a button, "pricing table" a table. (The
 * splitter has already cut "landing page with a form" into two pieces.)
 */
export function classifyKeywords(text: string): KeywordGuess {
  const t = text.toLowerCase()
  const scores = new Map<NodeType, { score: number; last: number }>()
  for (const m of MATCHERS) {
    const hit = m.re.exec(t)
    if (!hit) continue
    const end = hit.index + hit[0].length
    const prev = scores.get(m.type) ?? { score: 0, last: Number.NEGATIVE_INFINITY }
    scores.set(m.type, { score: prev.score + m.kw.length, last: Math.max(prev.last, end) })
  }
  if (scores.size === 0) return { type: "box", confidence: 0.3, probabilities: { box: 1 } }

  const ranked = [...scores.entries()].sort((a, b) => b[1].last - a[1].last || b[1].score - a[1].score)
  const total = [...scores.values()].reduce((s, v) => s + v.score, 0)
  const probabilities = Object.fromEntries(ranked.map(([k, v]) => [k, v.score / total])) as Partial<Record<NodeType, number>>
  const [top] = ranked[0]!
  return { type: top, confidence: Math.max(0.5, probabilities[top] ?? 0), probabilities }
}

/** A readable label: the text minus filler, trimmed and capitalized. */
export function labelFrom(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^(add|create|make|build|we need|i want|there('s| is)|a|an|the)\s+/gi, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
  const label = cleaned.length > 48 ? `${cleaned.slice(0, 47).trimEnd()}…` : cleaned
  return label.charAt(0).toUpperCase() + label.slice(1)
}
