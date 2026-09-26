import {
  type BoardEdge,
  type BoardNode,
  CursorMoved,
  type Displacement,
  LayoutUpdated,
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
import { avoid, estimateSizes, pushAside, type Rect } from "./engine/layout.ts"

/** One connected socket in a room. Messages are queued; the socket's own fiber drains them. */
type Client = {
  user: User
  outbox: Queue.Queue<ServerMessage>
}

type Room = {
  clients: Map<string, Client>
  /** Committed layer (mirrors the store). */
  nodes: Map<string, BoardNode>
  edges: Map<string, BoardEdge>
  /** Draft layer: one per typing user, never persisted. */
  drafts: Map<string, Draft>
  /** Which board id each of a user's draft keys became (server-only). */
  memory: Map<string, DraftMemory>
  /** Committed elements currently pushed aside by drafts (derived, never saved). */
  displaced: ReadonlyMap<string, { x: number; y: number }>
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

    const displacementList = (m: ReadonlyMap<string, { x: number; y: number }>): Displacement[] =>
      [...m].map(([id, p]) => ({ id, x: p.x, y: p.y }))

    /** Recompute who drafts are pushing; broadcast only when it changes. */
    const relayout = (room: Room) =>
      Effect.suspend(() => {
        const committed = [...room.nodes.values()]
        const drafts = [...room.drafts.values()].flatMap((d) => d.nodes)
        const next = pushAside({ committed, drafts, sizes: estimateSizes([...committed, ...drafts]) })
        const same = next.size === room.displaced.size && [...next].every(([id, p]) => {
          const q = room.displaced.get(id)
          return q !== undefined && q.x === p.x && q.y === p.y
        })
        if (same) return Effect.void
        room.displaced = next
        return broadcast(room, new LayoutUpdated({ displaced: displacementList(next) }))
      })

    const openRoom = (roomId: string) =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const existing = rooms.get(roomId)
        if (existing) {
          yield* Deferred.await(existing.ready)
          return existing
        }
        const room: Room = {
          clients: new Map(),
          nodes: new Map(),
          edges: new Map(),
          drafts: new Map(),
          memory: new Map(),
          displaced: new Map(),
          ready,
        }
        rooms.set(roomId, room)
        const saved = yield* store.load(roomId)
        for (const n of saved.nodes) room.nodes.set(n.id, n)
        for (const e of saved.edges) room.edges.set(e.id, e)
        yield* Deferred.succeed(ready, undefined)
        return room
      })

    /**
     * New top-level draft elements slide clear of pinned elements and other
     * people's drafts (those never get pushed). Positions then stay put in
     * the draft's memory, so they don't jump while typing continues.
     */
    const placeNewRoots = (room: Room, userId: string, prev: DraftMemory | undefined, next: DraftMemory): DraftMemory => {
      const known = new Set(prev?.nodes.map((n) => n.id))
      const fresh = next.nodes.filter((n) => n.parent === null && !known.has(n.id))
      if (fresh.length === 0) return next
      const others = [...room.drafts.values()].filter((d) => d.userId !== userId).flatMap((d) => d.nodes)
      const pinned = [...room.nodes.values()].filter((n) => n.parent === null && n.pinned)
      const sizes = estimateSizes([...next.nodes, ...others, ...room.nodes.values()])
      const rectOf = (n: BoardNode): Rect => ({ x: n.x, y: n.y, ...(sizes.get(n.id) ?? { w: 240, h: 60 }) })
      const obstacles = [...pinned, ...others.filter((n) => n.parent === null)].map(rectOf)
      const shifted = new Map<string, { x: number; y: number }>()
      for (const n of fresh) {
        const p = avoid(rectOf(n), obstacles)
        if (p.x !== n.x || p.y !== n.y) shifted.set(n.id, p)
        obstacles.push({ ...rectOf(n), ...p })
      }
      if (shifted.size === 0) return next
      return { ...next, nodes: next.nodes.map((n) => (shifted.has(n.id) ? { ...n, ...shifted.get(n.id)! } : n)) }
    }

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
            edges: [...room.edges.values()],
            drafts: [...room.drafts.values()],
            displaced: displacementList(room.displaced),
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
          return room.drafts.delete(user.id)
            ? Effect.zipRight(broadcast(room, new DraftCleared({ userId: user.id })), relayout(room))
            : Effect.void
        })

        /** Build and broadcast the draft from what's known now; returns the pieces still waiting on Jev. */
        const render = (text: string, anchor: Point) =>
          Effect.suspend(() => {
            const me = self()
            if (!me) return Effect.succeed([])
            const r = interpret({ text, handles: [], peek: classifier.peek, memory: pieceMemory })
            pieceMemory = r.memory
            if (r.graph.nodes.length === 0) return Effect.as(clearDraft, [])
            const prev = room.memory.get(user.id)
            const memory = placeNewRoots(
              room,
              user.id,
              prev,
              materialize({ graph: r.graph, prev, anchor, user: me, newId: () => crypto.randomUUID() }),
            )
            const draft: Draft = { userId: user.id, text, nodes: memory.nodes, edges: memory.edges }
            room.memory.set(user.id, memory)
            room.drafts.set(user.id, draft)
            return broadcast(room, new DraftUpdated({ draft, debug: r.debug })).pipe(
              Effect.zipRight(relayout(room)),
              Effect.as(r.missing),
            )
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
            // Elements this draft pushed aside stay where they were pushed.
            const committedNow = [...room.nodes.values()]
            const pushed = pushAside({
              committed: committedNow,
              drafts: draft.nodes,
              sizes: estimateSizes([...committedNow, ...draft.nodes]),
            })
            const moved = [...pushed].map(([id, p]) => ({ ...room.nodes.get(id)!, x: p.x, y: p.y }))
            for (const n of moved) room.nodes.set(n.id, n)

            room.drafts.delete(user.id)
            room.memory.delete(user.id)
            for (const n of draft.nodes) room.nodes.set(n.id, n)
            for (const e of draft.edges) room.edges.set(e.id, e)
            yield* store.upsert(roomId, [...moved, ...draft.nodes], draft.edges)
            if (moved.length) yield* broadcast(room, new NodesUpdated({ nodes: moved }))
            yield* broadcast(room, new NodesCommitted({ nodes: draft.nodes, edges: draft.edges }))
            yield* broadcast(room, new DraftCleared({ userId: user.id }))
            yield* relayout(room)
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
              yield* relayout(room)
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
              const gone = new Set(ids)
              const edgeIds = [...room.edges.values()].filter((e) => gone.has(e.from) || gone.has(e.to)).map((e) => e.id)
              for (const e of edgeIds) room.edges.delete(e)
              yield* store.remove(roomId, ids, edgeIds)
              yield* broadcast(room, new NodesRemoved({ ids, edgeIds }))
              yield* relayout(room)
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
