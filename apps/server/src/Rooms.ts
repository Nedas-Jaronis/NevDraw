import {
  type BoardNode,
  CursorMoved,
  type Draft,
  DraftCleared,
  DraftUpdated,
  NodesCommitted,
  NodesRemoved,
  NodesUpdated,
  type Point,
  type ServerMessage,
  type User,
  UserJoined,
  UserLeft,
  Welcome,
} from "@rtw/shared"
import { Context, Deferred, Effect, Fiber, Layer, Queue } from "effect"
import { BoardStore } from "./BoardStore.ts"
import { Classifier } from "./classify/Classifier.ts"
import { type DraftMemory, interpret, materialize, type PieceMemory } from "./engine/index.ts"

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
  /** Which board id each of a user's draft keys became (server-only). */
  memory: Map<string, DraftMemory>
  /** Resolves once the committed layer has been loaded from the store. */
  ready: Deferred.Deferred<void>
}

export type Session = {
  readonly selfId: string
  readonly moveCursor: (cursor: Point | null) => Effect.Effect<void>
  readonly setInput: (text: string, anchor: Point) => Effect.Effect<void>
  readonly commit: Effect.Effect<void>
  readonly discard: Effect.Effect<void>
  readonly moveNode: (id: string, x: number, y: number, final: boolean) => Effect.Effect<void>
  readonly deleteNode: (id: string) => Effect.Effect<void>
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
    const classifier = yield* Classifier
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
        const room: Room = { clients: new Map(), nodes: new Map(), drafts: new Map(), memory: new Map(), ready }
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

        // Per-typist state: piece hysteresis, the in-flight Jev fetch, and the latest input.
        let pieceMemory: ReadonlyMap<number, PieceMemory> = new Map()
        let inflight: Fiber.RuntimeFiber<void> | null = null
        let latest: { text: string; anchor: Point } | null = null

        const cancelInflight = Effect.suspend(() => {
          const f = inflight
          inflight = null
          return f ? Fiber.interruptFork(f) : Effect.void
        })

        const clearDraft = Effect.suspend(() => {
          pieceMemory = new Map()
          latest = null
          room.memory.delete(user.id)
          return room.drafts.delete(user.id) ? broadcast(room, new DraftCleared({ userId: user.id })) : Effect.void
        })

        /** Build and broadcast the draft from what's known now; returns the pieces still waiting on Jev. */
        const render = (text: string, anchor: Point) =>
          Effect.suspend(() => {
            const me = self()
            if (!me) return Effect.succeed([])
            const r = interpret({ text, handles: [], peek: classifier.peek, memory: pieceMemory })
            pieceMemory = r.memory
            if (r.graph.nodes.length === 0) return Effect.as(clearDraft, [])
            const memory = materialize({
              graph: r.graph,
              prev: room.memory.get(user.id),
              anchor,
              user: me,
              newId: () => crypto.randomUUID(),
            })
            const draft: Draft = { userId: user.id, text, nodes: memory.nodes }
            room.memory.set(user.id, memory)
            room.drafts.set(user.id, draft)
            return Effect.as(broadcast(room, new DraftUpdated({ draft, debug: r.debug })), r.missing)
          })

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
            Effect.gen(function* () {
              yield* cancelInflight
              if (!self()) return
              if (!text.trim()) return yield* clearDraft
              latest = { text, anchor }
              const missing = yield* render(text, anchor)
              if (missing.length === 0 || !classifier.enabled) return
              // Jev answers arrive async: re-render with them only if this is still the latest input.
              inflight = yield* Effect.fork(
                classifier.fetch(missing).pipe(
                  Effect.zipRight(Effect.suspend(() => (latest?.text === text ? render(text, anchor) : Effect.void))),
                  Effect.asVoid,
                ),
              )
            }),

          commit: Effect.gen(function* () {
            yield* cancelInflight
            pieceMemory = new Map()
            latest = null
            const draft = room.drafts.get(user.id)
            if (!draft || draft.nodes.length === 0) return
            room.drafts.delete(user.id)
            room.memory.delete(user.id)
            for (const n of draft.nodes) room.nodes.set(n.id, n)
            yield* store.upsert(roomId, draft.nodes)
            yield* broadcast(room, new NodesCommitted({ nodes: draft.nodes }))
            yield* broadcast(room, new DraftCleared({ userId: user.id }))
          }),

          discard: Effect.zipRight(cancelInflight, clearDraft),

          moveNode: (id, x, y, final) =>
            Effect.gen(function* () {
              const n = room.nodes.get(id)
              // Only committed top-level elements move; children follow their container.
              if (!n || n.parent !== null || !Number.isFinite(x) || !Number.isFinite(y)) return
              const moved = { ...n, x: Math.round(x), y: Math.round(y), pinned: true }
              room.nodes.set(id, moved)
              yield* broadcast(room, new NodesUpdated({ nodes: [moved] }), user.id)
              if (final) {
                yield* store.upsert(roomId, [moved])
                // The mover gets the canonical version once, on release.
                const c = room.clients.get(user.id)
                if (c) yield* Queue.offer(c.outbox, new NodesUpdated({ nodes: [moved] }))
              }
            }),

          deleteNode: (id) =>
            Effect.gen(function* () {
              if (!room.nodes.has(id)) return
              const ids = [id]
              for (let i = 0; i < ids.length; i++) {
                for (const n of room.nodes.values()) if (n.parent === ids[i]) ids.push(n.id)
              }
              for (const d of ids) room.nodes.delete(d)
              yield* store.remove(roomId, ids)
              yield* broadcast(room, new NodesRemoved({ ids }))
            }),

          leave: Effect.gen(function* () {
            if (!room.clients.delete(user.id)) return
            yield* cancelInflight
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
