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
  /** Where among its siblings: right after / right before this key or @handle ("between @a and @b" → after @a, before @b). */
  after: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
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

/**
 * A change to an element already on the board, named by @handle: "make @x
 * red", "rename @x to Checkout", "turn @x into a stopwatch", or moving it into
 * a container ("wrap @a and @b into one box" → parent = the new box's key).
 */
export const EntryPatch = Schema.Struct({
  target: Schema.String,
  label: Schema.optional(Schema.String),
  type: Schema.optional(NodeType),
  color: Schema.optional(Schema.String),
  /** A local key or @handle of the container it moves into. */
  parent: Schema.optional(Schema.String),
  /** "take @a out of @b": move it out of its container to the top level. */
  detach: Schema.optional(Schema.Boolean),
  /** "annotate @x: needs real copy": its annotation. */
  note: Schema.optional(Schema.String),
  /** Remove it (and everything inside it). */
  remove: Schema.optional(Schema.Boolean),
  /** Move among its siblings: right after / before this @handle, or "$top" / "$bottom" / "$prev" / "$next". */
  after: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
  /** "disconnect @a from @b": remove the arrows between it and this @handle ("*": all its arrows). */
  unlink: Schema.optional(Schema.String),
})
export type EntryPatch = typeof EntryPatch.Type

export const EntryGraph = Schema.Struct({
  nodes: Schema.Array(EntryNode),
  edges: Schema.Array(EntryEdge),
  suggestions: Schema.Array(Suggestion),
  patches: Schema.optionalWith(Schema.Array(EntryPatch), { default: () => [] }),
})
export type EntryGraph = typeof EntryGraph.Type
