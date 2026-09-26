/**
 * Deterministic splitter: breaks an entry into pieces, remembering how each
 * piece was joined to the one before it. Indexes are global across sentences
 * so keys stay stable as the user keeps typing at the end.
 */

/** How a piece attaches to the previous one. */
export type Connector =
  /** First piece of a sentence: top-level. */
  | "start"
  /** "with", "including", "containing", "that has": a child of the previous container. */
  | "with"
  /** ",", "and", "&", "plus": a sibling of the previous piece. */
  | "and"

export type Piece = { index: number; text: string; connector: Connector }

const SENTENCE = /[.;\n]+/
/** Captured so we know which joiner sat between two pieces. */
const JOINER = /(\s*,\s*(?:and\s+|&\s+|plus\s+)?|\s+(?:and|&|plus)\s+|\s+(?:with|including|containing|featuring|that has|which has|has)\s+)/i
const CHILD_JOINER = /^\s*(with|including|containing|featuring|that has|which has|has)\s*$/i

/** Text that alone doesn't make an element, e.g. a half-typed "landing page with a". */
const FILLER = /^(a|an|the|some|and|with|of|to|in|on|for|plus|&)?$/i

export function split(text: string): Piece[] {
  const pieces: Piece[] = []
  for (const sentence of text.split(SENTENCE)) {
    const parts = sentence.split(JOINER)
    let connector: Connector = "start"
    let inSentence = 0
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      if (i % 2 === 1) {
        // Odd indexes are the captured joiners. A sentence's first piece stays "start".
        if (inSentence > 0) connector = CHILD_JOINER.test(part) ? "with" : "and"
        continue
      }
      // Drop a half-typed joiner at the end ("landing page with" → "landing page").
      const t = part.trim().replace(/[\s,]*\b(with|and|including|containing|featuring|plus|that|which)$/i, "").replace(/[\s,&]+$/, "")
      if (FILLER.test(t)) continue
      pieces.push({ index: pieces.length, text: t, connector })
      inSentence++
      connector = "and"
    }
  }
  return pieces
}
