import type { NodeType } from "./registry.ts"

/**
 * What a form is for, from its name: the fields, button and footer a real one
 * would have. Shared by the renderer (what you see) and the server (what
 * "change email to username" edits), so both agree on the fields.
 */
export const FORM_KINDS: ReadonlyArray<{ test: RegExp; title: string; sub: string; fields: string[]; submit: string; footer?: string }> = [
  { test: /sign\s*up|register|create account|join/i, title: "Create your account", sub: "Start in less than a minute.", fields: ["Full name", "Email", "Password"], submit: "Sign up", footer: "Already have an account? Log in" },
  { test: /log\s*in|sign\s*in|auth/i, title: "Welcome back", sub: "Log in to continue.", fields: ["Email", "Password"], submit: "Log in", footer: "Forgot password?" },
  { test: /contact|message|support|feedback/i, title: "Get in touch", sub: "We usually reply within a day.", fields: ["Name", "Email", "Message"], submit: "Send" },
  { test: /checkout|payment|billing|card/i, title: "Payment", sub: "All transactions are secure.", fields: ["Card number", "Expiry", "CVC"], submit: "Pay now" },
  { test: /newsletter|subscribe|waitlist/i, title: "Stay in the loop", sub: "No spam, unsubscribe anytime.", fields: ["Email"], submit: "Subscribe" },
  { test: /confirm|delete|remove/i, title: "Are you sure?", sub: "This can't be undone.", fields: [], submit: "Confirm" },
]

export const formKindOf = (label: string) => FORM_KINDS.find((k) => k.test.test(label))

/** "Sidebar", "side nav", "left menu": the column beside a page's content. */
export const SIDEBAR_RE = /\b(side\s*bar|side\s*nav|side\s*menu|nav(?:igation)?\s*(?:panel|rail|drawer)|left\s*(?:menu|nav|panel)|drawer)\b/i
export const FOOTER_RE = /\bfooter\b/i

/**
 * The list an element shows when the prompt didn't give one: a form's fields,
 * a navbar's / sidebar's / footer's links. Null when it has no such list.
 */
export function defaultItems(type: NodeType, label: string): string[] | null {
  if (type === "form" || type === "modal") return formKindOf(label)?.fields ?? ["Name", "Email"]
  if (type === "navbar") return ["Home", "Pricing", "About"]
  if (type === "section" && SIDEBAR_RE.test(label)) return ["Overview", "Getting started", "Guides", "API reference", "Settings"]
  if (type === "section" && FOOTER_RE.test(label)) return ["About", "Blog", "Privacy", "Terms"]
  return null
}

/** The list an element actually shows: its own items, else the defaults. */
export const itemsOf = (n: { type: NodeType; label: string; props: { items?: readonly string[] } }): string[] | null =>
  n.props.items?.length ? [...n.props.items] : defaultItems(n.type, n.label)
