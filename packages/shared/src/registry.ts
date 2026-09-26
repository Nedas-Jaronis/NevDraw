import { Schema } from "effect"

/**
 * The element registry: the fixed vocabulary Jev and the LLM choose from.
 * Adding a type = adding an entry here (plus a renderer on the web side).
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
  /** Lowercase phrases the offline keyword classifier looks for. Longer phrases win ties. */
  readonly keywords: readonly string[]
}

export const REGISTRY: { readonly [K in NodeType]: RegistryEntry } = {
  page: { lane: "ui", container: true, defaultLayout: "stack", keywords: ["page", "screen", "landing", "dashboard", "homepage", "home page", "view", "route"] },
  section: { lane: "ui", container: true, defaultLayout: "stack", keywords: ["section", "area", "panel", "sidebar", "footer", "features", "testimonials", "faq", "pricing"] },
  navbar: { lane: "ui", container: false, defaultLayout: "row", keywords: ["navbar", "nav bar", "navigation", "nav", "header", "menu", "top bar", "topbar"] },
  hero: { lane: "ui", container: false, defaultLayout: "stack", keywords: ["hero", "banner", "headline", "jumbotron", "splash"] },
  form: { lane: "ui", container: true, defaultLayout: "stack", keywords: ["form", "signup", "sign up", "login", "log in", "sign in", "register", "checkout form", "contact form"] },
  input: { lane: "ui", container: false, defaultLayout: "stack", keywords: ["input", "field", "text field", "textbox", "search bar", "search box", "email field", "password"] },
  button: { lane: "ui", container: false, defaultLayout: "row", keywords: ["button", "cta", "call to action", "submit", "link button"] },
  card: { lane: "ui", container: true, defaultLayout: "stack", keywords: ["card", "tile", "pricing card", "profile card"] },
  list: { lane: "ui", container: false, defaultLayout: "stack", keywords: ["list", "feed", "timeline", "items", "results"] },
  table: { lane: "ui", container: false, defaultLayout: "stack", keywords: ["table", "grid view", "spreadsheet", "data table", "pricing table"] },
  image: { lane: "ui", container: false, defaultLayout: "stack", keywords: ["image", "photo", "picture", "logo", "avatar", "illustration", "gallery", "video"] },
  modal: { lane: "ui", container: true, defaultLayout: "stack", keywords: ["modal", "dialog", "popup", "pop up", "overlay", "drawer"] },
  text: { lane: "ui", container: false, defaultLayout: "stack", keywords: ["text", "paragraph", "copy", "title", "heading", "subtitle", "caption", "description"] },
  client: { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["client", "browser", "frontend", "front end", "mobile app", "web app", "ios app", "android app", "spa"] },
  service: { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["server", "service", "api", "backend", "back end", "microservice", "worker", "lambda", "function", "endpoint", "gateway"] },
  database: { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["database", "db", "postgres", "postgresql", "mysql", "mongo", "mongodb", "sqlite", "dynamodb", "supabase", "firestore"] },
  cache: { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["cache", "redis", "memcached", "cdn"] },
  queue: { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["queue", "kafka", "rabbitmq", "sqs", "pubsub", "pub/sub", "event bus", "message bus", "stream"] },
  storage: { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["storage", "s3", "bucket", "blob", "file store", "object store"] },
  "external-api": { lane: "architecture", container: false, defaultLayout: "stack", keywords: ["stripe", "twilio", "sendgrid", "openai", "gemini", "auth0", "clerk", "github api", "google maps", "third party", "external api", "webhook"] },
  box: { lane: "ui", container: false, defaultLayout: "stack", keywords: [] },
}
