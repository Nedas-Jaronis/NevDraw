import { Schema } from "effect"
import { NodeProps } from "./board.ts"
import { EdgeKind, NodeType } from "./registry.ts"

/**
 * The declarative interpretation of one entry's full text. Every pass (keyword,
 * Jev or LLM) produces a complete EntryGraph; the server diffs it against the
 * previous draft by `key`, so re-running is always safe.
 *
 * `key`s are local to the entry. References to committed board elements use
 * `@handle`s (validated by the server, see #9).
 */
export const EntryNode = Schema.Struct({
  key: Schema.String,
  type: NodeType,
  label: Schema.String,
  /** A local key, an `@handle`, or null for top-level. */
  parent: Schema.NullOr(Schema.String),
  props: NodeProps,
})
export type EntryNode = typeof EntryNode.Type

export const EntryEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  kind: EdgeKind,
  label: Schema.optional(Schema.String),
})
export type EntryEdge = typeof EntryEdge.Type

export const Suggestion = Schema.Struct({ text: Schema.String, handle: Schema.String })
export type Suggestion = typeof Suggestion.Type

export const EntryGraph = Schema.Struct({
  nodes: Schema.Array(EntryNode),
  edges: Schema.Array(EntryEdge),
  suggestions: Schema.Array(Suggestion),
})
export type EntryGraph = typeof EntryGraph.Type
