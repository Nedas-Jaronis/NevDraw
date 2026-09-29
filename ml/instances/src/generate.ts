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
import { type Example, type Link, type Span, type Tag, parseFile, render } from "./markup.ts"

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
const RELATIONS = ["calls", "writes to", "reads from", "publishes to", "subscribes to", "consumes from", "connects to", "connected to", "talks to", "sends to", "sends events to", "uses", "depends on", "forwards to", "goes through", "streams to", "fetches from", "points to", "navigates to", "links to", "hits", "queries", "stores data in", "pushes to", "pulls from", "emails", "notifies"]
const RELATIONS_PL = ["call", "write to", "read from", "publish to", "subscribe to", "consume from", "connect to", "talk to", "send to", "use", "depend on", "go through", "hit", "query"]
const NAMES = ["Pricing", "Checkout", "Login", "Dashboard", "Orders DB", "Acme", "Main", "Primary", "Backup", "Email", "Username", "Mobile", "Home", "Profile", "Billing", "Inbox", "Settings", "Analytics", "Get started", "Sign up", "Welcome back", "postgres", "sql", "main db", "users", "orders", "Reports", "Team", "Search", "Cart"]
const ITEMS = ["milk", "eggs", "bread", "email", "password", "name", "phone", "address", "company", "message", "monday", "tuesday", "friday", "apples", "coffee", "home", "about", "blog", "contact", "pricing", "docs", "username", "city", "zip code"]
const NOTES = ["copy from marketing", "needs the real photo", "check with design", "placeholder for now", "use the brand font", "ask legal", "wire to the api later"]
const CREATE = ["", "", "", "add", "create", "make", "i want", "i need", "can you add", "please add", "give me", "build", "draw", "we need", "let's add", "put", "add me", "sketch", "design", "show"]
/** Real component names from 21st.dev (src/ui21st.ts): the kind is the INSTANCE, its style words are ATTR. */
type Vocab = { kinds: { kind: string; seen: number }[]; styles: string[]; components: { style: string[]; kind: string }[] }
const VOCAB: Vocab = await Bun.file(new URL("../data/ui-vocab.json", import.meta.url)).json()
// "background" is a property of what it's behind ("a hero with a video background"), not a thing on its own.
const KINDS_21 = VOCAB.kinds.map((k) => k.kind).filter((k) => !/\bbackground$/.test(k) && k.split(" ").length <= 4)
const STYLED_21 = VOCAB.components.filter((c) => c.style.length > 0 && !/\bbackground$/.test(c.kind))
const LOOKS = [...VOCAB.styles.filter((w) => !COLORS.includes(w) && !SIZES.includes(w) && !["effect", "cursor", "mouse", "scroll", "loading", "trail"].includes(w)), "sticky", "transparent", "highlighted", "pill shaped", "rounded", "outlined", "frosted", "borderless", "full width", "centered", "muted", "bold", "flat", "elevated"]
const look = () => (chance(0.2) ? `${pick(LOOKS)} ${pick(LOOKS)}` : pick(LOOKS))
const FONTS = ["Inter", "Roboto", "Poppins", "Geist", "Helvetica", "serif", "monospace", "Space Grotesk", "Playfair Display", "Montserrat"]
const PROP_HEADS = ["border", "background", "shadow", "corners", "font", "padding", "spacing", "border radius", "outline", "text color", "gradient", "margin", "opacity", "blur", "glow"]
/** A styled property, as it follows "with": "dashed border", "2px navy border", "purple gradient background". */
function prop(): string {
  const px = () => `${between(1, 4)}px`
  return pick([
    () => `${pick(["dashed", "dotted", "solid", "thick", "thin", "double", "glowing", "animated", "gradient", pick(COLORS)])} border`,
    () => `${px()} ${pick(COLORS)} border`,
    () => `${pick(["rounded", "sharp", "soft", "square"])} corners`,
    () => `${pick(["soft", "drop", "subtle", "large", "hard", "inner", "colored"])} shadow`,
    () => `${pick(COLORS)} ${pick(["gradient", "", ""])} background`.replace(/\s+/g, " "),
    () => `${pick(["video", "image", "animated", "blurred", "dark", "light", "gradient", "particle", "aurora", "grid", "dot pattern", "noise"])} background`,
    () => `${pick(["bold", "serif", "monospace", "large", "handwritten", "condensed"])} font`,
    () => `${pick(["more", "less", "extra", `${between(8, 48)}px`])} ${pick(["padding", "spacing", "margin"])}`,
    () => `border radius of ${between(4, 24)}px`,
    () => `${pick(COLORS)} text`,
    () => `${pick(["glass", "frosted glass", "glassmorphism", "neon", "hover", "shimmer"])} effect`,
  ])()
}
const WITH = ["with", "with", "containing", "that has", "including", "which has", "and inside it", "that contains"]
const PRONOUNS = ["it", "them", "this", "that", "these", "everything", "all of them", "those"]

// ---------- building sentences ----------

/** A span being built. Links point at other span objects and become indices in build(). */
type Sp = { text: string; tag: Tag; arcs: [Link, Sp][] }
type Part = string | Sp
const T = (text: string, tag: Tag): Sp => ({ text, tag, arcs: [] })
const isSp = (p: Part | undefined): p is Sp => typeof p === "object" && p !== null

/** The thing a phrase is about: its INSTANCE (from np) or REF (from ref / pronoun). */
function main(parts: Part[]): Sp {
  const sp = parts.filter(isSp)
  return sp.findLast((s) => s.tag === "INSTANCE") ?? sp.findLast((s) => s.tag === "REF") ?? sp.at(-1)!
}
/** The container a nested phrase starts with: "a hero with a headline" → hero. */
const first = (parts: Part[]): Sp => parts.filter(isSp).find((s) => s.tag === "INSTANCE") ?? main(parts)
/** Every new thing in a list of noun phrases. */
const things = (parts: Part[]) => parts.filter(isSp).filter((s) => s.tag === "INSTANCE")
function link(dep: Sp | Part[], label: Link, head: Sp | Part[]): void {
  const d = Array.isArray(dep) ? main(dep) : dep
  const h = Array.isArray(head) ? main(head) : head
  if (d !== h) d.arcs.push([label, h])
}

function build(parts: Part[]): Example {
  let text = ""
  const spans: Span[] = []
  const index = new Map<Sp, number>()
  for (const p of parts) {
    const s = isSp(p) ? p.text : p
    if (s.length === 0) continue
    const glue = text.length === 0 || /^[,.:;!?)`]/.test(s) || /[(`]$/.test(text) ? "" : " "
    text += glue
    if (isSp(p)) {
      index.set(p, spans.length)
      spans.push({ start: text.length, end: text.length + s.length, tag: p.tag })
    }
    text += s
  }
  for (const [sp, i] of index) {
    const arcs = sp.arcs.flatMap(([label, head]) => (index.has(head) ? [{ label, head: index.get(head)! }] : []))
    if (arcs.length) spans[i]!.arcs = arcs
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
  if (r < 0.75) return pick(KINDS_21)
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
/** Styling only makes sense on interface elements. */
const uiRefOrPronoun = () => (chance(0.2) ? pronoun() : ref(uiNoun()))

/** A new thing: [det | count] [color / size / look] noun [called NAME]; the words around it link to it. */
function np(noun = anyNoun(), opts: { plural?: boolean; allowName?: boolean } = {}): Part[] {
  const parts: Part[] = []
  const mods: Sp[] = []
  const many = (opts.plural ?? chance(0.2)) && !/s$/.test(noun)
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
  if (chance(0.13)) parts.push(T(pick(COLORS), "ATTR"))
  else if (chance(0.07)) parts.push(T(pick(SIZES), "ATTR"))
  else if (chance(0.12)) parts.push(T(look(), "ATTR"))
  mods.push(...parts.filter(isSp))
  const inst = T(head.split(" ").map(typo).join(" "), "INSTANCE")
  parts.push(inst)
  if (opts.allowName !== false && !many && chance(0.07)) {
    const name = T(pick(NAMES), "NAME")
    parts.push(pick(["called", "named", "titled"]), name)
    mods.push(name)
  }
  for (const m of mods) link(m, "mod", inst)
  // The article agrees with the word that follows it.
  const i = parts.indexOf("__ART__")
  const next = parts[i + 1]
  if (i >= 0) parts[i] = next === undefined ? "a" : article(isSp(next) ? next.text : next)
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

// ---------- back-references ----------

/** Architecture groups that get referred to later, sometimes two sharing a head noun ("user databases", "analytics databases"). */
const GROUP_HEADS = ["server", "database", "load balancer", "worker", "cache", "queue", "api", "service", "node", "replica", "bucket", "client", "microservice", "lambda", "gateway"]
const GROUP_MODS = ["user", "analytics", "orders", "billing", "primary", "backup", "read", "write", "legacy", "internal", "public", "auth", "payments", "search", "email"]
/** Words that say "separate ones": part of the name, not a look. */
const SEPARATE = ["independent", "individual", "separate", "dedicated"]
const RESPELL: Record<string, string[]> = { database: ["data base", "db"], databases: ["data bases", "dbs"], "load balancer": ["loadbalancer", "lb"], "load balancers": ["loadbalancers", "lbs"], servers: ["server"], server: ["servers"] }

/** A group as said when made: "5 server stack", "2 load balancers", "3 independent data bases". */
type Group = { parts: Part[]; inst: Sp; head: string; mods: string[]; plural: boolean; stack: boolean }
function group(head: string, mods: string[]): Group {
  const stack = head === "server" && chance(0.25)
  const plural = !stack && chance(0.75)
  let name = [...mods, plural ? plural_(head) : head].join(" ")
  if (stack) name = `${head} ${pick(["stack", "cluster", "pool", "farm"])}`
  for (const [from, to] of Object.entries(RESPELL)) if (chance(0.15) && name.endsWith(from)) name = name.slice(0, -from.length) + pick(to)
  const inst = T(name, "INSTANCE")
  const parts: Part[] = []
  if (plural || stack) {
    const n = T(chance(0.7) ? String(between(2, 9)) : pick(["two", "three", "four", "five", "six"]), "COUNT")
    link(n, "mod", inst)
    parts.push(n)
  } else parts.push(article(name))
  parts.push(inst)
  return { parts, inst, head, mods, plural, stack }
}
const plural_ = (w: string) => plural(w)

/**
 * How a later sentence names a group. The full name always works; a shorter one ("the databases",
 * "the servers" for a server stack, a respelling) only when no other group shares the head noun.
 */
function refTo(g: Group, all: Group[]): string {
  const shared = all.some((o) => o !== g && o.head === g.head)
  const heads = g.stack ? [plural(g.head)] : [plural(g.head), g.head]
  const full = g.inst.text
  if (shared) return pick([full, [...g.mods.filter((m) => !SEPARATE.includes(m)), plural(g.head)].join(" ")].filter((x) => x.split(" ").length > 1 || !shared))
  const r = rand()
  if (r < 0.35) return full
  if (r < 0.75) return pick(heads)
  const h = pick(heads)
  return RESPELL[h] ? pick(RESPELL[h]!) : h
}

// ---------- nesting ----------

const PAGES = ["landing page", "dashboard", "settings page", "pricing page", "home page", "signup page", "app screen", "website", "profile page", "checkout page", "admin panel", "blog page", "portfolio site"]
/** Parts that hold other parts, and what usually goes in them. */
const HOLDERS: Record<string, string[]> = {
  hero: ["headline", "subtitle", "button", "cta button", "image", "video", "email input", "badge", "logo cloud", "3d globe"],
  navbar: ["logo", "link", "nav link", "search bar", "avatar", "signup button", "login button", "dark mode toggle", "dropdown"],
  footer: ["link", "link column", "newsletter signup", "social icon", "copyright text", "logo"],
  sidebar: ["nav link", "avatar", "search bar", "menu", "toggle", "progress bar"],
  "pricing card": ["price", "feature list", "buy button", "badge", "plan name"],
  card: ["image", "title", "description", "button", "avatar", "badge", "rating"],
  "features section": ["feature card", "icon", "headline", "image"],
  "testimonials section": ["testimonial card", "avatar", "quote", "rating"],
  form: ["email input", "password input", "name field", "submit button", "checkbox", "dropdown"],
  modal: ["title", "text", "button", "close button", "form"],
  header: ["logo", "link", "button", "search bar"],
  "stats section": ["stat card", "counter", "chart"],
  "contact section": ["contact form", "map", "email input", "button"],
}
const holderNames = Object.keys(HOLDERS)

/** "a hero with a headline and two buttons": a part plus what's inside it (inner list joined with "and"). */
function holder(name: string, depth: number): Part[] {
  const box = np(name, { plural: false, allowName: false })
  const n = between(1, 3)
  const kids: Part[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) kids.push(i === n - 1 ? "and" : ",")
    const kidName = pick(HOLDERS[name] ?? HOLDERS.card!)
    // Sometimes a part inside holds parts of its own: "a card with a form with an email input".
    const kid = depth < 2 && HOLDERS[kidName] && chance(0.3) ? holder(kidName, depth + 1) : np(kidName, { plural: chance(0.35), allowName: false })
    link(first(kid), "in", box)
    kids.push(...kid)
  }
  return [...box, pick(["with", "with", "containing", "that has", "which has", "including"]), ...kids]
}

// ---------- templates ----------

const templates: (() => Part[])[] = [
  // a landing page with a navbar, a hero and 3 pricing cards
  () => {
    const box = np(uiNoun(), { plural: false })
    const kids = list(uiNoun, between(1, 4))
    for (const k of things(kids)) link(k, "in", box)
    return [...opener(), ...box, pick(WITH), ...kids]
  },
  // plain list of new things
  () => [...opener(), ...list(anyNoun, between(1, 3))],
  // a checklist: milk, eggs and bread
  () => {
    const items = Array.from({ length: between(2, 4) }, () => pick(ITEMS))
    const box = np(pick(["checklist", "list", "dropdown", "navbar", "tabs", "form", "menu", "table"]), { plural: false, allowName: false })
    const parts: Part[] = [...opener(), ...box, ":"]
    items.forEach((it, i) => {
      if (i > 0) parts.push(i === items.length - 1 ? "and" : ",")
      const name = T(it, "NAME")
      link(name, "mod", box)
      parts.push(name)
    })
    return parts
  },
  // a row of 4 buttons
  () => {
    const layout = T(pick(["row", "grid", "column", "row", "grid", "bento grid", "masonry grid", "2 column grid", "stack", "carousel"]), "ATTR")
    const n = chance(0.5) ? [T(String(between(2, 9)), "COUNT")] : []
    const inst = T(plural(pick(PLURAL_OK)), "INSTANCE")
    link(layout, "mod", inst)
    for (const c of n) link(c, "mod", inst)
    return [...opener(), "a", layout, "of", ...n, inst]
  },
  // a stack of 5 servers / a 5 server stack
  () => {
    if (chance(0.5)) {
      const group = T(pick(["stack", "cluster", "pool", "group"]), "INSTANCE")
      const n = T(String(between(2, 9)), "COUNT")
      const kids = T(plural(pick(["server", "worker", "database", "node", "replica", "instance", "cache"])), "INSTANCE")
      link(n, "mod", kids)
      link(kids, "in", group)
      return [...opener(), "a", group, "of", n, kids]
    }
    const n = T(String(between(2, 9)), "COUNT")
    const group = T(`${pick(["server", "worker", "database", "node"])} ${pick(["stack", "cluster", "pool"])}`, "INSTANCE")
    link(n, "mod", group)
    return [...opener(), "a", n, group]
  },
  // add a hero to @landing-page / inside the pricing card
  () => {
    const kid = np(uiNoun(), { plural: chance(0.15) })
    const box = ref(uiNoun())
    link(kid, "in", box)
    return [pick(["add", "put", "embed", "insert", "place", "drop"]), ...kid, pick(["to", "in", "inside", "into", "on"]), ...box]
  },
  // add a footer at the bottom of @landing-page
  () => {
    const kid = np(uiNoun())
    const where = T(pick(POS_END.slice(0, 4)), "ATTR")
    const box = ref(uiNoun())
    link(kid, "in", box)
    link(where, "mod", kid)
    return [pick(["add", "put", ""]), ...kid, where, "of", ...box]
  },
  // a banner above @navbar / a redis cache between {api} and {db}
  () => {
    if (chance(0.7)) {
      const it = np(uiNoun())
      const where = T(pick(POS_REL), "ATTR")
      const other = ref(uiNoun())
      link(where, "mod", it)
      link(other, "dst", where)
      return [...opener(), ...it, where, ...other]
    }
    const it = np(anyNoun())
    const where = T("between", "ATTR")
    const a = ref()
    const b = ref()
    link(where, "mod", it)
    link(a, "dst", where)
    link(b, "dst", where)
    return [...opener(), ...it, where, ...a, "and", ...b]
  },
  // a table of timers with increments of 15
  () => {
    const box = np(pick(["table", "list", "timer", "grid view", "slider"]), { plural: false })
    const kids = chance(0.5) ? [T(plural(pick(["timer", "clock", "reminder", "event"])), "INSTANCE")] : []
    for (const k of kids) link(k, "in", box)
    const seq = T(pick(SEQUENCES), "ATTR")
    link(seq, "mod", kids[0] ?? box)
    return [...opener(), ...box, ...(kids.length ? ["of", ...kids] : []), pick(["with", "in", ""]), seq]
  },
  // api writes to postgres and publishes to a queue
  () => {
    const first = chance(0.25) ? ref(archNoun()) : np(archNoun(), { plural: chance(0.1) })
    const parts: Part[] = [...opener(), ...first]
    let prev = first
    const hops = between(1, 3)
    for (let i = 0; i < hops; i++) {
      let subject = first
      if (i > 0) {
        const join = pick<Part[]>([["and"], ["which"], [",", "then"], ["and then"], [",", "which then"], [".", "__IT__"]])
        // "which" continues from the last target; "and" / "then" / "it" keep the first subject.
        if (join.includes("which") || join.includes(", which then")) subject = prev
        if (join.includes("__IT__")) {
          const it = T("it", "REF")
          link(it, "same", first)
          subject = [it]
          parts.push(".", it)
        } else parts.push(...join)
      }
      const rel = T(pick(RELATIONS), "RELATION")
      const target = chance(0.25) ? ref(archNoun()) : np(archNoun())
      link(subject, "src", rel)
      link(target, "dst", rel)
      parts.push(rel, ...target)
      prev = target
    }
    return parts
  },
  // a web app and a mobile app both call an api gateway
  () => {
    const a = np(archNoun())
    const b = np(archNoun())
    const rel = T(pick(RELATIONS_PL), "RELATION")
    const c = np(archNoun())
    link(a, "src", rel)
    link(b, "src", rel)
    link(c, "dst", rel)
    return [...a, "and", ...b, pick(["both", "", "each"]), rel, ...c]
  },
  // 5 servers connected to 2 load balancers
  () => {
    const n = T(String(between(2, 9)), "COUNT")
    const who = T(plural(pick(["server", "worker", "microservice", "client", "lambda"])), "INSTANCE")
    const rel = T(pick(["connected to", "that connect to", "behind", "talking to", "that go through"]).replace(/^that /, ""), "RELATION")
    const to = np(archNoun(), { plural: chance(0.5) })
    link(n, "mod", who)
    link(who, "src", rel)
    link(to, "dst", rel)
    return [...opener(), n, who, rel, ...to]
  },
  // connect @api to @db / connect the api and postgres
  () => {
    const rel = T(pick(["connect", "link", "wire", "hook up"]), "RELATION")
    const a = ref()
    const b = ref()
    link(a, "src", rel)
    link(b, "dst", rel)
    return [rel, ...a, pick(["to", "and", "with"]), ...b]
  },
  // remove / delete
  () => {
    const act = T(pick(["remove", "delete", "drop", "get rid of", "kill", "erase"]), "ACTION")
    const a = refOrPronoun()
    link(a, "obj", act)
    const parts: Part[] = [act, ...a]
    if (chance(0.3)) {
      const b = ref()
      link(b, "obj", act)
      parts.push("and", ...b)
    }
    return parts
  },
  // move @footer to the top / above @hero / into @section
  () => {
    const act = T(pick(["move", "put", "place", "shift"]), "ACTION")
    const it = refOrPronoun()
    link(it, "obj", act)
    const r = rand()
    if (r < 0.5) {
      const where = T(pick(["the top", "the bottom", "the left", "the right", "the end", "the start"]), "ATTR")
      link(where, "mod", it)
      return [act, ...it, "to", where]
    }
    if (r < 0.75) {
      const where = T(pick(POS_REL), "ATTR")
      const other = ref()
      link(where, "mod", it)
      link(other, "dst", where)
      return [act, ...it, where, ...other]
    }
    const box = ref()
    link(it, "in", box)
    return [act, ...it, pick(["into", "inside"]), ...box]
  },
  // rename / call it NAME
  () => {
    const r = rand()
    const it = refOrPronoun()
    const name = T(pick(NAMES), "NAME")
    link(name, "mod", it)
    const act = T(r < 0.35 ? "rename" : r < 0.65 ? "call" : pick(["change", "set"]), "ACTION")
    link(it, "obj", act)
    if (r < 0.35) return [act, ...it, "to", name]
    if (r < 0.65) return [act, ...it, name]
    return [act, "the", pick(["name", "label", "title"]), "of", ...it, "to", name]
  },
  // make @x red / color everything navy
  () => {
    const r = rand()
    const it = refOrPronoun()
    const value = T(r < 0.4 ? pick([...COLORS, ...SIZES]) : pick(COLORS), "ATTR")
    link(value, "mod", it)
    const act = T(r < 0.4 ? pick(["make", "turn", "paint"]) : r < 0.7 ? pick(["color", "recolor", "colour"]) : "change", "ACTION")
    link(it, "obj", act)
    if (r < 0.7) return [act, ...it, value]
    return [act, ...it, "to", value]
  },
  // change it to a clock / turn this into a list of contacts, 4 of them
  () => {
    const act = T(pick(["change", "turn", "convert", "make"]), "ACTION")
    if (chance(0.7)) {
      const it = chance(0.8) ? refOrPronoun() : []
      if (it.length) link(it, "obj", act)
      const to = np(uiNoun(), { plural: false, allowName: false })
      link(to, "dst", act)
      return [act, ...it, pick(["to", "into"]), ...to]
    }
    const it = pronoun()
    link(it, "obj", act)
    const box = T(pick(["list", "table", "grid view"]), "INSTANCE")
    link(box, "dst", act)
    const kids = T(plural(pick(["contact", "event", "goal", "reminder", "card", "habit"])), "INSTANCE")
    link(kids, "in", box)
    const n = chance(0.6) ? [T(String(between(2, 8)), "COUNT")] : []
    for (const c of n) link(c, "mod", kids)
    return [act, ...it, pick(["to", "into"]), "a", box, "of", kids, ...(n.length ? [",", ...n, "of them"] : [])]
  },
  // disconnect @a from @b / from everything
  () => {
    const act = T(pick(["disconnect", "unlink", "detach"]), "ACTION")
    const a = chance(0.8) ? refOrPronoun() : []
    const join = pick(["from", "and", "from"])
    const b = chance(0.2) ? [T("everything", "REF")] : ref()
    if (a.length) link(a, "obj", act)
    link(b, join === "and" && a.length ? "obj" : "dst", act)
    return [act, ...a, join, ...b]
  },
  // group them into a section
  () => {
    const act = T(pick(["group", "wrap", "put", "combine"]), "ACTION")
    const members = chance(0.5) ? [pronoun()] : [ref(), ref()]
    const box = np(pick(["section", "box", "card", "container", "panel", "group"]), { plural: false, allowName: false })
    link(box, "dst", act)
    for (const m of members) {
      link(m, "obj", act)
      link(m, "in", box)
    }
    const who = members.length === 1 ? members[0]! : [...members[0]!, "and", ...members[1]!]
    return [act, ...who, pick(["into", "in"]), ...box]
  },
  // @contact-form add a phone field / change phone to mobile / remove the message field
  () => {
    const r = rand()
    const who = ref(pick(["contact form", "signup form", "login form", "checkout form", "settings page"]))
    if (r < 0.35) {
      const field = np(`${pick(ITEMS)} ${pick(["field", "input"])}`, { plural: false, allowName: false })
      link(field, "in", who)
      const after: Part[] = []
      if (chance(0.4)) {
        const where = T(pick(["after", "before"]), "ATTR")
        const other = T(pick(ITEMS), "REF")
        link(where, "mod", field)
        link(other, "dst", where)
        after.push(where, other)
      }
      return [...who, "add", ...field, ...after]
    }
    if (r < 0.7) {
      const act = T("change", "ACTION")
      const from = T(pick(ITEMS), "NAME")
      const to = T(pick(ITEMS), "NAME")
      link(from, "obj", act)
      link(from, "mod", who)
      link(to, "dst", act)
      return [...who, act, from, "to", to]
    }
    const act = T(pick(["remove", "delete"]), "ACTION")
    const field = T(`${pick(ITEMS)} ${pick(["field", "input"])}`, "REF")
    link(field, "obj", act)
    link(field, "in", who)
    return [...who, act, "the", field]
  },
  // add a note to @hero saying copy from marketing
  () => {
    const it = ref()
    const note = T(pick(NOTES), "NAME")
    link(note, "mod", it)
    if (chance(0.5)) return ["add a note to", ...it, "saying", note]
    const act = T("annotate", "ACTION")
    link(it, "obj", act)
    return [act, ...it, ":", note]
  },
  // a database called postgres
  () => {
    const it = np(anyNoun(), { plural: false, allowName: false })
    const name = T(pick(NAMES), "NAME")
    link(name, "mod", it)
    return [...opener(), ...it, pick(["called", "named", "titled"]), name]
  },
  // a 21st.dev component, with its own style words: an animated gradient hero section
  () => {
    const c = pick(STYLED_21)
    const style = T(c.style.join(" "), "ATTR")
    const inst = T(c.kind, "INSTANCE")
    link(style, "mod", inst)
    const parts: Part[] = [...opener(), article(c.style[0]!), style, inst]
    if (chance(0.4)) {
      const box = ref(uiNoun())
      link(inst, "in", box)
      parts.push(pick(["in", "inside", "on", "for"]), ...box)
    }
    return parts
  },
  // a card with a dashed border and a soft shadow / a hero with a video background
  () => {
    const it = np(uiNoun(), { allowName: false })
    const p1 = T(prop(), "ATTR")
    link(p1, "mod", it)
    const parts: Part[] = [...opener(), ...it, pick(["with", "with", "that has", "featuring"]), ...(chance(0.6) ? ["a"] : []), p1]
    if (chance(0.35)) {
      const p2 = T(prop(), "ATTR")
      link(p2, "mod", it)
      parts.push(pick(["and", ","]), ...(chance(0.5) ? ["a"] : []), p2)
    }
    if (chance(0.25)) {
      const kids = list(uiNoun, between(1, 2))
      for (const k of things(kids)) link(k, "in", it)
      parts.push(pick(["with", "and"]), ...kids)
    }
    return parts
  },
  // give the hero a gradient background / add a 2px navy border to @card
  () => {
    const it = uiRefOrPronoun()
    const p = T(prop(), "ATTR")
    link(p, "mod", it)
    if (chance(0.5)) {
      const act = T(pick(["give", "set"]), "ACTION")
      link(it, "obj", act)
      return [act, ...it, ...(chance(0.6) ? ["a"] : []), p]
    }
    return [pick(["add", "put", "apply"]), ...(chance(0.6) ? ["a"] : []), p, pick(["to", "on"]), ...it]
  },
  // remove the shadow from @card / make the border of the card thicker / change the font of @hero to Inter
  () => {
    const it = uiRefOrPronoun()
    const head = pick(PROP_HEADS)
    const r = rand()
    const prop_ = T(head, "ATTR")
    link(prop_, "mod", it)
    const act = T(r < 0.35 ? pick(["remove", "delete", "drop", "get rid of"]) : r < 0.65 ? pick(["make", "turn"]) : head === "font" ? "change" : pick(["change", "set"]), "ACTION")
    link(prop_, "obj", act)
    if (r < 0.35) return [act, "the", prop_, "from", ...it]
    if (r < 0.65) {
      const value = T(pick([...COLORS, "thicker", "thinner", "bigger", "smaller", "softer", "darker", "lighter", "rounder", "bolder"]), "ATTR")
      link(value, "mod", prop_)
      return [act, "the", prop_, "of", ...it, value]
    }
    const value = head === "font" ? T(pick(FONTS), "NAME") : T(pick([...COLORS, prop()]), "ATTR")
    link(value, "mod", prop_)
    return [act, "the", prop_, "of", ...it, "to", value]
  },
  // make the navbar sticky / make the buttons pill shaped
  () => {
    const act = T(pick(["make", "turn"]), "ACTION")
    const it = uiRefOrPronoun()
    const value = T(look(), "ATTR")
    link(it, "obj", act)
    link(value, "mod", it)
    return [act, ...it, value]
  },
  // add a header, cta, footer and hero, and put the footer at the top / the footer goes last
  () => {
    const box = chance(0.5) ? np(uiNoun(), { plural: false }) : []
    const kids = list(uiNoun, between(2, 4))
    const made = things(kids)
    if (box.length) for (const k of made) link(k, "in", box)
    const target = pick(made)
    const again = T(target.text, "REF")
    link(again, "same", target)
    const parts: Part[] = [...opener(), ...box, ...(box.length ? [pick(WITH)] : []), ...kids, pick([",", ". then", ", and", ". also"])]
    if (chance(0.3)) {
      const where = T(pick(["last", "first", "at the end", "at the top", "on top", "at the bottom"]), "ATTR")
      link(where, "mod", again)
      return [...parts, "the", again, pick(["goes", "should be", "comes", "is"]), where]
    }
    const act = T(pick(["put", "move", "place"]), "ACTION")
    link(again, "obj", act)
    const other = made.find((m) => m !== target)
    if (other && chance(0.5)) {
      const where = T(pick(["before", "after", "above", "below"]), "ATTR")
      const otherAgain = T(other.text, "REF")
      link(otherAgain, "same", other)
      link(where, "mod", again)
      link(otherAgain, "dst", where)
      return [...parts, act, "the", again, where, "the", otherAgain]
    }
    const where = T(pick(["at the top", "at the bottom", "first", "last", "at the end"]), "ATTR")
    link(where, "mod", again)
    return [...parts, act, "the", again, where]
  },
  // 5 server stack with 2 load balancers and 5 independent databases. the servers connect to the load balancers, and ...
  () => {
    const n = between(2, 3)
    const heads: string[] = []
    while (heads.length < n) {
      const h = pick(GROUP_HEADS)
      if (!heads.includes(h) || chance(0.15)) heads.push(h)
    }
    const groups = heads.map((h, i) => {
      const twin = heads.indexOf(h) !== i || heads.lastIndexOf(h) !== i
      const mods = twin ? [pick(GROUP_MODS)] : chance(0.25) ? [pick(SEPARATE)] : chance(0.15) ? [pick(GROUP_MODS)] : []
      return group(h, mods)
    })
    // Twins must differ by their modifier.
    if (new Set(groups.map((g) => g.inst.text)).size < groups.length) return [...opener(), ...groups[0]!.parts]
    // Architecture "with" lists things side by side: no "in" links.
    const parts: Part[] = [...opener()]
    groups.forEach((g, i) => {
      if (i > 0) parts.push(...(i === 1 ? [pick(["with", "and", ",", "plus", "along with"])] : i === groups.length - 1 ? ["and"] : [","]))
      parts.push(...g.parts)
    })
    if (chance(0.15)) return parts
    parts.push(pick([".", ". then", ", then", ";", "."]))
    const hops = Math.min(groups.length - 1, between(1, 2))
    for (let i = 0; i < hops; i++) {
      const a = groups[i]!
      const b = groups[i + 1]!
      if (i > 0) parts.push(pick([", and", ". and then", ". then", ", then", "."]))
      const rel = T(pick(["connect to", "connects to", "talk to", "send to", "write to", "go through", "call", "point to", "are connected to", "feed into", "route to", "depend on"]), "RELATION")
      const ra = T(refTo(a, groups), "REF")
      const rb = T(refTo(b, groups), "REF")
      link(ra, "same", a.inst)
      link(rb, "same", b.inst)
      link(ra, "src", rel)
      link(rb, "dst", rel)
      parts.push(...(chance(0.85) ? ["the"] : pick([["all"], ["all the"], ["both"], ["each of the"]])), ra, rel, "the", rb)
    }
    return parts
  },
  // a pricing card and a profile card. make the pricing card blue / put the cta inside the hero
  () => {
    const nouns = [uiNoun(), uiNoun()]
    if (nouns[0] === nouns[1]) return np(nouns[0])
    const made = nouns.map((x) => np(x, { plural: false, allowName: false }))
    const parts: Part[] = [...opener(), ...made[0]!, pick(["and", ",", "plus"]), ...made[1]!, pick([".", ", then", ". now", ";"])]
    const target = pick([0, 1])
    const again = T(main(made[target]!).text, "REF")
    link(again, "same", made[target]!)
    if (chance(0.6)) {
      const act = T(pick(["make", "color", "turn", "paint"]), "ACTION")
      const value = T(pick([...COLORS, ...SIZES, look()]), "ATTR")
      link(again, "obj", act)
      link(value, "mod", again)
      return [...parts, act, "the", again, value]
    }
    const other = T(main(made[1 - target]!).text, "REF")
    link(other, "same", made[1 - target]!)
    const act = T(pick(["put", "move", "place"]), "ACTION")
    link(again, "obj", act)
    link(again, "in", other)
    return [...parts, act, "the", again, pick(["inside", "into", "in"]), "the", other]
  },
  // a landing page with a navbar, a hero with a headline and two buttons, and a footer
  () => {
    const page = np(pick(PAGES), { plural: false })
    const n = between(2, 4)
    const parts: Part[] = [...opener(), ...page, pick(WITH)]
    let nestedBefore = false
    for (let i = 0; i < n; i++) {
      const nested: boolean = chance(0.55) || (i === n - 1 && !nestedBefore)
      // After a part with its own list, ", and" / ", plus" / ", then" goes back out to the page.
      if (i > 0) parts.push(...(nestedBefore ? pick([[",", "and"], [",", "plus"], [",", "and", "then"], [",", "as well as"], [",", "and also"]]) : i === n - 1 ? pick([["and"], [",", "and"]]) : [","]))
      const part = nested ? holder(pick(holderNames), 1) : np(pick([...holderNames, uiNoun()]), { allowName: false })
      link(first(part), "in", page)
      parts.push(...part)
      nestedBefore = nested
    }
    return parts
  },
  // 3 pricing cards, each with a price and a buy button
  () => {
    const name = pick(["pricing card", "card", "feature card", "testimonial card", "stat card", "product card", "team member card"])
    const many = T(plural(name), "INSTANCE")
    const count = T(String(between(2, 6)), "COUNT")
    link(count, "mod", many)
    const kids = Array.from({ length: between(1, 3) }, () => np(pick(HOLDERS[name] ?? HOLDERS.card!), { plural: false, allowName: false }))
    const parts: Part[] = []
    kids.forEach((k, i) => {
      if (i > 0) parts.push(i === kids.length - 1 ? "and" : ",")
      link(k, "in", many)
      parts.push(...k)
    })
    const lead: Part[] = chance(0.5) ? [...opener(), count, many] : [...opener(), ...(() => { const page = np(pick(PAGES), { plural: false }); link(many, "in", page); return [...page, pick(WITH)] })(), count, many]
    return [...lead, pick([[",", "each with"], ["that each have"], [",", "each containing"], ["with"]]).flat(), ...parts].flat() as Part[]
  },
  // inside the hero put a headline and a button / the hero should have a video and a cta
  () => {
    const box = ref(pick(holderNames))
    const name = main(box).text.replace(/^[@{]|}$/g, "").replace(/-/g, " ")
    const kids = list(() => pick(HOLDERS[name] ?? HOLDERS.card!), between(1, 3))
    for (const k of things(kids)) link(k, "in", box)
    return chance(0.5) ? [pick(["inside", "in"]), ...box, pick(["put", "add", "place", "i want"]), ...kids] : [...box, pick(["should have", "needs", "gets", "has"]), ...kids]
  },
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
  // Typing in progress: cut at a word boundary. The last span keeps what's left; links to cut spans go.
  if (chance(0.12) && text.includes(" ")) {
    const cuts = [...text.matchAll(/ /g)].map((m) => m.index!)
    const cut = pick(cuts)
    text = text.slice(0, cut)
    const kept = spans.flatMap((s, i) => (s.start < cut ? [i] : []))
    const at = new Map(kept.map((old, i) => [old, i]))
    spans = kept.map((i) => {
      const s = spans[i]!
      const arcs = (s.arcs ?? []).flatMap((a) => (at.has(a.head) ? [{ ...a, head: at.get(a.head)! }] : []))
      return { start: s.start, end: Math.min(s.end, cut), tag: s.tag, ...(arcs.length ? { arcs } : {}) }
    })
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
// JSONL keeps links as [label, head index] pairs, the shape py/common.py reads.
const row = (x: Example) => ({ text: x.text, spans: x.spans.map((s) => ({ start: s.start, end: s.end, tag: s.tag, ...(s.arcs ? { arcs: s.arcs.map((a) => [a.label, a.head]) } : {}) })) })
const jsonl = (xs: Example[]) => xs.map((x) => JSON.stringify(row(x))).join("\n") + "\n"
await Bun.write(new URL("dev.jsonl", dir), jsonl(out.slice(0, devN)))
await Bun.write(new URL("train.jsonl", dir), jsonl(out.slice(devN)))
await Bun.write(new URL("train.sample.txt", dir), out.slice(devN, devN + 300).map(render).join("\n") + "\n")
const byTag: Record<string, number> = {}
const byLink: Record<string, number> = {}
for (const x of out)
  for (const s of x.spans) {
    byTag[s.tag] = (byTag[s.tag] ?? 0) + 1
    for (const a of s.arcs ?? []) byLink[a.label] = (byLink[a.label] ?? 0) + 1
  }
console.log(`wrote ${out.length - devN} train + ${devN} dev examples (${gold.size} gold sentences excluded)`, byTag, byLink)
