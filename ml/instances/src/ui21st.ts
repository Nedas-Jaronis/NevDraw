/**
 * UI vocabulary from 21st.dev: the names people give real components, split into
 * the kind of thing ("pricing card", "image comparison slider") and the style
 * words around it ("animated", "glassmorphism", "neon").
 *
 *   bun src/ui21st.ts                  # fetches https://21st.dev/sitemap.xml
 *   bun src/ui21st.ts path/to/sitemap.xml
 *
 * Writes data/ui-vocab.json, which generate.ts reads, so training data doesn't
 * depend on the site being up. Each kind is mapped to a registry type when a
 * registry keyword matches; `unmapped` lists the kinds the registry has no type
 * for yet (candidates for new components).
 */
import { NODE_TYPES, REGISTRY } from "../../../packages/shared/src/registry.ts"

/** Library, framework and author prefixes: not part of what the component is. */
const LIBS = new Set(["v", "c", "ui", "shadcn", "heroui", "reshaped", "8bit", "uiable", "be", "base", "react", "aria", "framer", "gsap", "tailwind", "embla", "recharts", "three", "js", "webgl", "glsl", "svg", "css", "hook", "native", "component", "components", "demo", "custom", "new", "simple", "basic", "default", "my", "the", "a", "an", "of", "x", "pro", "kit", "shadcnui", "radix", "mui", "chakra", "magic", "aceternity", "origin", "kokonut", "cult", "shad", "nextjs", "next", "vue", "lucide", "tsf", "ruixen", "reui", "coss", "uploadthing", "kibo", "eldora", "hextaui", "watermelon", "animata", "shsf", "sera", "optics", "tremor", "uiverse", "motion", "primitives", "variant", "example", "preview", "copy", "style", "styled", "version", "final", "updated", "improved", "fixed", "responsive"])

/** Look and behaviour, not kind: tagged ATTR next to the instance. */
const STYLE = new Set([
  "animated", "animation", "animations", "interactive", "hover", "hovered", "gradient", "glow", "glowing", "dark", "light", "retro", "pixel", "pixelated", "ascii", "glass", "glassmorphism", "liquid", "neon", "futuristic", "colorful", "modern", "minimal", "minimalist", "aesthetic", "blur", "blurred", "blurry", "parallax", "neobrutalism", "brutalist", "cyberpunk", "skeuomorphism", "skeuomorphic", "neumorphism", "neumorphic", "holographic", "cinematic", "cartoon", "grainy", "grain", "halftone", "geometric", "floating", "magnetic", "morphing", "morph", "rotating", "spinning", "glitch", "typewriter", "scramble", "aurora", "wavy", "sparkle", "sparkles", "gooey", "tilted", "tilt", "3d", "2d", "elegant", "clean", "fancy", "sleek", "playful", "fun", "creative", "premium", "vintage", "flip", "flipping", "sliding", "fading", "fade", "reveal", "scroll", "scrolling", "sticky", "expandable", "collapsible", "draggable", "sortable", "resizable", "infinite", "rounded", "outline", "outlined", "dashed", "dotted", "shiny", "shimmer", "shimmering", "pulse", "pulsing", "bouncy", "bounce", "spring", "smooth", "stagger", "staggered", "ripple", "magic", "electric", "radial", "circular", "vertical", "horizontal", "mini", "compact", "large", "big", "small", "tiny", "giant", "split", "centered", "fullscreen", "full", "wide", "bold", "stacked", "layered", "orbiting", "orbital", "spotlight", "beam", "noise", "dither", "dithered", "matrix", "sci", "fi", "hud", "8", "bit", "effect", "effects", "micro", "trail", "shadow", "gradient", "pattern", "texture", "multicolor", "rainbow", "monochrome", "black", "white", "blue", "red", "green", "purple", "pink", "orange", "yellow", "gold", "golden", "silver", "cosmic", "galaxy", "space", "cyber", "digital", "organic", "fluid", "wave", "waves", "particle", "particles", "flicker", "flickering", "zoom", "zooming", "moving", "marquee", "ticker", "rotating", "cycling", "blinking", "follow", "following", "magnet", "motion", "kinetic", "dynamic", "realtime",
])

/** What a component can be at its core: the word a phrase must end on. */
const HEADS = new Set([
  "card", "button", "hero", "input", "text", "form", "navigation", "nav", "accordion", "icon", "features", "feature", "calendar", "menu", "tabs", "tab", "avatar", "image", "select", "badge", "block", "section", "modal", "slider", "carousel", "login", "pricing", "testimonials", "testimonial", "grid", "toggle", "spinner", "table", "checkbox", "dropdown", "progress", "breadcrumb", "breadcrumbs", "navbar", "tooltip", "textarea", "alert", "chart", "notification", "notifications", "dashboard", "logo", "logos", "gallery", "footer", "link", "links", "field", "chat", "video", "search", "banner", "pagination", "popover", "skeleton", "faq", "profile", "toast", "header", "list", "map", "sidebar", "bar", "dock", "review", "reviews", "message", "picker", "drawer", "heading", "headline", "timeline", "counter", "rating", "chip", "chips", "toolbar", "tree", "newsletter", "steps", "stepper", "container", "showcase", "tag", "tags", "globe", "otp", "separator", "divider", "team", "command", "filter", "multiselect", "timer", "indicator", "sheet", "quote", "dropzone", "pill", "kbd", "editor", "keyboard", "meter", "mockup", "selector", "clock", "loader", "preloader", "player", "uploader", "upload", "gauge", "terminal", "page", "panel", "tile", "widget", "cta", "switch", "radio", "group", "background", "layout", "bento", "stat", "stats", "metric", "metrics", "kpi", "graph", "heatmap", "countdown", "combobox", "autocomplete", "palette", "swatch", "cookie", "consent", "overlay", "dialog", "popup", "window", "screen", "window", "frame", "note", "comment", "comments", "feed", "post", "inbox", "composer", "prompt", "wizard", "onboarding", "checkout", "cart", "invoice", "receipt", "wallet", "plan", "plans", "subscription", "waitlist", "signup", "signin", "auth", "authentication", "pagination", "scrollbar", "area", "box", "label", "caption", "paragraph", "title", "subtitle", "typography", "logo", "brand", "cloud", "marquee", "ticker", "kanban", "board", "roadmap", "changelog", "blog", "article", "portfolio", "contact", "about", "event", "schedule", "booking", "order", "tracker", "calculator", "converter", "gallery", "lightbox", "viewer", "preview", "thumbnail", "thumbnails", "slideshow", "slides", "slide", "stack", "column", "columns", "row", "hamburger", "fab", "shortcut", "shortcuts", "keybinding", "code", "snippet", "json", "editor", "canvas", "whiteboard", "spreadsheet", "form", "survey", "poll", "quiz", "rating", "stars", "like", "share", "social", "follow", "bio", "resume", "chatbot", "assistant", "agent", "pdf", "document", "docs", "file", "files", "folder", "explorer", "notch", "island", "status", "statusbar", "mode", "theme", "switcher", "toggler", "tour", "walkthrough", "hint", "empty", "404", "error", "success", "confirmation", "verification", "reset", "password", "otp", "pin", "qr", "barcode", "scanner", "camera", "webcam", "mic", "audio", "music", "podcast", "playlist", "equalizer", "visualizer", "volume", "weather", "stock", "ticker", "crypto", "price", "currency", "exchange", "swap", "transfer", "payment", "billing", "account", "settings", "preferences", "permissions", "roles", "members", "invite", "user", "users", "people", "organization", "workspace", "project", "projects", "task", "tasks", "todo", "checklist", "habit", "goal", "reminder", "note", "notes", "sticky",
])

/** Kinds the registry keywords miss, mapped to the nearest type. */
const NEAREST: Record<string, (typeof NODE_TYPES)[number]> = {
  carousel: "list", slideshow: "list", gallery: "image", accordion: "list", faq: "section", testimonials: "section", testimonial: "card",
  features: "section", feature: "card", bento: "section", badge: "text", chip: "text", tag: "text", pill: "text", tooltip: "modal", popover: "modal",
  toast: "modal", alert: "modal", notification: "modal", sheet: "modal", drawer: "modal", lightbox: "modal", command: "search", combobox: "select",
  autocomplete: "search", multiselect: "select", breadcrumb: "navbar", pagination: "navbar", sidebar: "section", dock: "navbar", toolbar: "navbar",
  menu: "navbar", tabs: "tabs", stepper: "progress", wizard: "form", loader: "progress", preloader: "progress", spinner: "progress", skeleton: "box",
  meter: "progress", gauge: "stat", counter: "stat", kpi: "stat", heatmap: "chart", timeline: "list", kanban: "table", board: "table", roadmap: "list",
  changelog: "list", feed: "list", comment: "chat", composer: "chat", prompt: "input", chatbot: "chat", assistant: "chat", editor: "input", textarea: "input",
  otp: "input", uploader: "input", upload: "input", dropzone: "input", radio: "select", checkbox: "toggle", switch: "toggle", rating: "poll", review: "card",
  quote: "text", heading: "text", headline: "text", typography: "text", label: "text", caption: "text", logo: "image", avatar: "avatar", globe: "map",
  terminal: "text", code: "text", snippet: "text", player: "video", audio: "video", music: "video", podcast: "video", newsletter: "form", waitlist: "form",
  auth: "form", authentication: "form", signin: "form", cart: "list", checkout: "form", invoice: "table", pricing: "section", plan: "card", subscription: "card",
  cookie: "modal", consent: "modal", dialog: "modal", popup: "modal", overlay: "modal", tile: "card", widget: "card", panel: "section", container: "section",
  block: "section", showcase: "section", team: "section", contact: "contact", footer: "section", header: "navbar", banner: "hero", mockup: "image",
  background: "section", grid: "table", layout: "section", divider: "box", separator: "box", keyboard: "box", kbd: "text", cursor: "box", marquee: "list",
  profile: "card", bio: "card", status: "text", weather: "card", stock: "stat", price: "stat", wallet: "card", payment: "form", billing: "form",
  settings: "page", account: "page", dashboard: "page", onboarding: "page", error: "page", "404": "page", tree: "list", explorer: "list", file: "list",
  folder: "list", kanbanboard: "table", indicator: "progress", thumbnail: "image", preview: "image", viewer: "image", camera: "video", tour: "modal",
}

const SINGULAR: Record<string, string> = { testimonials: "testimonial", features: "feature", tabs: "tabs", stats: "stat", metrics: "metric", logos: "logo", links: "link", reviews: "review", chips: "chip", tags: "tag", notifications: "notification", breadcrumbs: "breadcrumb", comments: "comment", thumbnails: "thumbnail", columns: "column", slides: "slide", files: "file", notes: "note", tasks: "task", projects: "project", plans: "plan", users: "user", shortcuts: "shortcut", stars: "stars", docs: "docs", steps: "steps", settings: "settings", members: "members", people: "people", permissions: "permissions", roles: "roles", preferences: "preferences" }

type Component = { phrase: string; style: string[]; kind: string; type: string | null; seen: number }

const src = process.argv[2]
const xml = src ? await Bun.file(src).text() : await (await fetch("https://21st.dev/sitemap.xml", { headers: { "user-agent": "Mozilla/5.0" } })).text()
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname)
const slugs = [
  ...locs.flatMap((p) => /^\/community\/components\/s\/([^/]+)$/.exec(p)?.[1] ?? []),
  ...locs.flatMap((p) => /^\/@[^/]+\/components\/([^/]+)$/.exec(p)?.[1] ?? []),
]

// A word must turn up in several names to count: drops product names, jokes and typos.
const freq = new Map<string, number>()
for (const s of slugs) for (const w of new Set(s.toLowerCase().split("-"))) freq.set(w, (freq.get(w) ?? 0) + 1)
const known = (w: string) => STYLE.has(w) || HEADS.has(w) || (freq.get(w) ?? 0) >= 4

// Registry keywords, longest first, to map a kind to a type.
const keywords = NODE_TYPES.flatMap((t) => REGISTRY[t].keywords.map((k) => [k, t] as const)).sort((a, b) => b[0].length - a[0].length)
function typeOf(kind: string, head: string): string | null {
  for (const [k, t] of keywords) if (kind === k || kind.endsWith(" " + k)) return t
  if (NEAREST[head]) return NEAREST[head]!
  for (const [k, t] of keywords) if (!k.includes(" ") && k === head) return t
  return null
}

const byPhrase = new Map<string, Component>()
for (const slug of slugs) {
  let words = slug.toLowerCase().split("-")
  // "testimonials-with-marquee": the component is what comes before the first joining word.
  const cut = words.findIndex((w, i) => i > 0 && ["with", "and", "for", "using", "in", "on", "by", "from", "to", "via", "like", "inspired"].includes(w))
  if (cut > 0) words = words.slice(0, cut)
  words = words.filter((w) => !/^\d+$/.test(w) && !LIBS.has(w) && w.length > 1 || w === "3d" || w === "2d")
  words = words.filter((w) => !/^\d+$/.test(w))
  if (words.length === 0 || words.length > 5 || !words.every(known)) continue
  // "text-animation", "card-hover-effect": trailing style words describe it; the head comes before them.
  const style: string[] = []
  while (words.length > 1 && STYLE.has(words.at(-1)!) && !HEADS.has(words.at(-1)!)) style.unshift(words.pop()!)
  const head0 = words.at(-1)!
  if (!HEADS.has(head0)) continue
  const kindWords = words.filter((w, i) => i === words.length - 1 || !STYLE.has(w) || HEADS.has(w))
  for (const w of words) if (STYLE.has(w) && !kindWords.includes(w)) style.unshift(w)
  const head = SINGULAR[head0] ?? head0
  kindWords[kindWords.length - 1] = head
  const kind = kindWords.join(" ")
  const styleWords = [...new Set(style.filter((w) => !["effect", "effects", "8", "bit", "sci", "fi"].includes(w)))]
  const phrase = [...styleWords, kind].join(" ")
  const prev = byPhrase.get(phrase)
  if (prev) prev.seen++
  else byPhrase.set(phrase, { phrase, style: styleWords, kind, type: typeOf(kind, head), seen: 1 })
}

const components = [...byPhrase.values()].sort((a, b) => b.seen - a.seen || a.phrase.localeCompare(b.phrase))
const kinds = new Map<string, { kind: string; type: string | null; seen: number }>()
for (const c of components) {
  const k = kinds.get(c.kind) ?? { kind: c.kind, type: c.type, seen: 0 }
  k.seen += c.seen
  kinds.set(c.kind, k)
}
const kindList = [...kinds.values()].sort((a, b) => b.seen - a.seen || a.kind.localeCompare(b.kind))
const styles = [...new Set(components.flatMap((c) => c.style))].sort()
const unmapped = kindList.filter((k) => k.type === null).map((k) => k.kind)

await Bun.write(
  new URL("../data/ui-vocab.json", import.meta.url),
  JSON.stringify({ source: "https://21st.dev/sitemap.xml", slugs: slugs.length, kinds: kindList, styles, unmapped, components }, null, 1) + "\n",
)
const typed = kindList.filter((k) => k.type).length
console.log(`${slugs.length} names → ${components.length} components, ${kindList.length} kinds (${typed} mapped to a registry type, ${unmapped.length} not), ${styles.length} style words`)
console.log("top kinds:", kindList.slice(0, 40).map((k) => `${k.kind}→${k.type ?? "?"}`).join(", "))
console.log("unmapped:", unmapped.slice(0, 40).join(", "))
