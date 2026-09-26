import { Schema } from "effect"
import { Layout, NodeType } from "./registry.ts"

export const NodeProps = Schema.Struct({
  layout: Schema.optional(Layout),
})
export type NodeProps = typeof NodeProps.Type

/**
 * One element on the board. Drafts and committed nodes share this shape; a
 * draft keeps its id when committed so the transition animates in place.
 */
export const BoardNode = Schema.Struct({
  id: Schema.String,
  type: NodeType,
  label: Schema.String,
  /** Parent node id, or null for top-level. */
  parent: Schema.NullOr(Schema.String),
  props: NodeProps,
  x: Schema.Number,
  y: Schema.Number,
  /** Set once a user drags it; automatic layout never moves pinned nodes. */
  pinned: Schema.Boolean,
  authorId: Schema.String,
  authorColor: Schema.String,
})
export type BoardNode = typeof BoardNode.Type

/** One user's live, unsaved interpretation of their input box. */
export const Draft = Schema.Struct({
  userId: Schema.String,
  /** The raw text, shown to others as "X is typing: …". */
  text: Schema.String,
  nodes: Schema.Array(BoardNode),
})
export type Draft = typeof Draft.Type
