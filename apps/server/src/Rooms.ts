import {
  type BoardNode,
  CursorMoved,
  type Draft,
  DraftCleared,
  DraftUpdated,
  NodesCommitted,
  type Point,
  type ServerMessage,
  type User,
  UserJoined,
  UserLeft,
  Welcome,
} from "@rtw/shared"
import { Context, Deferred, Effect, Layer, Queue } from "effect"
import { BoardStore } from "./BoardStore.ts"
import { buildDraft } from "./drafts.ts"

/** One connected socket in a room. Messages are queued; the socket's own fiber drains them. */
type Client = {
  user: User
  outbox: Queue.Queue<ServerMessage>
}

type Room = {
  clients: Map<string, Client>
  /** Committed layer (mirrors the store). */
  nodes: Map<string, BoardNode>
  /** Draft layer: one per typing user, never persisted. */
  drafts: Map<string, Draft>
  /** Resolves once the committed layer has been loaded from the store. */
  ready: Deferred.Deferred<void>
}

export type Session = {
  readonly selfId: string
  readonly moveCursor: (cursor: Point | null) => Effect.Effect<void>
  readonly setInput: (text: string, anchor: Point) => Effect.Effect<void>
  readonly commit: Effect.Effect<void>
  readonly discard: Effect.Effect<void>
  readonly leave: Effect.Effect<void>
}

/**
 * Authoritative room state. JS is single-threaded and every read-modify-write
 * of the maps below happens without an intervening yield, so plain Maps are safe.
 */
export class Rooms extends Context.Tag("Rooms")<
  Rooms,
  {
    readonly join: (
      roomId: string,
      profile: { name: string; color: string },
      outbox: Queue.Queue<ServerMessage>,
    ) => Effect.Effect<Session>
  }
>() {}

export const RoomsLive = Layer.effect(
  Rooms,
  Effect.gen(function* () {
    const store = yield* BoardStore
    const rooms = new Map<string, Room>()

    const broadcast = (room: Room, msg: ServerMessage, exceptId?: string) =>
      Effect.forEach(
        [...room.clients.values()].filter((c) => c.user.id !== exceptId),
        (c) => Queue.offer(c.outbox, msg),
        { discard: true },
      )

    const openRoom = (roomId: string) =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const existing = rooms.get(roomId)
        if (existing) {
          yield* Deferred.await(existing.ready)
          return existing
        }
        const room: Room = { clients: new Map(), nodes: new Map(), drafts: new Map(), ready }
        rooms.set(roomId, room)
        for (const n of yield* store.load(roomId)) room.nodes.set(n.id, n)
        yield* Deferred.succeed(ready, undefined)
        return room
      })

    const join = (roomId: string, profile: { name: string; color: string }, outbox: Queue.Queue<ServerMessage>) =>
      Effect.gen(function* () {
        const room = yield* openRoom(roomId)
        const user: User = { id: crypto.randomUUID(), name: profile.name, color: profile.color, cursor: null }
        room.clients.set(user.id, { user, outbox })

        yield* Queue.offer(
          outbox,
          new Welcome({
            selfId: user.id,
            users: [...room.clients.values()].map((c) => c.user),
            nodes: [...room.nodes.values()],
            drafts: [...room.drafts.values()],
          }),
        )
        yield* broadcast(room, new UserJoined({ user }), user.id)

        const self = () => room.clients.get(user.id)?.user

        const clearDraft = Effect.suspend(() =>
          room.drafts.delete(user.id) ? broadcast(room, new DraftCleared({ userId: user.id })) : Effect.void,
        )

        const session: Session = {
          selfId: user.id,
          moveCursor: (cursor) =>
            Effect.suspend(() => {
              const c = room.clients.get(user.id)
              if (!c) return Effect.void
              c.user = { ...c.user, cursor }
              return broadcast(room, new CursorMoved({ id: user.id, cursor }), user.id)
            }),

          setInput: (text, anchor) =>
            Effect.suspend(() => {
              const me = self()
              if (!me) return Effect.void
              if (!text.trim()) return clearDraft
              const draft = buildDraft({
                text,
                anchor,
                user: me,
                prev: room.drafts.get(user.id),
                newId: () => crypto.randomUUID(),
              })
              room.drafts.set(user.id, draft)
              return broadcast(room, new DraftUpdated({ draft }))
            }),

          commit: Effect.gen(function* () {
            const draft = room.drafts.get(user.id)
            if (!draft || draft.nodes.length === 0) return
            room.drafts.delete(user.id)
            for (const n of draft.nodes) room.nodes.set(n.id, n)
            yield* store.upsert(roomId, draft.nodes)
            yield* broadcast(room, new NodesCommitted({ nodes: draft.nodes }))
            yield* broadcast(room, new DraftCleared({ userId: user.id }))
          }),

          discard: clearDraft,

          leave: Effect.gen(function* () {
            if (!room.clients.delete(user.id)) return
            yield* clearDraft
            yield* broadcast(room, new UserLeft({ id: user.id }))
            if (room.clients.size === 0) rooms.delete(roomId)
          }),
        }
        return session
      })

    return { join }
  }),
)
