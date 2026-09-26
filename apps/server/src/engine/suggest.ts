import { type EntryGraph, slug, type Suggestion } from "@rtw/shared"
import type { Piece } from "./split.ts"

export type Named = { readonly handle: string; readonly label: string }

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(a|an|the|our|my)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

/**
 * Plain words that name an existing element ("postgres" while @postgres is
 * on the board) become "link to @postgres?" suggestions. Instant and free;
 * the LLM pass adds fuzzier ones. Never suggests an unknown handle.
 */
export function suggestLinks(pieces: readonly Piece[], board: readonly Named[]): Suggestion[] {
  if (board.length === 0) return []
  const byName = new Map<string, string>()
  for (const b of board) {
    byName.set(norm(b.label), b.handle)
    byName.set(norm(b.handle.slice(1).replace(/-/g, " ")), b.handle)
  }
  const out: Suggestion[] = []
  for (const p of pieces) {
    if (p.text.startsWith("@")) continue
    const handle = byName.get(norm(p.text)) ?? byName.get(slug(p.text, "").replace(/-/g, " "))
    if (handle && !out.some((s) => s.handle === handle)) out.push({ text: p.text, handle })
  }
  return out
}

/** Merge heuristic and LLM suggestions (LLM's first), one per handle, only known handles. */
export function mergeSuggestions(known: ReadonlySet<string>, ...lists: ReadonlyArray<ReadonlyArray<Suggestion>>): Suggestion[] {
  const out: Suggestion[] = []
  for (const list of lists) for (const s of list) if (known.has(s.handle) && !out.some((o) => o.handle === s.handle)) out.push(s)
  return out
}

export const suggestionsOf = (g: EntryGraph | null) => g?.suggestions ?? []
