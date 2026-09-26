import { Schema } from "effect"
import { EdgeKind, Layout, NodeType } from "./registry.ts"

export const NodeProps = Schema.Struct({
  layout: Schema.optional(Layout),
  /** A collection's item type: "a table of timers" → table, of: timer. */
  of: Schema.optional(NodeType),
  /** Concrete items/values: rows of a table, options of a poll, entries of a checklist. */
  items: Schema.optional(Schema.Array(Schema.String.pipe(Schema.maxLength(60))).pipe(Schema.maxItems(12))),
  /** Accent color (hex) from the prompt: "a red button", "tiffany blue hero", "danger" → red. */
  color: Schema.optional(Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i))),
})
export type NodeProps = typeof NodeProps.Type

/**
 * One element on the board. Drafts and committed nodes share this shape; a
 * draft keeps its id when committed so the transition animates in place.
 */
export const BoardNode = Schema.Struct({
  id: Schema.String,
  /** Readable, unique, permanent name for @-references (committed nodes only). */
  handle: Schema.optional(Schema.String),
  type: NodeType,
  label: Schema.String,
  /** Parent node id, or null for top-level. */
  parent: Schema.NullOr(Schema.String),
  /** Position among siblings inside a container (CSS flow order). */
  order: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  props: NodeProps,
  x: Schema.Number,
  y: Schema.Number,
  /** Set once a user drags it; automatic layout never moves pinned nodes. */
  pinned: Schema.Boolean,
  authorId: Schema.String,
  authorColor: Schema.String,
})
export type BoardNode = typeof BoardNode.Type

/** A typed arrow between two elements ("api writes to postgres"). */
export const BoardEdge = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  kind: EdgeKind,
  label: Schema.optional(Schema.String),
  authorId: Schema.String,
  authorColor: Schema.String,
})
export type BoardEdge = typeof BoardEdge.Type

/** One user's live, unsaved interpretation of their input box. */
export const Draft = Schema.Struct({
  userId: Schema.String,
  /** The raw text, shown to others as "X is typing: …". */
  text: Schema.String,
  nodes: Schema.Array(BoardNode),
  edges: Schema.optionalWith(Schema.Array(BoardEdge), { default: () => [] }),
})
export type Draft = typeof Draft.Type
