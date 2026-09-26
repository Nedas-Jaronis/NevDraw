import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { decodeClientMessage, encodeServerMessage, type ServerMessage } from "@rtw/shared"
import { Effect, Either, Queue, Schema } from "effect"
import { Rooms, type Session } from "./Rooms.ts"

export const RoomParams = Schema.Struct({ roomId: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,64}$/)) })

const textDecoder = new TextDecoder()

/**
 * GET /ws/:roomId, upgraded to a WebSocket. The first message must be Join;
 * everything after is routed to the room session. Leaving is guaranteed on
 * any disconnect or error.
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

  yield* socket
    .runRaw((data) =>
      Effect.gen(function* () {
        const parsed = decodeClientMessage(typeof data === "string" ? data : textDecoder.decode(data))
        if (Either.isLeft(parsed)) return yield* Effect.logWarning("dropping malformed client message")
        const msg = parsed.right
        switch (msg._tag) {
          case "Join":
            if (!session) session = yield* rooms.join(roomId, { name: msg.name, color: msg.color }, outbox)
            return
          case "MoveCursor":
            if (session) yield* session.moveCursor(msg.cursor)
            return
        }
      }),
    )
    .pipe(
      Effect.catchAll(() => Effect.void),
      Effect.ensuring(Effect.suspend(() => session?.leave ?? Effect.void)),
    )

  return HttpServerResponse.empty()
}).pipe(Effect.scoped)
