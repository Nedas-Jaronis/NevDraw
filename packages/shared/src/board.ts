import { Schema } from "effect"
import { EdgeKind, Layout, NodeType } from "./registry.ts"

/** Upper bound for an embedded image (data-URL characters). The client downscales to fit. */
export const MAX_IMAGE_SRC = 600_000

/** A safe image source: an inline raster image, or an https URL. */
export const isImageSrc = (s: string) =>
  s.length <= MAX_IMAGE_SRC && (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s) || /^https:\/\/[^\s"'<>]+$/i.test(s))

export const NodeProps = Schema.Struct({
  layout: Schema.optional(Layout),
  /** A collection's item type: "a table of timers" → table, of: timer. */
  of: Schema.optional(NodeType),
  /** Concrete items/values: rows of a table, options of a poll, entries of a checklist. */
  items: Schema.optional(Schema.Array(Schema.String.pipe(Schema.maxLength(60))).pipe(Schema.maxItems(12))),
  /** A picture people put in (image, hero): an image data-URL (downscaled) or an https URL. */
  src: Schema.optional(Schema.String.pipe(Schema.maxLength(MAX_IMAGE_SRC))),
  /** Accent color (hex) from the prompt: "a red button", "tiffany blue hero", "danger" → red. */
  color: Schema.optional(Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i))),
  /** A person's annotation on this element ("why this is here", "TODO: copy from marketing"). */
  note: Schema.optional(Schema.String.pipe(Schema.maxLength(2000))),
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

/** A pending change to a committed element (applied on commit). */
export const NodePatch = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
  type: Schema.optional(NodeType),
  color: Schema.optional(Schema.String),
  /** New parent id (a draft container or a committed one). */
  parent: Schema.optional(Schema.String),
  /** Move out of its container to the top level. */
  detach: Schema.optional(Schema.Boolean),
  /** Set its annotation. */
  note: Schema.optional(Schema.String),
  /** Remove it and everything inside it. */
  remove: Schema.optional(Schema.Boolean),
  /** A collection's new item type. */
  of: Schema.optional(NodeType),
  /** Its new list (fields, links, rows). */
  items: Schema.optional(Schema.Array(Schema.String.pipe(Schema.maxLength(60))).pipe(Schema.maxItems(12))),
  /** Its new position among its siblings. */
  order: Schema.optional(Schema.Number),
  /** Remove the arrows between it and this node id ("*": all its arrows). */
  unlink: Schema.optional(Schema.String),
})
export type NodePatch = typeof NodePatch.Type

/** One user's live, unsaved interpretation of their input box. */
export const Draft = Schema.Struct({
  userId: Schema.String,
  /** The raw text, shown to others as "X is typing: …". */
  text: Schema.String,
  nodes: Schema.Array(BoardNode),
  edges: Schema.optionalWith(Schema.Array(BoardEdge), { default: () => [] }),
  patches: Schema.optionalWith(Schema.Array(NodePatch), { default: () => [] }),
  /** Which version of this draft is showing (the typist steps through them before Enter). */
  history: Schema.optional(
    Schema.Struct({
      at: Schema.Number,
      total: Schema.Number,
      source: Schema.Literal("Instant", "Jev", "AI"),
      /** What this version is (a sketch's component: "Modal", "Form"…). */
      label: Schema.optional(Schema.String),
    }),
  ),
})
export type Draft = typeof Draft.Type
