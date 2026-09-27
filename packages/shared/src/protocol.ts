import { Schema } from "effect"
import { BoardEdge, BoardNode, Draft } from "./board.ts"
import { Suggestion } from "./entry.ts"

/** A point in board (world) coordinates, independent of each viewer's pan/zoom. */
export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Point = typeof Point.Type

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(40)),
  color: Schema.String,
  cursor: Schema.NullOr(Point),
  /** Typing in their box right now (their draft itself stays private). */
  typing: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})
export type User = typeof User.Type

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export class Join extends Schema.TaggedClass<Join>()("Join", {
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(40)),
  color: Schema.String,
}) {}

export class MoveCursor extends Schema.TaggedClass<MoveCursor>()("MoveCursor", {
  /** null when the pointer leaves the board. */
  cursor: Schema.NullOr(Point),
}) {}

/** The typist's current input. Empty text clears their draft. */
export class SetInput extends Schema.TaggedClass<SetInput>()("SetInput", {
  text: Schema.String.pipe(Schema.maxLength(2000)),
  /** Center of the typist's viewport in board coordinates: where new top-level drafts appear. */
  anchor: Point,
  /** The element this person clicked: what they type edits it. */
  target: Schema.optional(Schema.String),
}) {}

/** Enter: turn the current draft into committed nodes. */
export class Commit extends Schema.TaggedClass<Commit>()("Commit", {}) {}

/** Esc: throw the current draft away. */
export class Discard extends Schema.TaggedClass<Discard>()("Discard", {}) {}

/** Drag a top-level element. Sent every frame while dragging; `final` on release (then saved). */
export class MoveNode extends Schema.TaggedClass<MoveNode>()("MoveNode", {
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  final: Schema.Boolean,
}) {}

/** Delete a committed element and everything inside it. */
export class DeleteNode extends Schema.TaggedClass<DeleteNode>()("DeleteNode", { id: Schema.String }) {}

/** Put your own picture into an image or hero element (null removes it). */
export class SetImage extends Schema.TaggedClass<SetImage>()("SetImage", {
  id: Schema.String,
  src: Schema.NullOr(Schema.String),
}) {}

/** Dropped a picture onto an element that isn't an image: add an image inside it. */
export class DropImage extends Schema.TaggedClass<DropImage>()("DropImage", {
  parent: Schema.String,
  src: Schema.String,
}) {}

/** Retag an element: give it a new @handle (people fix tags themselves). */
export class RenameHandle extends Schema.TaggedClass<RenameHandle>()("RenameHandle", {
  id: Schema.String,
  handle: Schema.String,
}) {}

/** Step back (-1) or forward (+1) through this person's draft versions before Enter. */
export class StepDraft extends Schema.TaggedClass<StepDraft>()("StepDraft", {
  delta: Schema.Literal(-1, 1),
}) {}

/** Annotate an element ("" removes the note). */
export class SetNote extends Schema.TaggedClass<SetNote>()("SetNote", {
  id: Schema.String,
  note: Schema.String.pipe(Schema.maxLength(2000)),
}) {}

export const ClientMessage = Schema.Union(Join, MoveCursor, SetInput, Commit, Discard, MoveNode, DeleteNode, SetImage, DropImage, RenameHandle, SetNote, StepDraft)
export type ClientMessage = typeof ClientMessage.Type

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const Displacement = Schema.Struct({ id: Schema.String, x: Schema.Number, y: Schema.Number })
export type Displacement = typeof Displacement.Type

/** Sent once after Join: who you are and the full room snapshot. */
export class Welcome extends Schema.TaggedClass<Welcome>()("Welcome", {
  selfId: Schema.String,
  users: Schema.Array(User),
  /** Committed board. */
  nodes: Schema.Array(BoardNode),
  edges: Schema.optionalWith(Schema.Array(BoardEdge), { default: () => [] }),
  /** Everyone's live drafts, so late joiners see ideas already forming. */
  drafts: Schema.Array(Draft),
  displaced: Schema.optionalWith(Schema.Array(Displacement), { default: () => [] }),
}) {}

export class UserJoined extends Schema.TaggedClass<UserJoined>()("UserJoined", { user: User }) {}

export class UserLeft extends Schema.TaggedClass<UserLeft>()("UserLeft", { id: Schema.String }) {}

/** Someone started or stopped typing: presence only, never the draft. */
export class UserTyping extends Schema.TaggedClass<UserTyping>()("UserTyping", {
  id: Schema.String,
  typing: Schema.Boolean,
}) {}

export class CursorMoved extends Schema.TaggedClass<CursorMoved>()("CursorMoved", {
  id: Schema.String,
  cursor: Schema.NullOr(Point),
}) {}

/** Per-piece classification, for the ?debug=1 view. */
export const PieceDebug = Schema.Struct({
  text: Schema.String,
  type: Schema.String,
  confidence: Schema.Number,
  source: Schema.Literal("keyword", "jev"),
})
export type PieceDebug = typeof PieceDebug.Type

/** A user's draft changed (replaces their previous draft entirely). */
export class DraftUpdated extends Schema.TaggedClass<DraftUpdated>()("DraftUpdated", {
  draft: Draft,
  debug: Schema.optional(Schema.Array(PieceDebug)),
}) {}

/** Only to the typist: plain words that probably mean an existing @handle ("link to @postgres?"). */
export class SuggestionsUpdated extends Schema.TaggedClass<SuggestionsUpdated>()("SuggestionsUpdated", {
  suggestions: Schema.Array(Suggestion),
}) {}

export class DraftCleared extends Schema.TaggedClass<DraftCleared>()("DraftCleared", { userId: Schema.String }) {}

export class NodesCommitted extends Schema.TaggedClass<NodesCommitted>()("NodesCommitted", {
  nodes: Schema.Array(BoardNode),
  edges: Schema.optionalWith(Schema.Array(BoardEdge), { default: () => [] }),
}) {}

/** Committed nodes changed in place (moves, pins). Last write wins per node. */
export class NodesUpdated extends Schema.TaggedClass<NodesUpdated>()("NodesUpdated", {
  nodes: Schema.Array(BoardNode),
}) {}

/**
 * Where drafts are currently pushing committed elements. Derived, never saved:
 * the full set every time (empty when nothing is displaced).
 */
export class LayoutUpdated extends Schema.TaggedClass<LayoutUpdated>()("LayoutUpdated", {
  displaced: Schema.Array(Displacement),
}) {}

export class NodesRemoved extends Schema.TaggedClass<NodesRemoved>()("NodesRemoved", {
  ids: Schema.Array(Schema.String),
  /** Arrows attached to the removed nodes. */
  edgeIds: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
}) {}

export const ServerMessage = Schema.Union(
  Welcome,
  UserJoined,
  UserLeft,
  UserTyping,
  CursorMoved,
  DraftUpdated,
  DraftCleared,
  NodesCommitted,
  NodesUpdated,
  NodesRemoved,
  LayoutUpdated,
  SuggestionsUpdated,
)
export type ServerMessage = typeof ServerMessage.Type

// ---------------------------------------------------------------------------
// Wire codecs (JSON text frames)
// ---------------------------------------------------------------------------

export const ClientMessageJson = Schema.parseJson(ClientMessage)
export const ServerMessageJson = Schema.parseJson(ServerMessage)

export const encodeClientMessage = Schema.encodeSync(ClientMessageJson)
export const decodeClientMessage = Schema.decodeUnknownEither(ClientMessageJson)
export const encodeServerMessage = Schema.encodeSync(ServerMessageJson)
export const decodeServerMessage = Schema.decodeUnknownEither(ServerMessageJson)
