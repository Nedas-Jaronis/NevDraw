import type { EdgeKind } from "@rtw/shared"

/**
 * Deterministic splitter: breaks an entry into pieces, remembering how each
 * piece was joined to the one before it. Indexes are global across sentences
 * so keys stay stable as the user keeps typing at the end.
 */

/** How a piece attaches to what came before. */
export type Connector =
  /** First piece of a sentence: top-level. */
  | "start"
  /** "with", "including", "containing", "that has": a child of the previous container. */
  | "with"
  /** ",", "and", "&", "plus": a sibling of the previous piece. */
  | "and"
  /** A relation verb ("writes to"): the piece is the target of an arrow. */
  | "edge"

export type Piece = {
  index: number
  text: string
  connector: Connector
  /** For "edge" pieces: the arrow's kind and the index of its source piece. */
  edge?: { kind: EdgeKind; from: number }
}

const SENTENCE = /[.;\n]+/

/**
 * Relation verbs → edge kinds. Code computes these ("Jev decides, code
 * computes"); vague verbs ("uses", "talks to") mean a call.
 */
const VERBS: ReadonlyArray<readonly [string, EdgeKind]> = [
  ["reads? from|reads|fetch(?:es)? from|fetches|queries|loads? from|gets? data from|pulls? from", "reads"],
  ["writes? to|writes? into|writes|saves? to|saves? in(?:to)?|stores? in(?:to)?|stores? to|persists? to|updates|inserts? into", "writes"],
  ["publish(?:es)? (?:events |messages )?to|publish(?:es)?|emits? (?:events )?to|pushes (?:events |messages )?to|produces? to|enqueues? (?:in)?to", "publishes"],
  ["subscribes? to|listens? (?:to|on)|consumes? from|consumes?", "subscribes"],
  ["navigates? to|goes to|links? to|leads? to|redirects? to|routes? to", "navigates-to"],
  ["calls|requests|sends? (?:requests? |data )?to|posts? to|hits|talks? to|connects? to|uses|depends on|->|→|=>", "calls"],
]
const VERB_RES = VERBS.map(([alt, kind]) => [new RegExp(`^(?:${alt})$`, "i"), kind] as const)
const VERB_ALTERNATION = VERBS.map(([alt]) => alt.replace(/\|?(?:->|→|=>)/g, "")).join("|")

/**
 * Captured so we know which joiner sat between two pieces. Joiners never eat
 * trailing whitespace (lookaheads), so "… and publishes to …" still sees the verb.
 */
const JOINER = new RegExp(
  `(\\s*(?:->|→|=>)|\\s*,(?:\\s*(?:and|&|plus)(?=\\s))?|\\s+(?:and|&|plus)(?=\\s)|\\s+(?:with|including|containing|featuring|that has|which has|has)(?=\\s)|(?:^|\\s+)(?:${VERB_ALTERNATION})(?=\\s))`,
  "i",
)
const CHILD_JOINER = /^\s*(with|including|containing|featuring|that has|which has|has)\s*$/i

/** Text that alone doesn't make an element, e.g. a half-typed "landing page with a". */
const FILLER = /^(a|an|the|some|and|with|of|to|in|on|for|plus|&|which|that|then|it|also)?$/i

export function verbKind(joiner: string): EdgeKind | null {
  const j = joiner.trim().replace(/\s+/g, " ")
  if (!j) return null
  for (const [re, kind] of VERB_RES) if (re.test(j)) return kind
  return null
}

export function split(text: string): Piece[] {
  const pieces: Piece[] = []
  for (const sentence of text.split(SENTENCE)) {
    const parts = sentence.split(JOINER)
    let connector: Connector = "start"
    /** The current arrow kind while listing targets ("writes to B and C"). */
    let kind: EdgeKind | null = null
    /** Source of the current arrows: the subject that "and <verb> …" continues from. */
    let subject: number | null = null
    let prev: number | null = null

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      if (i % 2 === 1) {
        const k = verbKind(part)
        if (k) {
          // "A writes to …": the arrow starts at the previous piece, unless we're
          // continuing a list of relations ("… and publishes to …"), which start at the subject.
          if (connector !== "edge" || kind === null) subject = prev
          kind = k
          connector = "edge"
        } else if (connector !== "edge") {
          connector = prev === null ? "start" : CHILD_JOINER.test(part) ? "with" : "and"
        }
        continue
      }
      // Drop a half-typed joiner at the end ("landing page with" → "landing page").
      const t = part
        .trim()
        .replace(/[\s,]*\b(with|and|including|containing|featuring|plus|that|which)$/i, "")
        .replace(/[\s,&]+$/, "")
      if (FILLER.test(t)) continue

      const index = pieces.length
      // A piece followed by its own verb ("web app -> api -> db") is both the target of the
      // incoming arrow and the source of the next one.
      const startsClause = verbKind(parts[i + 1] ?? "") !== null
      if (connector === "edge" && kind && subject !== null) {
        pieces.push({ index, text: t, connector: "edge", edge: { kind, from: subject } })
        if (startsClause) kind = null
      } else {
        pieces.push({ index, text: t, connector: prev === null ? "start" : connector === "edge" ? "and" : connector })
        connector = "and"
        kind = null
      }
      prev = index
    }
  }
  return pieces
}
