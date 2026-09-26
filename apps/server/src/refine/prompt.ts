import { EDGE_KINDS, type EntryGraph, LAYOUTS, NODE_TYPES } from "@rtw/shared"
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
    }),
  ),
  edges: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String, kind: EdgeKind })),
  suggestions: Schema.Array(Schema.Struct({ text: Schema.String, handle: Schema.String })),
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
      props: n.layout === "none" ? {} : { layout: n.layout },
    })),
    edges: g.edges.filter((e) => e.from !== e.to),
    suggestions: g.suggestions,
  }
}

export type BoardSummaryItem = { handle: string; type: string; label: string; parent: string | null }

export type RefineInput = {
  text: string
  /** Committed elements the entry may reference. */
  board: readonly BoardSummaryItem[]
  /** The instant draft's nodes, so the model can keep their keys (smooth morphing). */
  draft: readonly { key: string; type: string; label: string; parent: string | null }[]
}

export const SYSTEM = `You turn a teammate's short description into a graph for a shared wireframe and system-architecture whiteboard. Reply with JSON only, matching the schema.

nodes: every element the text describes, nothing more.
- type is one of: ${NODE_TYPES.join(", ")}.
  UI: page (a whole screen), section (a region of a page), navbar, hero, form, input, button, card, list, table, image, modal, text.
  Architecture: client (browser/app), service (server/API/worker), database, cache, queue, storage, external-api (third-party like Stripe). Use box only when nothing fits.
- label: a short name a person would write on the box (e.g. "Landing page", "Pricing table", "Postgres").
- parent: the key of the element it sits inside, an existing @handle it sits inside, or "" for top level. Only page, section, form, card and modal hold children. Architecture elements are never children.
- layout: "row", "grid" or "stack" when the text asks how a container arranges its children, otherwise "none".
- Repeated items ("three pricing cards") become that many separate nodes inside one section.

edges: relationships between elements, as keys or @handles, with kind one of: ${EDGE_KINDS.join(", ")}.
- calls = requests/sends/uses; reads = fetches/queries; writes = saves/stores/updates; publishes/subscribes = events and queues; navigates-to = a page or button leads to another page.
- Resolve pronouns and chains ("the checkout calls stripe, then it emails the user via a queue").

References: the board already has the elements listed under "board". Refer to them only by their exact @handle, never invent handles, and never re-create an element that the text refers to by @handle.
suggestions: when plain text clearly means an existing board element but was not written as an @handle (e.g. "postgres" while @postgres exists), add {"text": the words used, "handle": the @handle}. Keep creating the node as usual.

Keys: reuse the key from "draft" when your node is the same element (same thing, even if you improve its type or label). New elements get new keys like "n1", "n2".`

export function userPrompt(input: RefineInput): string {
  return JSON.stringify({ text: input.text, board: input.board, draft: input.draft })
}
