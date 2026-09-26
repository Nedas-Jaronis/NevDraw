import { Schema } from "effect"

/**
 * The element registry: the fixed vocabulary Jev and the LLM choose from.
 * Adding a type = adding an entry here (plus a renderer on the web side).
 * Each entry's `describe` is the single source for Jev's choice criteria and
 * the LLM prompt, so they can't drift apart.
 */
export const WIREFRAME_TYPES = [
  "page",
  "section",
  "navbar",
  "hero",
  "form",
  "input",
  "button",
  "card",
  "list",
  "table",
  "image",
  "modal",
  "text",
  // Widgets: self-contained UI components with a recognizable look.
  "timer",
  "stopwatch",
  "chart",
  "calendar",
  "map",
  "video",
  "chat",
  "tabs",
  "select",
  "toggle",
  "slider",
  "progress",
  "avatar",
  "search",
  "stat",
  // Cards from Shapeshift (github.com/anishfn/shapeshift), as wireframe components.
  "event",
  "checklist",
  "poll",
  "countdown",
  "color",
  "contact",
  "link",
  "habit",
  "goal",
  "reminder",
  "expense",
  "travel",
  "clock",
  "calculator",
  "note",
] as const

export const ARCHITECTURE_TYPES = ["client", "service", "database", "cache", "queue", "storage", "external-api"] as const

export const NODE_TYPES = [...WIREFRAME_TYPES, ...ARCHITECTURE_TYPES, "box"] as const
export const NodeType = Schema.Literal(...NODE_TYPES)
export type NodeType = typeof NodeType.Type

export const LAYOUTS = ["stack", "row", "grid"] as const
export const Layout = Schema.Literal(...LAYOUTS)
export type Layout = typeof Layout.Type

export type Lane = "ui" | "architecture"

export type RegistryEntry = {
  readonly lane: Lane
  /** Containers hold children laid out by CSS flow. */
  readonly container: boolean
  readonly defaultLayout: Layout
  /** One non-overlapping sentence: Jev's choice criterion and the LLM's definition. */
  readonly describe: string
  /** Lowercase phrases the offline keyword classifier looks for. Longer phrases win ties. */
  readonly keywords: readonly string[]
}

const ui = (describe: string, keywords: string[], container = false, defaultLayout: Layout = "stack"): RegistryEntry => ({
  lane: "ui",
  container,
  defaultLayout,
  describe,
  keywords,
})
const arch = (describe: string, keywords: string[]): RegistryEntry => ({
  lane: "architecture",
  container: false,
  defaultLayout: "stack",
  describe,
  keywords,
})

export const REGISTRY: { readonly [K in NodeType]: RegistryEntry } = {
  page: ui("A whole screen or page of an app or website, such as a landing page, dashboard or settings page", ["page", "screen", "landing", "dashboard", "homepage", "home page", "view", "route"], true),
  section: ui("A region of a page that groups other elements, such as features, pricing, testimonials, footer or sidebar", ["section", "area", "panel", "sidebar", "footer", "features", "testimonials", "faq", "pricing", "wrapper", "container", "group", "block"], true),
  navbar: ui("A navigation bar, header or menu across the top of a page", ["navbar", "nav bar", "navigation", "nav", "header", "menu", "top bar", "topbar"], false, "row"),
  hero: ui("The large introductory banner at the top of a page with a headline and call to action", ["hero", "hero area", "hero section", "hero banner", "hero image", "banner", "headline", "jumbotron", "splash"]),
  form: ui("A form that collects several inputs, such as sign up, log in, checkout or contact", ["form", "signup", "sign up", "login", "log in", "sign in", "register", "checkout form", "contact form"], true),
  input: ui("A single text input field, such as email, password or name", ["input", "field", "text field", "textbox", "email field", "password"]),
  button: ui("A single button or call-to-action link", ["button", "cta", "call to action", "submit", "link button"], false, "row"),
  card: ui("A self-contained card or tile, such as a pricing card or profile card", ["card", "tile", "pricing card", "profile card"], true),
  list: ui("A list or feed of repeated items, possibly a list of some other element", ["list", "feed", "timeline", "items", "results"]),
  table: ui("A table or grid of data with rows and columns, possibly a table of some other element", ["table", "grid view", "spreadsheet", "data table", "pricing table"]),
  image: ui("A still image, logo, photo, illustration or gallery", ["image", "photo", "picture", "logo", "illustration", "gallery"]),
  modal: ui("A dialog, modal, popup or drawer that appears over the page", ["modal", "dialog", "popup", "pop up", "overlay", "drawer"], true),
  text: ui("A block of text, heading, paragraph or caption", ["text", "paragraph", "copy", "title", "heading", "subtitle", "caption", "description"]),
  timer: ui("A countdown timer for a duration, such as a 25 minute focus or pomodoro timer", ["timer", "timers", "pomodoro", "focus timer"]),
  stopwatch: ui("A stopwatch that counts up elapsed time, often with laps", ["stopwatch", "stop watch", "lap timer", "elapsed time"]),
  chart: ui("A chart or graph of data, such as a line, bar or pie chart", ["chart", "graph", "plot", "analytics", "line chart", "bar chart", "pie chart", "sparkline"]),
  calendar: ui("A calendar or date picker", ["calendar", "date picker", "datepicker", "schedule", "agenda"]),
  map: ui("A map showing places or a location", ["map", "location", "directions"]),
  video: ui("A video player", ["video", "video player", "player", "livestream"]),
  chat: ui("A chat or messaging thread, comments or inbox", ["chat", "messages", "messaging", "comments", "inbox", "conversation"]),
  tabs: ui("A row of tabs or a segmented control for switching views", ["tabs", "tab bar", "segmented control"]),
  select: ui("A dropdown, select menu or picker for choosing one option", ["dropdown", "select", "picker", "combobox", "drop down"]),
  toggle: ui("An on/off switch, toggle or checkbox setting", ["toggle", "switch", "checkbox", "dark mode"]),
  slider: ui("A slider for picking a value in a range, such as volume or price", ["slider", "range slider", "volume"]),
  progress: ui("A progress bar, loading bar or step indicator", ["progress", "progress bar", "loading bar", "stepper", "steps"]),
  avatar: ui("A user avatar or profile picture with a name", ["avatar", "profile picture", "profile pic", "user badge"]),
  search: ui("A search bar with a search icon", ["search", "search bar", "search box", "searchbar"]),
  stat: ui("A single big number or KPI tile, such as revenue, users or a metric", ["stat", "stats", "metric", "metrics", "kpi", "counter", "total"]),
  event: ui("An event or meeting card with a date, time, place and people", ["event", "meeting", "appointment", "meetup", "event card"]),
  checklist: ui("A checklist, to-do list or shopping list with checkboxes", ["checklist", "todo", "todos", "to do", "to-do", "todo list", "to do list", "shopping list", "task list", "tasks"]),
  poll: ui("A poll or vote with options and percentages", ["poll", "vote", "voting", "survey"]),
  countdown: ui("A countdown of days until a date or event, such as days until launch", ["days until", "days left", "countdown to", "count down to", "launch countdown", "countdown"]),
  color: ui("A color swatch or color picker", ["color picker", "color", "colour", "palette", "swatch", "theme color"]),
  contact: ui("A contact card with a name, phone number and email", ["contact", "contact card", "business card", "phone number", "address book"]),
  link: ui("A link preview or bookmark card for a URL", ["link preview", "bookmark", "bookmarks", "url", "link card"]),
  habit: ui("A habit tracker showing a weekly streak", ["habit", "habits", "habit tracker", "streak"]),
  goal: ui("A goal with progress toward a target, such as 4 of 12 books", ["goal", "goals", "goal tracker", "okr", "target"]),
  reminder: ui("A single reminder or alarm pill", ["reminder", "reminders", "remind me", "alarm"]),
  expense: ui("An expense, transaction or spending row with an amount", ["expense", "expenses", "spending", "transaction", "transactions", "receipt", "budget"]),
  travel: ui("A trip, flight or travel booking card", ["flight", "flights", "trip", "travel", "itinerary", "boarding pass", "booking"]),
  clock: ui("A clock or time zone converter", ["clock", "time zone", "timezone", "world clock"]),
  calculator: ui("A calculator or computed result", ["calculator", "calc", "tip calculator", "bill splitter"]),
  note: ui("A sticky note or free-form note", ["note", "notes", "sticky note", "memo"]),
  client: arch("The software a user runs: browser, web app, mobile app or frontend", ["client", "browser", "frontend", "front end", "mobile app", "web app", "ios app", "android app", "spa"]),
  service: arch("A backend server, API, microservice, worker or function", ["server", "service", "api", "backend", "back end", "microservice", "worker", "lambda", "function", "endpoint", "gateway"]),
  database: arch("A database that stores records, such as Postgres, MySQL or MongoDB", ["database", "db", "postgres", "postgresql", "mysql", "mongo", "mongodb", "sqlite", "dynamodb", "supabase", "firestore"]),
  cache: arch("A cache or CDN, such as Redis", ["cache", "redis", "memcached", "cdn"]),
  queue: arch("A message queue, event bus or stream, such as Kafka or SQS", ["queue", "kafka", "rabbitmq", "sqs", "pubsub", "pub/sub", "event bus", "message bus", "stream"]),
  storage: arch("File or object storage, such as S3 or a bucket", ["storage", "s3", "bucket", "blob", "file store", "object store"]),
  "external-api": arch("A third-party service called over the network, such as Stripe, Twilio or an AI API", ["stripe", "twilio", "sendgrid", "openai", "gemini", "auth0", "clerk", "github api", "google maps", "third party", "external api", "webhook"]),
  box: ui("Something else, or too unclear to tell yet", []),
}

/**
 * Accent families Jev can pick when a color is implied rather than named
 * ("delete button" → red, "success banner" → green). Explicit colors are parsed by code.
 */
export const ACCENTS = {
  red: { hex: "#e03131", describe: "Red: danger, errors, delete, destructive, urgent, alerts" },
  orange: { hex: "#f76707", describe: "Orange: warm, energetic, sales, promotions" },
  yellow: { hex: "#f59f00", describe: "Yellow: warnings, caution, highlights, pending" },
  green: { hex: "#2f9e44", describe: "Green: success, confirm, money, growth, online, done" },
  teal: { hex: "#0c8599", describe: "Teal: calm, health, fresh" },
  blue: { hex: "#1c7ed6", describe: "Blue: primary actions, links, trust, information" },
  violet: { hex: "#7048e8", describe: "Violet: premium, creative, AI" },
  pink: { hex: "#e64980", describe: "Pink: playful, love, favorites" },
  gray: { hex: "#868e96", describe: "Gray: neutral, disabled, secondary" },
  dark: { hex: "#1f2a44", describe: "Dark: dark mode, night, elegant, dark theme" },
} as const
export type Accent = keyof typeof ACCENTS
export const ACCENT_NAMES = Object.keys(ACCENTS) as Accent[]

export const EDGE_KINDS = ["calls", "reads", "writes", "publishes", "subscribes", "navigates-to"] as const
export const EdgeKind = Schema.Literal(...EDGE_KINDS)
export type EdgeKind = typeof EdgeKind.Type
