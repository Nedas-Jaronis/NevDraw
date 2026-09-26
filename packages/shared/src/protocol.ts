import { Schema } from "effect"
import { BoardNode, Draft } from "./board.ts"

/** A point in board (world) coordinates, independent of each viewer's pan/zoom. */
export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Point = typeof Point.Type

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(40)),
  color: Schema.String,
  cursor: Schema.NullOr(Point),
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
}) {}

/** Enter: turn the current draft into committed nodes. */
export class Commit extends Schema.TaggedClass<Commit>()("Commit", {}) {}

/** Esc: throw the current draft away. */
export class Discard extends Schema.TaggedClass<Discard>()("Discard", {}) {}

export const ClientMessage = Schema.Union(Join, MoveCursor, SetInput, Commit, Discard)
export type ClientMessage = typeof ClientMessage.Type

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

/** Sent once after Join: who you are and the full room snapshot. */
export class Welcome extends Schema.TaggedClass<Welcome>()("Welcome", {
  selfId: Schema.String,
  users: Schema.Array(User),
  /** Committed board. */
  nodes: Schema.Array(BoardNode),
  /** Everyone's live drafts, so late joiners see ideas already forming. */
  drafts: Schema.Array(Draft),
}) {}

export class UserJoined extends Schema.TaggedClass<UserJoined>()("UserJoined", { user: User }) {}

export class UserLeft extends Schema.TaggedClass<UserLeft>()("UserLeft", { id: Schema.String }) {}

export class CursorMoved extends Schema.TaggedClass<CursorMoved>()("CursorMoved", {
  id: Schema.String,
  cursor: Schema.NullOr(Point),
}) {}

/** A user's draft changed (replaces their previous draft entirely). */
export class DraftUpdated extends Schema.TaggedClass<DraftUpdated>()("DraftUpdated", { draft: Draft }) {}

export class DraftCleared extends Schema.TaggedClass<DraftCleared>()("DraftCleared", { userId: Schema.String }) {}

export class NodesCommitted extends Schema.TaggedClass<NodesCommitted>()("NodesCommitted", {
  nodes: Schema.Array(BoardNode),
}) {}

export const ServerMessage = Schema.Union(
  Welcome,
  UserJoined,
  UserLeft,
  CursorMoved,
  DraftUpdated,
  DraftCleared,
  NodesCommitted,
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
