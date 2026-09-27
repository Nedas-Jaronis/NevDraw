import type { EdgeKind } from "@rtw/shared"
import { colonList } from "./modifiers.ts"

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
  /** "it should include @a @b": moves into the entry's container (see `include`). */
  | "include"

export type Piece = {
  index: number
  text: string
  connector: Connector
  /** For "edge" pieces: the arrow's kind and the index of its source piece. */
  edge?: { kind: EdgeKind; from: number; label?: string }
  /** "add a form to @landing-page": the @handle this piece goes inside. */
  into?: string
  /** "a server and a database, being server and sql": what this element is called (here "sql"). */
  alias?: string
  /** The alias came from "called / named / titled": it's the element's name, used as-is. */
  aliasIsName?: boolean
  /** "a checklist: milk, eggs and bread": the element's items. */
  items?: string[]
  /** "between @a and @b", "above @x", "at the bottom of @x": where it goes among its siblings. */
  place?: { after?: string; before?: string; parent?: string; end?: "top" | "bottom" }
  /** "wrap @a and @b into one box": this piece is the new container; these move into it ("recent" = what "them" means). */
  wrap?: string[] | "recent"
  /** "it should include @a @b": move these into the container this entry just made. */
  include?: string[]
}

/**
 * A clarifying clause that names the elements just listed, in order:
 * "…, being server and sql", "namely …", "i.e. …", "called …", "named …".
 */
const ALIAS = /(?:\s*,\s*|\s+)(being|namely|specifically|i\.?e\.?,?|those being|these being|called|named|titled)\s+(.+)$/i
const NAMING = /^(called|named|titled)$/i

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
  ["calls|calling|requests|sends? (?:requests? |data )?to|sending to|posts? to|hits|talks? to|talking to|connects? to|connecting to|connected to|(?:is |are )?(?:linked|attached|hooked up|wired|routed) to|uses|using|depends on|->|→|=>", "calls"],
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
const CONVERSATION =
  /^\s*(?:(?:hey|ok|okay|so|now|then|also|and)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|please\s+|(?:let'?s|lets)\s+|i(?:'d| would)? (?:want|need|like)(?: you)?(?: to)?\s+|we (?:want|need|should)(?: to)?\s+)?(?:go ahead and\s+)?/i
const CREATE_VERB = /^(?:(?:create|make|add|draw|build|design|sketch|show|put|give me|generate|include|set up|embed|insert|attach|upload|place|drop)\s+)/i

/** "make @x red", "set @x to blue": the verb is part of an edit, so it stays. */
const EDIT_START = /^(?:make|turn|change|set|colou?r|paint|recolou?r|rename|call|label|title|update|switch|convert)\b.*@[a-z0-9]/i

const HANDLES = /@[a-z0-9][a-z0-9-]*/gi
const handlesIn = (s: string) => [...s.matchAll(HANDLES)].map((m) => m[0].toLowerCase())
const THEM = /\b(them|these|those|all of them|everything|both|it all|the (?:ones|elements|modals|boxes|sections) (?:above|i made|i suggested))\b/i

/** "wrap/group/put @a, @b and @c into one box", "group them into a section called Hero". */
const WRAP =
  /^(?:wrap|group|put|combine|nest|move|place|bundle|merge|organi[sz]e)\s+(.+?)\s+(?:all\s+)?(?:together\s+)?(?:into|in|inside|within|under)\s+(.+)$/i
const WRAP_BARE = /^(?:wrap|group|bundle|combine)\s+(.+?)(?:\s+together)?$/i
/** "it should include @a @b", "the box contains @a and @b". */
const INCLUDE =
  /^(?:it|this|that|the (?:box|wrapper|container|section|group|page|card|modal))\s+(?:should|will|must|can|needs to|is going to)?\s*(?:include|contain|hold|wrap|have|group)s?\s+(.+)$/i

/** Words about the drawing itself, not elements in it: "a flowchart with …", "a diagram of …". */
const META =
  /^(?:a|an|the|some|my|our)?\s*(?:simple\s+|quick\s+|basic\s+|small\s+|new\s+)?(?:flow ?chart|diagram|architecture(?: diagram)?|system(?: design| diagram)?|wireframe|mock ?-?up|sketch|board|design)s?(?:\s+of)?$/i

/** "connect them (together)": join the elements this person added most recently. */
const CONNECT_RECENT =
  /^(?:connect(?:ed|s)?|link(?:ed)?|hook(?:ed)? up|wire(?:d)?(?: up)?|join(?:ed)?|tie)\s+(?:them|these|those|both|everything|all(?: of them)?|the two|it all)(?:\s+(?:together|up|all))?$/i

/** "connect X and Y (together)" / "link X to Y" → the ordinary relation "X connects to Y". */
const CONNECT_PAIR =
  /^(?:(?:re-?)?connect(?:ed|s)?|(?:re-?)?link(?:ed)?|hook(?:ed)? up|(?:re-?)?wire(?:d)?(?: up)?|(?:re-?)?join(?:ed)?)\s+(.+?)\s+(?:to|and|with)\s+(.+?)(?:\s+(?:together|up|again|back up|back))?$/i

/** "X and Y (are) linked together" → "X connects to Y". */
const PAIR_LINKED =
  /^(.+?)\s+(?:and|&|with|to)\s+(.+?)\s+(?:are\s+|is\s+|should be\s+|get\s+)?(?:linked|connected|hooked up|wired(?: up)?|joined)(?:\s+(?:together|up))?$/i

/** One sentence in canonical form: no lead-in, connect commands rewritten. */
/** "a diagram of …" / "a flowchart showing …" at the start: keep only what it's of. */
const META_PREFIX =
  /^(?:a|an|the)?\s*(?:simple\s+|quick\s+|basic\s+)?(?:flow ?chart|diagram|architecture diagram|system diagram|wireframe|mock ?-?up|sketch)s?\s+(?:of|for|showing|that shows|where|with)\s+/i

export type Sentence =
  | { kind: "text"; text: string }
  | { kind: "connect-recent" }
  | { kind: "wrap"; container: string; targets: string[] | "recent" }
  | { kind: "include"; targets: string[] }

export function normalizeSentence(sentence: string): Sentence {
  const talk = sentence.replace(CONVERSATION, "").trim()
  // Structural commands first: they use verbs ("put", "include") that creation would strip.
  const wrap = WRAP.exec(talk) ?? WRAP_BARE.exec(talk)
  if (wrap) {
    const handles = handlesIn(wrap[1]!)
    const targets = handles.length ? handles : THEM.test(wrap[1]!) ? "recent" : null
    if (targets) return { kind: "wrap", container: wrap[2] ?? "a group", targets }
  }
  const include = INCLUDE.exec(talk)
  if (include && handlesIn(include[1]!).length) return { kind: "include", targets: handlesIn(include[1]!) }
  const first = HANDLE_FIRST.exec(talk)
  if (first) return { kind: "text", text: `${first[2]!.replace(CREATE_VERB, "")} in ${first[1]}` }
  const t = (EDIT_START.test(talk) ? talk : talk.replace(CREATE_VERB, "")).replace(META_PREFIX, "").trim()
  if (CONNECT_RECENT.test(t)) return { kind: "connect-recent" }
  const pair = CONNECT_PAIR.exec(t) ?? PAIR_LINKED.exec(t)
  if (pair) return { kind: "text", text: `${pair[1]} connects to ${pair[2]}` }
  return { kind: "text", text: t }
}

/** "@landing-page: add a hero", "@page create a hero …" → "a hero … in @landing-page". */
const HANDLE_FIRST = /^(@[a-z0-9][a-z0-9-]*)\s*[:,-]?\s*(?:please\s+)?(?:create|add|make|put|insert|include|place|draw|give it|needs?)\s+(.+)$/i

/** A position phrase at the end of a piece. */
const PLACE =
  /\s+(?:(between)\s+(@[a-z0-9][a-z0-9-]*)\s+(?:and|~and~)\s+(@[a-z0-9][a-z0-9-]*)|(above|before|over|on top of)\s+(@[a-z0-9][a-z0-9-]*)|(below|after|under|beneath|underneath)\s+(@[a-z0-9][a-z0-9-]*)|at the (top|bottom|end|start)(?:\s+of\s+(@[a-z0-9][a-z0-9-]*))?)\s*$/i

export function placeOf(text: string): { rest: string; place: NonNullable<Piece["place"]> } | null {
  const m = PLACE.exec(text)
  if (!m) return null
  const rest = text.slice(0, m.index).trim()
  const lc = (s: string | undefined) => s?.toLowerCase()
  if (m[1]) return { rest, place: { after: lc(m[2])!, before: lc(m[3])! } }
  if (m[4]) return { rest, place: { before: lc(m[5])! } }
  if (m[6]) return { rest, place: { after: lc(m[7])! } }
  const end = /^(top|start)$/i.test(m[8]!) ? "top" : "bottom"
  return { rest, place: { end, ...(m[9] ? { parent: lc(m[9])! } : {}) } }
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
    if (normalized.kind === "wrap") {
      // The container is a new element; the targets move into it. "a page called Home" names it.
      const named = ALIAS.exec(normalized.container)
      const text = (named ? normalized.container.slice(0, named.index) : normalized.container).trim()
      pieces.push({
        index: pieces.length,
        text,
        connector: "start",
        wrap: normalized.targets,
        ...(named ? { alias: aliasItems(named[2]!)[0] ?? "", aliasIsName: NAMING.test(named[1]!) } : {}),
      })
      continue
    }
    if (normalized.kind === "include") {
      pieces.push({ index: pieces.length, text: "", connector: "include", include: normalized.targets })
      continue
    }
    // Peel off "…, being X and Y" before splitting; it names this sentence's elements.
    // "a checklist: milk, eggs and bread": the list belongs to the element before the colon.
    const colon = colonList(normalized.text)
    const base = colon ? colon.head : normalized.text
    const alias = ALIAS.exec(base)
    const sentence = alias ? base.slice(0, alias.index) : base
    const aliases = alias ? aliasItems(alias[2]!) : []
    const aliasIsName = alias ? NAMING.test(alias[1]!) : false
    const firstOfSentence = pieces.length
    // "between @a and @b" is one position, not a list: keep its "and" away from the joiner.
    const parts = sentence.replace(/\bbetween\s+(@[a-z0-9][a-z0-9-]*)\s+and\s+(@[a-z0-9][a-z0-9-]*)/gi, "between $1 ~and~ $2").split(JOINER)
    let connector: Connector = "start"
    /** The current arrow kind while listing targets ("writes to B and C"). */
    let kind: EdgeKind | null = null
    /** "connects to" reads better as "connects" than as the generic "calls". */
    let verbLabel: string | undefined
    /** Source of the current arrows: the subject that "and <verb> …" continues from. */
    let subject: number | null = null
    let prev: number | null = null

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      if (i % 2 === 1) {
        const k = verbKind(part)
        if (k) {
          // "connected to" reads as "connects".
          // "A writes to …": the arrow starts at the previous piece, unless we're
          // continuing a list of relations ("… and publishes to …"), which start at the subject.
          if (connector !== "edge" || kind === null) subject = prev
          kind = k
          verbLabel = /^\s*(?:(?:is|are)\s+)?(?:connect|link|attach|hook|wire)/i.test(part) ? "connects" : undefined
          connector = "edge"
        } else if (connector !== "edge") {
          connector = prev === null ? "start" : CHILD_JOINER.test(part) ? "with" : "and"
        }
        continue
      }
      // "… in @page" and "… between @a and @b" / "at the bottom of @x", in either order.
      const whole = part.trim()
      const outer = INTO.exec(whole)
      const placed = placeOf(outer ? outer[1]! : whole)
      const body = placed ? placed.rest : outer ? outer[1]! : whole
      const into = outer ?? INTO.exec(body)
      // Drop a half-typed joiner at the end ("landing page with" → "landing page").
      const t = (into && !outer ? into[1]! : body)
        .trim()
        .replace(/[\s,]+(?:which|that|who)(?:\s+(?:is|are|will be|gets|get))?(?:\s+(?:then|also|in turn))?$/i, "")
        .replace(/[\s,]+(?:and\s+)?then$/i, "")
        .replace(/[\s,]*\b(with|and|including|containing|featuring|plus|that|which)$/i, "")
        .replace(/[\s,&]+$/, "")
      if (FILLER.test(t) || META.test(t)) continue

      const index = pieces.length
      // A piece followed by its own verb ("web app -> api -> db") is both the target of the
      // incoming arrow and the source of the next one.
      const startsClause = verbKind(parts[i + 1] ?? "") !== null
      if (connector === "edge" && kind && subject !== null) {
        pieces.push({ index, text: t, connector: "edge", edge: { kind, from: subject, ...(verbLabel ? { label: verbLabel } : {}) } })
        if (startsClause) kind = null
      } else {
        pieces.push({
          index,
          text: t,
          connector: prev === null ? "start" : connector === "edge" ? "and" : connector,
          ...(into ? { into: into[2]!.toLowerCase() } : {}),
          ...(placed ? { place: placed.place } : {}),
        })
        connector = "and"
        kind = null
      }
      prev = index
    }
    if (colon && pieces.length > firstOfSentence) {
      const last = pieces.length - 1
      pieces[last] = { ...pieces[last]!, items: colon.items }
    }
    // Name this sentence's elements in order.
    aliases.forEach((a, k) => {
      const p = pieces[firstOfSentence + k]
      if (p) pieces[firstOfSentence + k] = { ...p, alias: a, ...(aliasIsName ? { aliasIsName } : {}) }
    })
  }
  return pieces
}
