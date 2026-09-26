import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { type ClientMessage, decodeClientMessage, encodeServerMessage, type ServerMessage } from "@rtw/shared"
import { Effect, Either, Queue, Schema } from "effect"
import { Rooms, type Session } from "./Rooms.ts"

export const RoomParams = Schema.Struct({ roomId: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,64}$/)) })

const textDecoder = new TextDecoder()

/**
 * GET /ws/:roomId, upgraded to a WebSocket. The first message must be Join;
 * everything after is routed to the room session. Leaving is guaranteed on
 * any disconnect or error.
 *
 * Socket handlers run concurrently, so incoming messages go through an inbox
 * drained by one fiber: each client's messages are applied strictly in order.
 */
export const roomSocket = Effect.gen(function* () {
  const { roomId } = yield* HttpRouter.schemaPathParams(RoomParams)
  const rooms = yield* Rooms
  const socket = yield* HttpServerRequest.upgrade
  const write = yield* socket.writer

  const outbox = yield* Queue.unbounded<ServerMessage>()
  yield* Queue.take(outbox).pipe(
    Effect.flatMap((msg) => write(encodeServerMessage(msg))),
    Effect.forever,
    Effect.forkScoped,
  )

  let session: Session | null = null
  const handle = (msg: ClientMessage): Effect.Effect<void> => {
    if (msg._tag === "Join") {
      if (session) return Effect.void
      return Effect.map(rooms.join(roomId, { name: msg.name, color: msg.color }, outbox), (s) => {
        session = s
      })
    }
    if (!session) return Effect.void
    switch (msg._tag) {
      case "MoveCursor":
        return session.moveCursor(msg.cursor)
      case "SetInput":
        return session.setInput(msg.text, msg.anchor)
      case "Commit":
        return session.commit
      case "Discard":
        return session.discard
      case "MoveNode":
        return session.moveNode(msg.id, msg.x, msg.y, msg.final)
      case "DeleteNode":
        return session.deleteNode(msg.id)
      case "SetImage":
        return session.setImage(msg.id, msg.src)
      case "DropImage":
        return session.dropImage(msg.parent, msg.src)
    }
  }

  const inbox = yield* Queue.unbounded<ClientMessage>()
  yield* Queue.take(inbox).pipe(Effect.flatMap(handle), Effect.forever, Effect.forkScoped)

  yield* socket
    .runRaw((data) => {
      const parsed = decodeClientMessage(typeof data === "string" ? data : textDecoder.decode(data))
      if (Either.isLeft(parsed)) return Effect.logWarning("dropping malformed client message")
      return Queue.offer(inbox, parsed.right)
    })
    .pipe(
      Effect.catchAll(() => Effect.void),
      Effect.ensuring(Effect.suspend(() => session?.leave ?? Effect.void)),
    )

  return HttpServerResponse.empty()
}).pipe(Effect.scoped)
