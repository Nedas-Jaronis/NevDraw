/**
 * Synthetic training data: seeded, so the same command always writes the same file.
 *
 *   bun src/generate.ts [count=20000] [seed=7]
 *
 * Writes data/train.jsonl and data/dev.jsonl ({text, spans} per line, character
 * offsets) plus data/train.sample.txt (the first 300 in markup, for reading).
 * Any sentence that also appears in data/gold.txt is dropped, so the gold score
 * stays honest.
 */
import { REGISTRY, WIREFRAME_TYPES } from "../../../packages/shared/src/registry.ts"
import { type Example, type Span, type Tag, parseFile, render } from "./markup.ts"

// ---------- randomness ----------

let state = Number(process.argv[3] ?? 7) >>> 0
function rand(): number {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
const chance = (p: number) => rand() < p
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

// ---------- vocabulary ----------

const DOMAIN = ["signup", "login", "pricing", "contact", "checkout", "profile", "settings", "search", "feature", "product", "order", "payment", "newsletter", "blog", "team", "faq", "cart", "admin", "onboarding", "billing", "notification", "about", "home", "account", "support", "booking", "event", "user", "comment", "review"]
const UI_HEADS = [...new Set(WIREFRAME_TYPES.flatMap((t) => [t as string, ...REGISTRY[t].keywords]))].filter((k) => !["copy", "view", "route", "items", "results", "steps", "player", "location", "schedule", "volume", "select", "submit", "block", "group", "wrapper", "area", "title"].includes(k))
/** Modifiers that name a kind of thing, beyond the domain words: "dark mode toggle", "read more button". */
const KIND_WORDS = ["coffee shop", "dark mode", "country", "date", "read more", "delete", "get started", "learn more", "hero", "footer", "header", "body", "main", "side", "top", "user", "photo", "video", "price", "language", "file upload", "credit card", "shipping", "sign in", "log out", "social", "testimonial", "sales", "weather", "music", "recipe", "task", "todo", "chat", "project", "calendar", "invoice"]
/** Numbers inside a name are part of the instance, not a count: "25 minute timer", "2 column layout". */
const NUMBERED = () => pick([`${between(5, 60)} minute timer`, `${between(2, 4)} column layout`, `${between(2, 5)} step wizard`, `${between(2, 4)} column grid`, `${between(10, 90)} second countdown`, `${between(1, 3)} week calendar`])
const COMPOUNDABLE = ["page", "form", "button", "card", "section", "table", "list", "modal", "input", "field", "banner", "chart", "tabs", "dropdown", "toggle", "sidebar", "panel", "grid view", "feed", "tile"]
const ARCH = ["api", "api server", "server", "backend", "database", "db", "postgres", "postgres database", "mysql", "sql database", "mongodb", "redis", "redis cache", "cache", "queue", "kafka queue", "rabbitmq", "message broker", "worker", "email worker", "background job", "cron job", "load balancer", "auth service", "orders service", "payments service", "email service", "user service", "notification service", "inventory service", "s3 bucket", "storage bucket", "blob storage", "cdn", "api gateway", "web app", "mobile app", "frontend", "client", "browser", "data warehouse", "search index", "elasticsearch", "stripe", "sendgrid", "twilio", "openai api", "lambda", "microservice", "webhook", "graphql server"]
const PLURAL_OK = ["server", "database", "worker", "service", "card", "button", "input", "field", "queue", "node", "cache", "page", "section", "chart", "timer", "image", "tile", "tab", "slider", "toggle", "avatar", "stat", "modal", "list", "table", "form", "microservice", "lambda", "load balancer", "bucket", "client", "replica", "instance", "shard", "column", "row", "link", "contact", "event", "goal", "habit", "reminder", "note", "poll", "clock"]
const COUNTS_WORD = ["two", "three", "four", "five", "six", "seven", "eight", "ten", "twelve", "a couple of", "a pair of", "a trio of", "a few"]
const COLORS = ["red", "blue", "navy", "green", "orange", "purple", "teal", "gray", "grey", "black", "white", "pink", "yellow", "dark blue", "light green", "tiffany blue", "sky blue", "crimson", "#e03131", "#1c7ed6", "#2f9e44"]
const SIZES = ["big", "small", "large", "tiny", "wide", "tall", "huge", "compact"]
const POS_END = ["at the top", "at the bottom", "on the left", "on the right", "at the start", "at the end", "first", "last"]
const POS_REL = ["above", "below", "before", "after", "under", "next to"]
const SEQUENCES = ["increments of 15", "increments of 5", "15 minute intervals", "5-minute increments", "steps of 10", "intervals of 30"]
const RELATIONS = ["calls", "writes to", "reads from", "publishes to", "subscribes to", "consumes from", "connects to", "is connected to", "talks to", "sends to", "sends events to", "uses", "depends on", "forwards to", "goes through", "streams to", "fetches from", "points to", "navigates to", "links to", "hits", "queries", "stores data in", "pushes to", "pulls from", "emails the user via", "notifies"]
const RELATIONS_PL = ["call", "write to", "read from", "publish to", "subscribe to", "consume from", "connect to", "talk to", "send to", "use", "depend on", "go through", "hit", "query"]
const NAMES = ["Pricing", "Checkout", "Login", "Dashboard", "Orders DB", "Acme", "Main", "Primary", "Backup", "Email", "Username", "Mobile", "Home", "Profile", "Billing", "Inbox", "Settings", "Analytics", "Get started", "Sign up", "Welcome back", "postgres", "sql", "main db", "users", "orders", "Reports", "Team", "Search", "Cart"]
const ITEMS = ["milk", "eggs", "bread", "email", "password", "name", "phone", "address", "company", "message", "monday", "tuesday", "friday", "apples", "coffee", "home", "about", "blog", "contact", "pricing", "docs", "username", "city", "zip code"]
const NOTES = ["copy from marketing", "needs the real photo", "check with design", "placeholder for now", "use the brand font", "ask legal", "wire to the api later"]
const CREATE = ["", "", "", "add", "create", "make", "i want", "i need", "can you add", "please add", "give me", "build", "draw", "we need", "let's add", "put", "add me", "sketch", "design", "show"]
const WITH = ["with", "with", "containing", "that has", "including", "which has", "and inside it", "that contains"]
const PRONOUNS = ["it", "them", "this", "that", "these", "everything", "all of them", "those"]

// ---------- building sentences ----------

type Part = string | [string, Tag]
const T = (text: string, tag: Tag): Part => [text, tag]

function build(parts: Part[]): Example {
  let text = ""
  const spans: Span[] = []
  for (const p of parts) {
    const [s, tag] = typeof p === "string" ? [p, null] : p
    if (s.length === 0) continue
    const glue = text.length === 0 || /^[,.:;!?)`]/.test(s) || /[(`]$/.test(text) ? "" : " "
    text += glue
    if (tag) spans.push({ start: text.length, end: text.length + s.length, tag })
    text += s
  }
  return { text, spans }
}

function plural(noun: string): string {
  const words = noun.split(" ")
  const last = words.pop()!
  const p = /(s|x|ch|sh)$/.test(last) ? last + "es" : /[^aeiou]y$/.test(last) ? last.slice(0, -1) + "ies" : last + "s"
  return [...words, p].join(" ")
}
const article = (noun: string) => (/^[aeiou]/.test(noun) ? "an" : "a")

function typo(word: string): string {
  if (word.length < 5 || !chance(0.04)) return word
  const i = between(1, word.length - 3)
  return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)
}

function uiNoun(): string {
  const r = rand()
  if (r < 0.3) return `${pick(DOMAIN)} ${pick(COMPOUNDABLE)}`
  if (r < 0.45) return `${pick(KIND_WORDS)} ${pick([...COMPOUNDABLE, ...UI_HEADS.filter((h) => !h.includes(" "))])}`
  if (r < 0.5) return NUMBERED()
  return pick(UI_HEADS)
}
const archNoun = () => pick(ARCH)
const anyNoun = () => (chance(0.6) ? uiNoun() : archNoun())

function handle(noun = anyNoun()): string {
  const base = noun.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return "@" + base + (chance(0.25) ? `-${between(1, 4)}` : "")
}

/** Something already on the board. The article stays outside the span. */
function ref(noun = anyNoun()): Part[] {
  const r = rand()
  if (r < 0.4) return [T(handle(noun), "REF")]
  if (r < 0.55) return [T(`{${noun}}`, "REF")]
  if (r < 0.85) return ["the", T(typo(noun), "REF")]
  if (r < 0.93) return [T(`${noun} ${between(1, 5)}`, "REF")]
  return [T(noun, "REF")]
}
const pronoun = (): Part[] => [T(pick(PRONOUNS), "REF")]
const refOrPronoun = () => (chance(0.2) ? pronoun() : ref())

/** A new thing: [det | count] [color / size] noun [called NAME]. */
function np(noun = anyNoun(), opts: { plural?: boolean; allowName?: boolean } = {}): Part[] {
  const parts: Part[] = []
  const many = opts.plural ?? chance(0.2)
  let head = noun
  if (many) {
    head = plural(noun)
    const r = rand()
    if (r < 0.55) parts.push(T(String(between(2, 12)), "COUNT"))
    else if (r < 0.85) {
      const w = pick(COUNTS_WORD)
      const m = /^(a (?:couple|pair|trio) of|a few)$/.exec(w)
      if (m) parts.push("a", T(w.replace(/^a /, "").replace(/ of$/, ""), "COUNT"), w.endsWith(" of") ? "of" : "")
      else parts.push(T(w, "COUNT"))
    }
  } else if (chance(0.72)) parts.push(chance(0.1) ? "one" : "__ART__")
  if (chance(0.15)) parts.push(T(pick(COLORS), "ATTR"))
  else if (chance(0.07)) parts.push(T(pick(SIZES), "ATTR"))
  parts.push(T(head.split(" ").map(typo).join(" "), "INSTANCE"))
  if (opts.allowName !== false && !many && chance(0.07)) parts.push(pick(["called", "named", "titled"]), T(pick(NAMES), "NAME"))
  // The article agrees with the word that follows it.
  const i = parts.indexOf("__ART__")
  const next = parts[i + 1]
  if (i >= 0) parts[i] = next === undefined ? "a" : article(typeof next === "string" ? next : next[0])
  return parts
}

function list(nouns: () => string, n: number): Part[] {
  const out: Part[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) out.push(...(i < n - 1 ? [","] : pick([["and"], [",", "and"], ["plus"], ["&"], [","]])))
    out.push(...np(nouns()))
  }
  return out
}

function opener(): Part[] {
  const o = pick(CREATE)
  return o ? [o] : []
}

// ---------- templates ----------

const templates: (() => Part[])[] = [
  // a landing page with a navbar, a hero and 3 pricing cards
  () => [...opener(), ...np(uiNoun(), { plural: false }), pick(WITH), ...list(uiNoun, between(1, 4))],
  // plain list of new things
  () => [...opener(), ...list(anyNoun, between(1, 3))],
  // a checklist: milk, eggs and bread
  () => {
    const items = Array.from({ length: between(2, 4) }, () => pick(ITEMS))
    const parts: Part[] = [...opener(), ...np(pick(["checklist", "list", "dropdown", "navbar", "tabs", "form", "menu", "table"]), { plural: false, allowName: false }), ":"]
    items.forEach((it, i) => {
      if (i > 0) parts.push(i === items.length - 1 ? "and" : ",")
      parts.push(T(it, "NAME"))
    })
    return parts
  },
  // a row of 4 buttons
  () => [...opener(), "a", T(pick(["row", "grid", "column"]), "ATTR"), "of", ...(chance(0.5) ? [T(String(between(2, 9)), "COUNT")] : []), T(plural(pick(PLURAL_OK)), "INSTANCE")],
  // a stack of 5 servers / a 5 server stack
  () =>
    chance(0.5)
      ? [...opener(), "a", T(pick(["stack", "cluster", "pool", "group"]), "INSTANCE"), "of", T(String(between(2, 9)), "COUNT"), T(plural(pick(["server", "worker", "database", "node", "replica", "instance", "cache"])), "INSTANCE")]
      : [...opener(), "a", T(String(between(2, 9)), "COUNT"), T(`${pick(["server", "worker", "database", "node"])} ${pick(["stack", "cluster", "pool"])}`, "INSTANCE")],
  // add a hero to @landing-page / inside the pricing card
  () => [pick(["add", "put", "embed", "insert", "place", "drop"]), ...np(uiNoun(), { plural: chance(0.15) }), pick(["to", "in", "inside", "into", "on"]), ...ref(uiNoun())],
  // add a footer at the bottom of @landing-page
  () => [pick(["add", "put", ""]), ...np(uiNoun()), T(pick(POS_END.slice(0, 4)), "ATTR"), "of", ...ref(uiNoun())],
  // a banner above @navbar / a redis cache between {api} and {db}
  () =>
    chance(0.7)
      ? [...opener(), ...np(uiNoun()), T(pick(POS_REL), "ATTR"), ...ref(uiNoun())]
      : [...opener(), ...np(anyNoun()), T("between", "ATTR"), ...ref(), "and", ...ref()],
  // a table of timers with increments of 15
  () => [...opener(), ...np(pick(["table", "list", "timer", "grid view", "slider"]), { plural: false }), ...(chance(0.5) ? ["of", T(plural(pick(["timer", "clock", "reminder", "event"])), "INSTANCE")] : []), pick(["with", "in", ""]), T(pick(SEQUENCES), "ATTR")],
  // api writes to postgres and publishes to a queue
  () => {
    const parts: Part[] = [...opener(), ...(chance(0.25) ? ref(archNoun()) : np(archNoun(), { plural: chance(0.1) }))]
    const hops = between(1, 3)
    for (let i = 0; i < hops; i++) {
      if (i > 0) parts.push(...pick<Part[]>([["and"], ["which"], [",", "then"], ["and then"], [",", "which then"], [".", T("it", "REF")]]))
      parts.push(T(pick(RELATIONS), "RELATION"))
      parts.push(...(chance(0.25) ? ref(archNoun()) : np(archNoun())))
    }
    return parts
  },
  // a web app and a mobile app both call an api gateway
  () => [...np(archNoun()), "and", ...np(archNoun()), pick(["both", "", "each"]), T(pick(RELATIONS_PL), "RELATION"), ...np(archNoun())],
  // 5 servers connected to 2 load balancers
  () => [...opener(), T(String(between(2, 9)), "COUNT"), T(plural(pick(["server", "worker", "microservice", "client", "lambda"])), "INSTANCE"), T(pick(["connected to", "that connect to", "behind", "talking to", "that go through"]).replace(/^that /, ""), "RELATION"), ...np(archNoun(), { plural: chance(0.5) })],
  // connect @api to @db / connect the api and postgres
  () => [T(pick(["connect", "link", "wire", "hook up"]), "RELATION"), ...ref(), pick(["to", "and", "with"]), ...ref()],
  // remove / delete
  () => {
    const parts: Part[] = [T(pick(["remove", "delete", "drop", "get rid of", "kill", "erase"]), "ACTION"), ...refOrPronoun()]
    if (chance(0.3)) parts.push("and", ...ref())
    return parts
  },
  // move @footer to the top / above @hero
  () => [T(pick(["move", "put", "place", "shift"]), "ACTION"), ...refOrPronoun(), ...(chance(0.5) ? ["to", T(pick(["the top", "the bottom", "the left", "the right", "the end", "the start"]), "ATTR")] : chance(0.5) ? [T(pick(POS_REL), "ATTR"), ...ref()] : [pick(["into", "inside"]), ...ref()])],
  // rename / call it NAME
  () => {
    const r = rand()
    if (r < 0.35) return [T("rename", "ACTION"), ...refOrPronoun(), "to", T(pick(NAMES), "NAME")]
    if (r < 0.65) return [T("call", "ACTION"), ...refOrPronoun(), T(pick(NAMES), "NAME")]
    return [T(pick(["change", "set"]), "ACTION"), "the", pick(["name", "label", "title"]), "of", ...refOrPronoun(), "to", T(pick(NAMES), "NAME")]
  },
  // make @x red / color everything navy
  () => {
    const r = rand()
    if (r < 0.4) return [T(pick(["make", "turn", "paint"]), "ACTION"), ...refOrPronoun(), T(pick([...COLORS, ...SIZES]), "ATTR")]
    if (r < 0.7) return [T(pick(["color", "recolor", "colour"]), "ACTION"), ...refOrPronoun(), T(pick(COLORS), "ATTR")]
    return [T("change", "ACTION"), ...refOrPronoun(), "to", T(pick(COLORS), "ATTR")]
  },
  // change it to a clock / turn this into a list of contacts, 4 of them
  () =>
    chance(0.7)
      ? [T(pick(["change", "turn", "convert", "make"]), "ACTION"), ...(chance(0.8) ? refOrPronoun() : []), pick(["to", "into"]), ...np(uiNoun(), { plural: false, allowName: false })]
      : [T(pick(["change", "turn"]), "ACTION"), ...pronoun(), pick(["to", "into"]), "a", T(pick(["list", "table", "grid view"]), "INSTANCE"), "of", T(plural(pick(["contact", "event", "goal", "reminder", "card", "habit"])), "INSTANCE"), ...(chance(0.6) ? [",", T(String(between(2, 8)), "COUNT"), "of them"] : [])],
  // disconnect @a from @b / from everything
  () => [T(pick(["disconnect", "unlink", "detach"]), "ACTION"), ...(chance(0.8) ? refOrPronoun() : []), pick(["from", "and", "from"]), ...(chance(0.2) ? [T("everything", "REF")] : ref())],
  // group them into a section
  () => [T(pick(["group", "wrap", "put", "combine"]), "ACTION"), ...(chance(0.5) ? pronoun() : [...ref(), "and", ...ref()]), pick(["into", "in"]), ...np(pick(["section", "box", "card", "container", "panel", "group"]), { plural: false, allowName: false })],
  // @contact-form add a phone field / change phone to mobile / remove the message field
  () => {
    const r = rand()
    const who = ref(pick(["contact form", "signup form", "login form", "checkout form", "settings page"]))
    if (r < 0.35) return [...who, "add", ...np(`${pick(ITEMS)} ${pick(["field", "input"])}`, { plural: false, allowName: false }), ...(chance(0.4) ? [T(pick(["after", "before"]), "ATTR"), T(pick(ITEMS), "REF")] : [])]
    if (r < 0.7) return [...who, T("change", "ACTION"), T(pick(ITEMS), "NAME"), "to", T(pick(ITEMS), "NAME")]
    return [...who, T(pick(["remove", "delete"]), "ACTION"), "the", T(`${pick(ITEMS)} ${pick(["field", "input"])}`, "REF")]
  },
  // add a note to @hero saying copy from marketing
  () => (chance(0.5) ? ["add a note to", ...ref(), "saying", T(pick(NOTES), "NAME")] : [T("annotate", "ACTION"), ...ref(), ":", T(pick(NOTES), "NAME")]),
  // a database called postgres
  () => [...opener(), ...np(anyNoun(), { plural: false, allowName: false }), pick(["called", "named", "titled"]), T(pick(NAMES), "NAME")],
  // noise: nothing to tag
  () => [pick(["big brand moment", "hmm", "ok so", "let me think", "not sure yet", "something like this", "wait", "undo that", "looks good", "nice", "hello", "and then", "with the", "maybe later"])],
]

// ---------- sentence-level variety ----------

function sentence(): Part[] {
  const first = pick(templates)()
  if (!chance(0.18)) return first
  const second = pick(templates)()
  return [...first, pick([".", ", then", "and", ";", ". also", ". then"]), ...second]
}

function finish(ex: Example): Example {
  let { text, spans } = ex
  // Typing in progress: cut at a word boundary. The last span keeps what's left.
  if (chance(0.12) && text.includes(" ")) {
    const cuts = [...text.matchAll(/ /g)].map((m) => m.index!)
    const cut = pick(cuts)
    text = text.slice(0, cut)
    spans = spans.filter((s) => s.start < cut).map((s) => ({ ...s, end: Math.min(s.end, cut) }))
  }
  if (chance(0.15)) text = text[0]!.toUpperCase() + text.slice(1)
  if (chance(0.08) && !/[.!?]$/.test(text)) text += pick([".", "!", "?"])
  if (chance(0.05)) {
    const pre = pick(["please ", "can you ", "hey, ", "ok ", "now "])
    text = pre + text
    spans = spans.map((s) => ({ ...s, start: s.start + pre.length, end: s.end + pre.length }))
  }
  return { text, spans }
}

// ---------- main ----------

const count = Number(process.argv[2] ?? 20000)
const dir = new URL("../data/", import.meta.url)
const gold = new Set(parseFile(await Bun.file(new URL("gold.txt", dir)).text()).map((e) => e.text.toLowerCase().replace(/[.!?]$/, "")))
const seen = new Set<string>()
const out: Example[] = []
let tries = 0
while (out.length < count && tries++ < count * 20) {
  const ex = finish(build(sentence()))
  const key = ex.text.toLowerCase().replace(/[.!?]$/, "")
  if (key.length === 0 || gold.has(key) || seen.has(key)) continue
  seen.add(key)
  out.push(ex)
}

const devN = Math.round(out.length * 0.05)
const jsonl = (xs: Example[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n"
await Bun.write(new URL("dev.jsonl", dir), jsonl(out.slice(0, devN)))
await Bun.write(new URL("train.jsonl", dir), jsonl(out.slice(devN)))
await Bun.write(new URL("train.sample.txt", dir), out.slice(devN, devN + 300).map(render).join("\n") + "\n")
const byTag: Record<string, number> = {}
for (const x of out) for (const s of x.spans) byTag[s.tag] = (byTag[s.tag] ?? 0) + 1
console.log(`wrote ${out.length - devN} train + ${devN} dev examples (${gold.size} gold sentences excluded)`, byTag)
