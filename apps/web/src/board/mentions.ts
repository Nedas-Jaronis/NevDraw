import { HANDLE_TOKEN } from "@rtw/shared"

export type HandleOption = { handle: string; label: string; type: string }

/** The "@que|" being typed at the caret, if any. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([a-z0-9-]*)$/i.exec(before)
  if (!m) return null
  return { start: before.length - m[2]!.length - 1, query: m[2]!.toLowerCase() }
}

/** Best matches first: handle prefix, then label/handle contains. */
export function matchHandles(query: string, options: readonly HandleOption[], limit = 6): HandleOption[] {
  const q = query.toLowerCase()
  const score = (o: HandleOption) => {
    const h = o.handle.slice(1)
    if (h.startsWith(q)) return 0
    if (h.includes(q) || o.label.toLowerCase().includes(q)) return 1
    return 2
  }
  return options
    .map((o) => ({ o, s: score(o) }))
    .filter((x) => x.s < 2)
    .sort((a, b) => a.s - b.s || a.o.handle.length - b.o.handle.length)
    .slice(0, limit)
    .map((x) => x.o)
}

/** Replace the active "@que" with the chosen handle plus a space; returns the new text and caret. */
export function insertMention(text: string, caret: number, start: number, handle: string) {
  const next = `${text.slice(0, start)}${handle} ${text.slice(caret).replace(/^\s+/, "")}`
  return { text: next, caret: start + handle.length + 1 }
}

/** Known handles referenced in the text, in order, without duplicates. */
export function referencedHandles(text: string, known: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const m of text.matchAll(HANDLE_TOKEN)) {
    const h = m[0].toLowerCase()
    if (known.has(h) && !out.includes(h)) out.push(h)
  }
  return out
}
