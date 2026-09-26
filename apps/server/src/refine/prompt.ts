import { ACCENT_NAMES, ACCENTS, EDGE_KINDS, type EntryGraph, LAYOUTS, NODE_TYPES, REGISTRY } from "@rtw/shared"
import { EdgeKind, NodeType } from "@rtw/shared"
import { Schema } from "effect"

/**
 * The shape we ask LLMs for: EntryGraph with LLM-friendly fields ("" instead
 * of null, "none" instead of a missing layout), converted after decoding.
 */
export const LlmGraph = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      type: NodeType,
      label: Schema.String,
      /** A node key, an existing @handle, or "" for top level. */
      parent: Schema.String,
      layout: Schema.Literal(...LAYOUTS, "none"),
      /** A collection's item type ("a table of timers" → "timer"), or "none". */
      of: Schema.Literal(...NODE_TYPES, "none"),
      /** Concrete values: table rows, checklist entries, poll options, tab names. */
      items: Schema.Array(Schema.String),
      /** Accent color as #rrggbb when the text names or implies one, else "". */
      color: Schema.String,
      /** Position among siblings: right after / right before this key or @handle, else "". */
      after: Schema.String,
      before: Schema.String,
    }),
  ),
  edges: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String, kind: EdgeKind })),
  suggestions: Schema.Array(Schema.Struct({ text: Schema.String, handle: Schema.String })),
  /** Changes to existing elements ("" / "none" = unchanged). */
  patches: Schema.Array(
    Schema.Struct({
      element: Schema.String,
      label: Schema.String,
      type: Schema.Literal(...NODE_TYPES, "none"),
      color: Schema.String,
      parent: Schema.String,
    }),
  ),
})
export type LlmGraph = typeof LlmGraph.Type

export function fromLlm(g: LlmGraph): EntryGraph {
  const keys = new Set(g.nodes.map((n) => n.key))
  const validParent = (p: string) => (p === "" ? null : keys.has(p) || p.startsWith("@") ? p : null)
  return {
    nodes: g.nodes.map((n) => ({
      key: n.key,
      type: n.type,
      label: n.label.trim().slice(0, 60) || n.type,
      parent: validParent(n.parent.trim()),
      ...(n.after.trim() ? { after: n.after.trim().toLowerCase() } : {}),
      ...(n.before.trim() ? { before: n.before.trim().toLowerCase() } : {}),
      props: {
        ...(n.layout === "none" ? {} : { layout: n.layout }),
        ...(n.of !== "none" ? { of: n.of } : {}),
        ...(n.items.length ? { items: n.items.slice(0, 12).map((x) => x.slice(0, 60)) } : {}),
        ...(/^#[0-9a-f]{6}$/i.test(n.color.trim()) ? { color: n.color.trim().toLowerCase() } : {}),
      },
    })),
    edges: g.edges.filter((e) => e.from !== e.to),
    suggestions: g.suggestions,
    patches: g.patches
      .filter((p) => p.element.startsWith("@"))
      .map((p) => ({
        target: p.element.trim().toLowerCase(),
        ...(p.label.trim() ? { label: p.label.trim().slice(0, 60) } : {}),
        ...(p.type !== "none" ? { type: p.type } : {}),
        ...(/^#[0-9a-f]{6}$/i.test(p.color.trim()) ? { color: p.color.trim().toLowerCase() } : {}),
        ...(p.parent.trim() ? { parent: p.parent.trim() } : {}),
      })),
  }
}

const FIELDS = ["nodes", "edges", "suggestions", "patches", "element", "after", "before", "key", "type", "label", "parent", "layout", "items", "of", "color", "from", "to", "kind", "text", "handle", "source", "target"]

/**
 * Safety net for models that bend the shape in plain JSON mode: garbled
 * field names ("key 다", "sourceuib") map back to the field they start with,
 * source/target mean from/to, and missing optional fields get defaults.
 */
export function normalizeLlmJson(raw: unknown): unknown {
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix)
    if (!v || typeof v !== "object") return v
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) {
      const clean = k.trim().toLowerCase()
      const field = FIELDS.find((f) => clean === f) ?? FIELDS.slice().sort((a, b) => b.length - a.length).find((f) => clean.startsWith(f))
      if (field && !(field in out)) out[field] = fix(val)
    }
    if ("source" in out && !("from" in out)) out.from = out.source
    if ("target" in out && !("to" in out)) out.to = out.target
    delete out.source
    delete out.target
    return out
  }
  const g = fix(raw) as Record<string, unknown>
  if (!g || typeof g !== "object") return raw
  const nodes = Array.isArray(g.nodes) ? g.nodes : []
  return {
    nodes: nodes.map((n: any) => ({
      ...n,
      parent: n?.parent ?? "",
      layout: n?.layout ?? "none",
      of: n?.of ?? "none",
      items: Array.isArray(n?.items) ? n.items.map(String) : [],
      color: typeof n?.color === "string" ? n.color : "",
      after: typeof n?.after === "string" ? n.after : "",
      before: typeof n?.before === "string" ? n.before : "",
    })),
    edges: Array.isArray(g.edges) ? g.edges : [],
    suggestions: Array.isArray(g.suggestions) ? g.suggestions : [],
    patches: (Array.isArray(g.patches) ? g.patches : []).map((p: any) => ({
      element: String(p?.element ?? ""),
      label: String(p?.label ?? ""),
      type: p?.type ?? "none",
      color: String(p?.color ?? ""),
      parent: String(p?.parent ?? ""),
    })),
  }
}

export type BoardSummaryItem = { handle: string; type: string; label: string; parent: string | null; order: number }

export type RefineInput = {
  text: string
  /** Committed elements the entry may reference. */
  board: readonly BoardSummaryItem[]
  /** The @handles this person added most recently (what "them", "it", "both" refer to). */
  recent?: readonly string[]
  /** The instant draft's nodes, so the model can keep their keys (smooth morphing). */
  draft: readonly { key: string; type: string; label: string; parent: string | null }[]
}

export const SYSTEM = `You turn a teammate's short description into a graph for a shared wireframe and system-architecture whiteboard. Reply with JSON only, matching the schema.

nodes: every element the text describes, nothing more.
- type is one of these (pick the most specific; use box only when nothing fits):
${NODE_TYPES.map((t) => `  ${t}: ${REGISTRY[t].describe}`).join("\n")}
- label: a short name a person would write on the box (e.g. "Landing page", "Pricing table", "Postgres").
- parent: the key of the element it sits inside, an existing @handle it sits inside, or "" for top level. Only page, section, form, card and modal hold children. Architecture elements are never children.
- layout: "row", "grid" or "stack" when the text asks how a container arranges its children, otherwise "none".
- Repeated items ("three pricing cards") become that many separate nodes inside one section.
- Position: the board lists each element's parent and its "order" among siblings (the page's top-to-bottom structure). "between @navbar and @call-to-action" → parent = their parent, after "@navbar", before "@call-to-action"; "above @x" → before "@x"; "below @x" → after "@x"; otherwise after and before are "".
- Systems: follow the order the text states, literally. "5 servers connected to a load balancer which is then connected to 3 databases" → Server 1..5 each → Load balancer → each of Database 1..3. "a load balancer in front of 5 servers" → load balancer → each server. Repeated system pieces are separate, numbered nodes ("Server 1", "Server 2"). Never chain edges between siblings (server 1 → server 2) unless the text says so.
- "all / every / them" + a color on existing elements → one patch per element (all of them, or those of the named type).
- Numbers with units are values, not counts: "25 min timer" is one timer labelled "25 min timer".
- Collections: "a table/list of X" is ONE node of type table/list with "of" = X's type and "items" = its rows. Compute values the text asks for: "a table of timers with increments of 15" → type "table", of "timer", items ["15 min","30 min","45 min","60 min"]. Lists after a colon are items: "a checklist: milk, eggs" → items ["Milk","Eggs"]. Use items for poll options, tab names, select options and table rows too. Otherwise items is [] and "of" is "none".
- color: "#rrggbb" when the text names a color or clearly implies one, else "". Use this palette: ${ACCENT_NAMES.map((a) => `${a} ${ACCENTS[a].hex}`).join(", ")} ("delete button" → red, "success banner" → green, "dark mode" → dark). Don't color whole pages or sections unless the text asks.
- Clarifications name the listed elements in order: "a server and a database, being server and sql" → "Server" and "SQL Database"; "a database called postgres" → "Postgres".
- Ignore conversation and meta words ("can you create a flowchart with …" → just the elements).

edges: relationships between elements, as keys or @handles, with kind one of: ${EDGE_KINDS.join(", ")}.
- calls = requests/sends/uses; reads = fetches/queries; writes = saves/stores/updates; publishes/subscribes = events and queues; navigates-to = a page or button leads to another page.
- Resolve pronouns and chains ("the checkout calls stripe, then it emails the user via a queue").

Pronouns: "them", "these", "both", "it" refer to the @handles under "recent" (what this person added last). "Connect them" means edges between those elements, in a sensible flow direction, and no new nodes.

Changes to existing elements go in "patches", never as new nodes: "make @x red" → {element "@x", color red}; "rename @x to Checkout" → label; "turn @x into a stopwatch" → type (only change type when the text explicitly says turn into / convert to / change it to a; "make @x a red clock" is just a color); "wrap/group @a and @b into one box" or "…it should include @a @b" → a new container node plus a patch per element with parent = that container's key. Unused patch fields are "" (type "none").

References: the board already has the elements listed under "board". Refer to them only by their exact @handle, never invent handles, and never re-create an element that the text refers to by @handle.
suggestions: when plain text clearly means an existing board element but was not written as an @handle (e.g. "postgres" while @postgres exists), add {"text": the words used, "handle": the @handle}. Keep creating the node as usual.

Keys: reuse the key from "draft" when your node is the same element (same thing, even if you improve its type or label). New elements get new keys like "n1", "n2".`

export function userPrompt(input: RefineInput): string {
  return JSON.stringify({ text: input.text, board: input.board, recent: input.recent ?? [], draft: input.draft })
}
