import { CursorMoved, type Point, type ServerMessage, type User, UserJoined, UserLeft, Welcome } from "@rtw/shared"
import { Context, Effect, Layer, Queue } from "effect"

/** One connected socket in a room. Messages are queued; the socket's own fiber drains them. */
type Client = {
  user: User
  outbox: Queue.Queue<ServerMessage>
}

type Room = { clients: Map<string, Client> }

export type Session = {
  readonly selfId: string
  readonly moveCursor: (cursor: Point | null) => Effect.Effect<void>
  readonly leave: Effect.Effect<void>
}

/**
 * Authoritative in-memory room state. JS is single-threaded and every mutation
 * below is synchronous, so plain Maps are safe here.
 */
export class Rooms extends Context.Tag("Rooms")<
  Rooms,
  {
    readonly join: (
      roomId: string,
      profile: { name: string; color: string },
      outbox: Queue.Queue<ServerMessage>,
    ) => Effect.Effect<Session>
    readonly size: (roomId: string) => Effect.Effect<number>
  }
>() {}

export const RoomsLive = Layer.sync(Rooms, () => {
  const rooms = new Map<string, Room>()

  const broadcast = (room: Room, msg: ServerMessage, exceptId?: string) =>
    Effect.forEach(
      [...room.clients.values()].filter((c) => c.user.id !== exceptId),
      (c) => Queue.offer(c.outbox, msg),
      { discard: true },
    )

  const join = (roomId: string, profile: { name: string; color: string }, outbox: Queue.Queue<ServerMessage>) =>
    Effect.gen(function* () {
      let room = rooms.get(roomId)
      if (!room) {
        room = { clients: new Map() }
        rooms.set(roomId, room)
      }
      const r = room
      const user: User = { id: crypto.randomUUID(), name: profile.name, color: profile.color, cursor: null }
      r.clients.set(user.id, { user, outbox })

      yield* Queue.offer(outbox, new Welcome({ selfId: user.id, users: [...r.clients.values()].map((c) => c.user) }))
      yield* broadcast(r, new UserJoined({ user }), user.id)

      const session: Session = {
        selfId: user.id,
        moveCursor: (cursor) =>
          Effect.suspend(() => {
            const c = r.clients.get(user.id)
            if (!c) return Effect.void
            c.user = { ...c.user, cursor }
            return broadcast(r, new CursorMoved({ id: user.id, cursor }), user.id)
          }),
        leave: Effect.suspend(() => {
          if (!r.clients.delete(user.id)) return Effect.void
          if (r.clients.size === 0) rooms.delete(roomId)
          return broadcast(r, new UserLeft({ id: user.id }))
        }),
      }
      return session
    })

  return {
    join,
    size: (roomId) => Effect.sync(() => rooms.get(roomId)?.clients.size ?? 0),
  }
})
