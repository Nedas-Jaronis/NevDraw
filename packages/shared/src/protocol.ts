import { Schema } from "effect"

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

export const ClientMessage = Schema.Union(Join, MoveCursor)
export type ClientMessage = typeof ClientMessage.Type

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

/** Sent once after Join: who you are and the full room snapshot. */
export class Welcome extends Schema.TaggedClass<Welcome>()("Welcome", {
  selfId: Schema.String,
  users: Schema.Array(User),
}) {}

export class UserJoined extends Schema.TaggedClass<UserJoined>()("UserJoined", { user: User }) {}

export class UserLeft extends Schema.TaggedClass<UserLeft>()("UserLeft", { id: Schema.String }) {}

export class CursorMoved extends Schema.TaggedClass<CursorMoved>()("CursorMoved", {
  id: Schema.String,
  cursor: Schema.NullOr(Point),
}) {}

export const ServerMessage = Schema.Union(Welcome, UserJoined, UserLeft, CursorMoved)
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
