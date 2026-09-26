import { EVOCATIVE_COLORS, type NodeType, parseColor, REGISTRY } from "@rtw/shared"
import { classifyKeywords } from "../classify/keywords.ts"

/**
 * Values in an entry, computed by code ("Jev decides, code computes"):
 * collections ("a table of timers"), sequences ("increments of 15"), lists
 * ("a checklist: milk, eggs and bread") and explicit colors.
 */

const COLLECTION = /^(?:a|an|the|some|my|our)?\s*(tables?|lists?|grids?|rows?|columns?|sets?|groups?|collections?|stacks?|series|feeds?|carousels?|galleries|gallery|decks?)\s+of\s+(.+)$/i

export type Collection = { type: NodeType; layout?: "grid" | "row"; of?: NodeType }

const singular = (s: string) => s.replace(/(\w{3,}?)(ies)$/i, "$1y").replace(/(\w{3,}[^s])s$/i, "$1")

/** "a stack / cluster / pool of 5 servers" → "5 servers" (a group of system pieces). */
export function systemGroup(text: string): string | null {
  const m = /^(?:a|an|the)?\s*(?:stack|cluster|pool|fleet|group|set|farm|tier|layer|bunch|couple)s?\s+of\s+(.+)$/i.exec(text.trim())
  if (!m) return null
  const item = classifyKeywords(singular(m[1]!.trim().replace(/^(?:\d+|two|three|four|five|six|seven|eight)\s+/i, ""))).type
  return REGISTRY[item].lane === "architecture" ? m[1]!.trim() : null
}

/** "a table of timers" → table of timer; "a grid of cards" → section (grid) of card. */
export function collectionOf(text: string): Collection | null {
  const m = COLLECTION.exec(text.trim())
  if (!m) return null
  const word = m[1]!.toLowerCase()
  const item = classifyKeywords(singular(m[2]!.trim().replace(/^\d+\s+/, ""))).type
  // "a stack of 5 servers" is five servers on the diagram, not a list widget.
  if (REGISTRY[item].lane === "architecture") return null
  const of = item === "box" ? undefined : item
  if (/^table/.test(word)) return { type: "table", ...(of ? { of } : {}) }
  if (/^(grid|galler|deck|carousel)/.test(word)) return { type: "section", layout: "grid", ...(of ? { of } : {}) }
  if (/^row/.test(word)) return { type: "section", layout: "row", ...(of ? { of } : {}) }
  return { type: "list", ...(of ? { of } : {}) }
}

const UNIT_WORDS: Record<string, string> = {
  s: "sec", sec: "sec", secs: "sec", second: "sec", seconds: "sec",
  m: "min", min: "min", mins: "min", minute: "min", minutes: "min",
  h: "hr", hr: "hr", hrs: "hr", hour: "hr", hours: "hr",
  "%": "%", percent: "%", day: "days", days: "days", k: "k", "$": "$",
}
const TIME_TYPES = new Set<NodeType>(["timer", "stopwatch", "countdown", "reminder"])
const unitFor = (explicit: string | undefined, of: NodeType | undefined) =>
  explicit ? (UNIT_WORDS[explicit.toLowerCase()] ?? explicit) : of && TIME_TYPES.has(of) ? "min" : ""
const fmt = (n: number, unit: string) =>
  /^[$€£]$/.test(unit) ? `${unit}${n}` : unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : String(n)

const MAX_ITEMS = 8

const UNIT = "(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|days?|%|percent|k)"
const NUM = "(\\d+(?:\\.\\d+)?)"
const CUR = "([$€£])?"
const SEQ = new RegExp(`\\b(?:in\\s+)?(?:increments?|steps?|intervals?)\\s+of\\s+${CUR}${NUM}(?:\\s*${UNIT}(?![a-z]))?(?:\\s+(?:up\\s+)?to\\s+[$€£]?${NUM})?`, "i")
/** "15 min increments", "in 15-minute steps", "10 second intervals". */
const SEQ_BEFORE = new RegExp(
  `\\b(?:in\\s+)?${CUR}${NUM}(?:[\\s-]*${UNIT}(?![a-z]))?[\\s-]+(?:increments?|steps?|intervals?)\\b(?:\\s+(?:up\\s+)?to\\s+[$€£]?${NUM})?`,
  "i",
)
const EVERY = new RegExp(`\\bevery\\s+${CUR}${NUM}\\s*${UNIT}(?![a-z])(?:\\s+(?:up\\s+)?to\\s+[$€£]?${NUM})?`, "i")
const RANGE = new RegExp(
  `\\bfrom\\s+${CUR}${NUM}(?:\\s*${UNIT}(?![a-z]))?\\s+to\\s+[$€£]?${NUM}(?:\\s*${UNIT}(?![a-z]))?(?:\\s+(?:by|every|in steps of|in increments of)\\s+[$€£]?${NUM})?`,
  "i",
)

/** Sequence values in a phrase, or null. Units come from the phrase, else from the item type. */
export function sequenceItems(text: string, of?: NodeType): string[] | null {
  const seq = SEQ.exec(text) ?? SEQ_BEFORE.exec(text) ?? EVERY.exec(text)
  if (seq) {
    // Groups: 1 currency, 2 step, 3 unit, 4 max.
    const step = Number(seq[2])
    const max = seq[4] ? Number(seq[4]) : step * 4
    if (!(step > 0)) return null
    const unit = seq[1] ?? unitFor(seq[3], of)
    const out: string[] = []
    for (let v = step; v <= max + 1e-9 && out.length < MAX_ITEMS; v += step) out.push(fmt(Math.round(v * 100) / 100, unit))
    return out
  }
  const range = RANGE.exec(text)
  if (range) {
    // Groups: 1 currency, 2 from, 3 unit, 4 to, 5 unit, 6 step.
    const a = Number(range[2])
    const b = Number(range[4])
    const step = range[6] ? Number(range[6]) : Math.max(1, Math.round(Math.abs(b - a) / 3))
    if (!(step > 0)) return null
    const unit = range[1] ?? unitFor(range[3] ?? range[5], of)
    const out: string[] = []
    const dir = b >= a ? 1 : -1
    for (let v = a; dir * (b - v) >= -1e-9 && out.length < MAX_ITEMS; v += dir * step) out.push(fmt(Math.round(v * 100) / 100, unit))
    return out
  }
  return null
}

/** The text without value phrases, for labels ("list of timers from 5 to 30" → "list of timers"). */
export function withoutValues(text: string): string {
  return text.replace(SEQ, " ").replace(SEQ_BEFORE, " ").replace(EVERY, " ").replace(RANGE, " ").replace(/\s+/g, " ").trim()
}

/** A piece that only states values for the element before it ("with increments of 15"). */
export function isModifierOnly(text: string): boolean {
  const rest = text
    .replace(SEQ, " ")
    .replace(SEQ_BEFORE, " ")
    .replace(EVERY, " ")
    .replace(RANGE, " ")
    .replace(/\b(a|an|the|with|of|and|each|options?|items?|values?|rows?)\b/gi, " ")
    .trim()
  return rest.length === 0 && (SEQ.test(text) || SEQ_BEFORE.test(text) || EVERY.test(text) || RANGE.test(text))
}

/** "a checklist: milk, eggs and bread" → head "a checklist", items [Milk, Eggs, Bread]. */
export function colonList(text: string): { head: string; items: string[] } | null {
  const m = /^([^:]{2,}):\s*(.+)$/.exec(text)
  if (!m) return null
  const items = m[2]!
    .split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i)
    .map((x) => x.trim().replace(/^(?:a|an|the)\s+/i, ""))
    .filter(Boolean)
    .slice(0, 12)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
  return items.length ? { head: m[1]!.trim(), items } : null
}

/**
 * An explicit color in the text: hex, rgb, named colors ("red", "navy") and
 * references ("tiffany blue"), but not evocative words ("coffee shop page"
 * isn't brown).
 */
export function explicitColor(text: string): string | null {
  const c = parseColor(text)
  if (!c.hex) return null
  if (c.source === "named" && c.name && c.name in EVOCATIVE_COLORS) return null
  return c.source === "mood" ? null : c.hex.toLowerCase()
}
