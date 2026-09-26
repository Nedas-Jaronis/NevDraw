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
  /** "connect them together": arrows between the elements this person just added. */
  | "connect"

export type Piece = {
  index: number
  text: string
  connector: Connector
  /** For "edge" pieces: the arrow's kind and the index of its source piece. */
  edge?: { kind: EdgeKind; from: number }
  /** "add a form to @landing-page": the @handle this piece goes inside. */
  into?: string
  /** "a server and a database, being server and sql": what this element is called (here "sql"). */
  alias?: string
}

/**
 * A clarifying clause that names the elements just listed, in order:
 * "…, being server and sql", "namely …", "i.e. …", "called …", "named …".
 */
const ALIAS = /(?:\s*,\s*|\s+)(?:being|namely|specifically|i\.?e\.?,?|which are|which is|that is|those being|these being|called|named)\s+(.+)$/i

function aliasItems(list: string): string[] {
  return list
    .split(/\s*,\s*(?:and\s+)?|\s+(?:and|&)\s+/i)
    .map((x) => x.trim().replace(/^(?:a|an|the)\s+/i, ""))
    .filter((x) => x.length > 0)
}

/** "signup form to @landing-page" → ["signup form", "@landing-page"]. */
const INTO = /^(.*?\S)\s+(?:to|in|into|inside|on|under)\s+(@[a-z0-9][a-z0-9-]*)$/i

const SENTENCE = /[.;\n]+/

/**
 * Relation verbs → edge kinds. Code computes these ("Jev decides, code
 * computes"); vague verbs ("uses", "talks to") mean a call.
 */
const VERBS: ReadonlyArray<readonly [string, EdgeKind]> = [
  ["reads? from|reads|reading from|fetch(?:es)? from|fetching from|fetches|queries|querying|loads? from|gets? data from|pulls? from", "reads"],
  ["writes? to|writes? into|writes|writing to|saves? to|saving to|saves? in(?:to)?|stores? in(?:to)?|stores? to|storing in|persists? to|updates|inserts? into", "writes"],
  ["publish(?:es)? (?:events |messages )?to|publish(?:es)?|publishing to|emits? (?:events )?to|pushes (?:events |messages )?to|produces? to|enqueues? (?:in)?to", "publishes"],
  ["subscribes? to|subscribing to|listens? (?:to|on)|listening to|consumes? from|consuming from|consumes?", "subscribes"],
  ["navigates? to|navigating to|goes to|links? to|leads? to|redirects? to|routes? to", "navigates-to"],
  ["calls|calling|requests|sends? (?:requests? |data )?to|sending to|posts? to|hits|talks? to|talking to|connects? to|connecting to|uses|using|depends on|->|→|=>", "calls"],
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

/**
 * Conversation around the actual content: "can you create …", "please add …",
 * "let's make …", "I want …". Stripped from the start of every sentence.
 */
const LEAD_IN =
  /^\s*(?:(?:hey|ok|okay|so|now|then|also|and)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|please\s+|(?:let'?s|lets)\s+|i(?:'d| would)? (?:want|need|like)(?: you)?(?: to)?\s+|we (?:want|need|should)(?: to)?\s+)?(?:go ahead and\s+)?(?:(?:create|make|add|draw|build|design|sketch|show|put|give me|generate|include|set up)\s+)?/i

/** Words about the drawing itself, not elements in it: "a flowchart with …", "a diagram of …". */
const META =
  /^(?:a|an|the|some|my|our)?\s*(?:simple\s+|quick\s+|basic\s+|small\s+|new\s+)?(?:flow ?chart|diagram|architecture(?: diagram)?|system(?: design| diagram)?|wireframe|mock ?-?up|sketch|board|design)s?(?:\s+of)?$/i

/** "connect them (together)": join the elements this person added most recently. */
const CONNECT_RECENT =
  /^(?:connect(?:ed|s)?|link(?:ed)?|hook(?:ed)? up|wire(?:d)?(?: up)?|join(?:ed)?|tie)\s+(?:them|these|those|both|everything|all(?: of them)?|the two|it all)(?:\s+(?:together|up|all))?$/i

/** "connect X and Y" / "link X to Y" → the ordinary relation "X connects to Y". */
const CONNECT_PAIR = /^(?:connect(?:ed|s)?|link(?:ed)?|hook(?:ed)? up|wire(?:d)?(?: up)?|join(?:ed)?)\s+(.+?)\s+(?:to|and|with)\s+(.+)$/i

/** One sentence in canonical form: no lead-in, connect commands rewritten. */
/** "a diagram of …" / "a flowchart showing …" at the start: keep only what it's of. */
const META_PREFIX =
  /^(?:a|an|the)?\s*(?:simple\s+|quick\s+|basic\s+)?(?:flow ?chart|diagram|architecture diagram|system diagram|wireframe|mock ?-?up|sketch)s?\s+(?:of|for|showing|that shows|where|with)\s+/i

export function normalizeSentence(sentence: string): { kind: "text"; text: string } | { kind: "connect-recent" } {
  const t = sentence.replace(LEAD_IN, "").replace(META_PREFIX, "").trim()
  if (CONNECT_RECENT.test(t)) return { kind: "connect-recent" }
  const pair = CONNECT_PAIR.exec(t)
  if (pair) return { kind: "text", text: `${pair[1]} connects to ${pair[2]}` }
  return { kind: "text", text: t }
}

/** Text that alone doesn't make an element, e.g. a half-typed "landing page with a". */
const FILLER = /^(a|an|the|some|and|with|of|to|in|on|for|plus|&|which|that|then|it|also|being|namely|called|named|specifically)?$/i

export function verbKind(joiner: string): EdgeKind | null {
  const j = joiner.trim().replace(/\s+/g, " ")
  if (!j) return null
  for (const [re, kind] of VERB_RES) if (re.test(j)) return kind
  return null
}

export function split(text: string): Piece[] {
  const pieces: Piece[] = []
  for (const raw of text.split(SENTENCE)) {
    const normalized = normalizeSentence(raw)
    if (normalized.kind === "connect-recent") {
      pieces.push({ index: pieces.length, text: "", connector: "connect" })
      continue
    }
    // Peel off "…, being X and Y" before splitting; it names this sentence's elements.
    const alias = ALIAS.exec(normalized.text)
    const sentence = alias ? normalized.text.slice(0, alias.index) : normalized.text
    const aliases = alias ? aliasItems(alias[1]!) : []
    const firstOfSentence = pieces.length
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
      const into = INTO.exec(part.trim())
      // Drop a half-typed joiner at the end ("landing page with" → "landing page").
      const t = (into ? into[1]! : part)
        .trim()
        .replace(/[\s,]*\b(with|and|including|containing|featuring|plus|that|which)$/i, "")
        .replace(/[\s,&]+$/, "")
      if (FILLER.test(t) || META.test(t)) continue

      const index = pieces.length
      // A piece followed by its own verb ("web app -> api -> db") is both the target of the
      // incoming arrow and the source of the next one.
      const startsClause = verbKind(parts[i + 1] ?? "") !== null
      if (connector === "edge" && kind && subject !== null) {
        pieces.push({ index, text: t, connector: "edge", edge: { kind, from: subject } })
        if (startsClause) kind = null
      } else {
        pieces.push({
          index,
          text: t,
          connector: prev === null ? "start" : connector === "edge" ? "and" : connector,
          ...(into ? { into: into[2]!.toLowerCase() } : {}),
        })
        connector = "and"
        kind = null
      }
      prev = index
    }
    // Name this sentence's elements in order.
    aliases.forEach((a, k) => {
      const p = pieces[firstOfSentence + k]
      if (p) pieces[firstOfSentence + k] = { ...p, alias: a }
    })
  }
  return pieces
}
