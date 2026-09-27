import {
  type BoardEdge,
  type BoardNode,
  CursorMoved,
  type Displacement,
  LayoutUpdated,
  type Draft,
  DraftCleared,
  DraftUpdated,
  UserTyping,
  NodesCommitted,
  NodesRemoved,
  NodesUpdated,
  type Point,
  itemsOf,
  REGISTRY,
  isImageSrc,
  type ServerMessage,
  type Suggestion,
  SuggestionsUpdated,
  uniqueHandle,
  type User,
  UserJoined,
  UserLeft,
  Welcome,
} from "@rtw/shared"
import { Context, Deferred, Effect, Fiber, Layer, Queue } from "effect"
import { BoardStore } from "./BoardStore.ts"
import { Classifier } from "./classify/Classifier.ts"
import { envNumber } from "./env.ts"
import type { EntryGraph } from "@rtw/shared"
import type { BoardSummaryItem } from "./refine/prompt.ts"
import { Refiner } from "./refine/Refiner.ts"
import {
  type BoardView,
  type DraftMemory,
  type HandleInfo,
  interpret,
  keepComputed,
  referToExisting,
  materialize,
  type PieceMemory,
} from "./engine/index.ts"
import { avoid, estimateSizes, pushAside, type Rect } from "./engine/layout.ts"
import { mergeSuggestions, suggestLinks } from "./engine/suggest.ts"

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
  /** @handle → node id for every committed element. */
  handles: Map<string, string>
  /** Committed elements currently pushed aside by drafts (derived, never saved). */
  /** Per typist: the committed elements their own (private) draft is pushing aside. */
  displaced: Map<string, ReadonlyMap<string, { x: number; y: number }>>
  /** Resolves once the committed layer has been loaded from the store. */
  ready: Deferred.Deferred<void>
}


/** "Checkout Page", "@checkout page!" → "@checkout-page"; null when nothing's left. */

/** Words that ask for something to be removed; without one, removals are never applied. */
const REMOVAL = /\b(remove|delete|drop|get rid|without|no more|lose|erase|ditch|kill|clear|empty|blank|wipe|take (?:out|away)|take .+ out)\b/i

export const normalizeHandle = (raw: string): string | null => {
  const body = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
  return body ? `@${body}` : null
}

export type Session = {
  readonly selfId: string
  readonly moveCursor: (cursor: Point | null) => Effect.Effect<void>
  readonly setInput: (text: string, anchor: Point, target?: string) => Effect.Effect<void>
  readonly commit: Effect.Effect<void>
  readonly discard: Effect.Effect<void>
  readonly moveNode: (id: string, x: number, y: number, final: boolean) => Effect.Effect<void>
  readonly deleteNode: (id: string) => Effect.Effect<void>
  readonly setImage: (id: string, src: string | null) => Effect.Effect<void>
  readonly dropImage: (parent: string, src: string) => Effect.Effect<void>
  /** Give an element a new @handle; ignored when it's empty or taken. */
  readonly renameHandle: (id: string, handle: string) => Effect.Effect<void>
  /** Annotate an element ("" removes the note). */
  readonly setNote: (id: string, note: string) => Effect.Effect<void>
  /** Step back / forward through this person's draft versions (Instant → Jev → AI …). */
  readonly stepDraft: (delta: -1 | 1) => Effect.Effect<void>
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
    const refiner = yield* Refiner
    // Live probe 2026-09-26 (gpt-oss-120b on Cerebras): p50 ≈ 360–470 ms.
    const llmDebounce = envNumber("LLM_DEBOUNCE_MS") ?? 900
    const commitWait = envNumber("LLM_COMMIT_WAIT_MS") ?? 2500
    const rooms = new Map<string, Room>()

    const broadcast = (room: Room, msg: ServerMessage, exceptId?: string) =>
      Effect.forEach(
        [...room.clients.values()].filter((c) => c.user.id !== exceptId),
        (c) => Queue.offer(c.outbox, msg),
        { discard: true },
      )

    /** To one person only (their own draft, suggestions, layout). */
    const sendTo = (room: Room, userId: string, msg: ServerMessage) =>
      Effect.suspend(() => {
        const c = room.clients.get(userId)
        return c ? Queue.offer(c.outbox, msg) : Effect.void
      })

    const displacementList = (m: ReadonlyMap<string, { x: number; y: number }>): Displacement[] =>
      [...m].map(([id, p]) => ({ id, x: p.x, y: p.y }))

    /**
     * Drafts are private: each typist sees committed elements make room for their own draft,
     * nobody else sees anything move. Recompute per person; send only when it changes.
     */
    const relayout = (room: Room) =>
      Effect.forEach(
        [...room.clients.keys()],
        (userId) =>
          Effect.suspend(() => {
            const committed = [...room.nodes.values()]
            const drafts = room.drafts.get(userId)?.nodes ?? []
            const next = drafts.length ? pushAside({ committed, drafts, sizes: estimateSizes([...committed, ...drafts]) }) : new Map()
            const prev = room.displaced.get(userId) ?? new Map()
            const same = next.size === prev.size && [...next].every(([id, p]) => {
              const q = prev.get(id)
              return q !== undefined && q.x === p.x && q.y === p.y
            })
            if (same) return Effect.void
            room.displaced.set(userId, next)
            return sendTo(room, userId, new LayoutUpdated({ displaced: displacementList(next) }))
          }),
        { discard: true },
      )

    /**
     * Give every node without a handle a unique, readable one, register it,
     * and return the nodes that changed. Handles never change afterwards.
     */
    const withHandles = (room: Room, nodes: readonly BoardNode[]): BoardNode[] => {
      for (const n of nodes) if (n.handle) room.handles.set(n.handle, n.id)
      const changed: BoardNode[] = []
      for (const n of nodes) {
        if (n.handle) continue
        const handle = uniqueHandle(n.label, n.type, new Set(room.handles.keys()))
        const named = { ...n, handle }
        room.handles.set(handle, n.id)
        room.nodes.set(n.id, named)
        changed.push(named)
      }
      return changed
    }

    const boardView = (room: Room): BoardView => {
      const byHandle = new Map<string, BoardNode>()
      for (const [h, id] of room.handles) {
        const n = room.nodes.get(id)
        if (n) byHandle.set(h, n)
      }
      return { byHandle, byId: room.nodes, edges: room.edges }
    }

    /** What the LLM may reference: committed elements with their handles. */
    const boardSummary = (room: Room): BoardSummaryItem[] => {
      const handleOf = (id: string | null) => (id ? (room.nodes.get(id)?.handle ?? null) : null)
      return [...room.nodes.values()]
        .filter((n) => n.handle)
        .slice(0, 200)
        .map((n) => ({ handle: n.handle!, type: n.type, label: n.label, parent: handleOf(n.parent), order: n.order }))
    }

    const handleInfo = (room: Room): HandleInfo => {
      const info = new Map<string, { container: boolean; type: BoardNode["type"]; label: string; parent: string | null; items?: string[] }>()
      for (const [h, id] of room.handles) {
        const n = room.nodes.get(id)
        const parent = n?.parent ? (room.nodes.get(n.parent)?.handle ?? null) : null
        const items = n ? itemsOf(n) : null
        if (n) info.set(h, { container: REGISTRY[n.type].container, type: n.type, label: n.label, parent, ...(items ? { items } : {}) })
      }
      return info
    }

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
          handles: new Map(),
          ready,
        }
        rooms.set(roomId, room)
        const saved = yield* store.load(roomId)
        for (const n of saved.nodes) room.nodes.set(n.id, n)
        for (const e of saved.edges) room.edges.set(e.id, e)
        // Boards saved before @handles existed get theirs now (once, permanently).
        const named = withHandles(room, saved.nodes)
        if (named.length) yield* store.upsert(roomId, named)
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
        const user: User = { id: crypto.randomUUID(), name: profile.name, color: profile.color, cursor: null, typing: false }
        room.clients.set(user.id, { user, outbox })

        yield* Queue.offer(
          outbox,
          new Welcome({
            selfId: user.id,
            users: [...room.clients.values()].map((c) => c.user),
            nodes: [...room.nodes.values()],
            edges: [...room.edges.values()],
            // Drafts are private to their typist; a newcomer has none yet.
            drafts: [],
            displaced: [],
          }),
        )
        yield* broadcast(room, new UserJoined({ user }), user.id)

        const self = () => room.clients.get(user.id)?.user

        /** Tell everyone else when this person starts or stops typing (never what). */
        const setTyping = (typing: boolean) =>
          Effect.suspend(() => {
            const c = room.clients.get(user.id)
            if (!c || c.user.typing === typing) return Effect.void
            c.user = { ...c.user, typing }
            return broadcast(room, new UserTyping({ id: user.id, typing }), user.id)
          })

        // Per-typist state: piece hysteresis, the in-flight Jev fetch, and the latest input.
        let pieceMemory: ReadonlyMap<number, PieceMemory> = new Map()
        let inflight: Fiber.RuntimeFiber<void> | null = null
        let latest: { text: string; anchor: Point } | null = null
        /** The element this person clicked (its id): what they type edits it. */
        let targetId: string | null = null
        /**
         * Every distinct reading of this draft so far (instant, Jev's, the AI's; typing adds
         * more), so the typist can step back and forth before Enter. Consecutive readings
         * from the same pass collapse into one (typing doesn't make a version per key).
         */
        let versions: Array<{ graph: EntryGraph; source: "Instant" | "Jev" | "AI"; sig: string }> = []
        /** The version being viewed; null = the latest. */
        let viewing: number | null = null
        const targetHandle = () => (targetId ? (room.nodes.get(targetId)?.handle ?? null) : null)
        // The LLM cleanup pass: its pending fiber, and its result for one exact text.
        let llmFiber: Fiber.RuntimeFiber<void> | null = null
        let llmResult: { text: string; graph: EntryGraph } | null = null
        /** The LLM request in flight and the text it's for: Enter waits for it instead of starting over. */
        let refining: { text: string; result: Deferred.Deferred<EntryGraph | null> } | null = null
        /** The last render parsed an explicit command (edit / wrap / include): no LLM rewrite. */
        let explicitCommand = false
        /** The instant (Jev/keyword) graph last shown, so the LLM can keep its keys. */
        let lastGraph: EntryGraph | null = null
        /** Top-level handles of this person's recent commits, newest last: what "them" means. */
        const recentCommits: string[][] = []
        const recentHandles = () => {
          const out: string[] = []
          for (let i = recentCommits.length - 1; i >= 0 && out.length < 2; i--) out.unshift(...recentCommits[i]!)
          return out.filter((h) => room.handles.has(h)).slice(-6)
        }
        /** Link suggestions last sent to this typist (only they see them). */
        let lastSuggestions = "[]"
        /** What this typist's draft looked like when last broadcast. */
        let lastDraftSignature = ""
        const jevDebounce = envNumber("JEV_DEBOUNCE_MS") ?? 120

        const sendSuggestions = (list: readonly Suggestion[]) =>
          Effect.suspend(() => {
            const json = JSON.stringify(list)
            if (json === lastSuggestions) return Effect.void
            lastSuggestions = json
            const c = room.clients.get(user.id)
            return c ? Queue.offer(c.outbox, new SuggestionsUpdated({ suggestions: list })) : Effect.void
          })

        const cancelInflight = Effect.suspend(() => {
          const f = inflight
          const l = llmFiber
          inflight = null
          llmFiber = null
          return Effect.all([f ? Fiber.interruptFork(f) : Effect.void, l ? Fiber.interruptFork(l) : Effect.void], { discard: true })
        })

        const refine = (text: string) =>
          refiner.refine({
            text,
            board: boardSummary(room),
            recent: recentHandles(),
            draft: (lastGraph?.nodes ?? []).map((n) => ({ key: n.key, type: n.type, label: n.label, parent: n.parent })),
            target: targetHandle(),
          })

        /** One LLM request whose answer anyone can wait on (null when it fails or is cancelled). */
        const refineShared = (text: string) =>
          Effect.gen(function* () {
            const result = yield* Deferred.make<EntryGraph | null>()
            refining = { text, result }
            const graph = yield* refine(text).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
              Effect.onInterrupt(() => Deferred.succeed(result, null)),
            )
            yield* Deferred.succeed(result, graph)
            return graph
          })

        /** Drop this person's draft; `typing` = they're still typing (a fragment that means nothing yet). */
        const clearDraftWith = (typing: boolean) => Effect.suspend(() => {
          const stopTyping = typing ? Effect.void : setTyping(false)
          versions = []
          viewing = null
          pieceMemory = new Map()
          latest = null
          llmResult = null
          lastGraph = null
          room.memory.delete(user.id)
          const hadSuggestions = lastSuggestions !== "[]"
          const clearSuggestions = hadSuggestions ? sendSuggestions([]) : Effect.void
          return room.drafts.delete(user.id)
            ? Effect.all([sendTo(room, user.id, new DraftCleared({ userId: user.id })), relayout(room), clearSuggestions, stopTyping], { discard: true })
            : Effect.all([clearSuggestions, stopTyping], { discard: true })
        })
        const clearDraft = clearDraftWith(false)

        /** Build and broadcast the draft from what's known now; returns the pieces still waiting on Jev. */
        const render = (text: string, anchor: Point) =>
          Effect.suspend(() => {
            const me = self()
            if (!me) return Effect.succeed([])
            const r = interpret({
              text,
              handles: handleInfo(room),
              recent: recentHandles(),
              peek: classifier.peek,
              memory: pieceMemory,
              target: targetHandle(),
            })
            pieceMemory = r.memory
            lastGraph = r.graph
            // Explicit commands on @handles (edits, wrap, include) are parsed by code and stay
            // deterministic; otherwise the LLM's reading of this exact text wins over the instant one.
            explicitCommand = r.graph.patches.length > 0 || r.command
            const fromLlm = llmResult?.text === text && !explicitCommand ? keepComputed(llmResult.graph, r.graph) : null
            const graph = referToExisting(
              // The AI never removes anything the text didn't ask to remove.
              fromLlm && !REMOVAL.test(text) ? { ...fromLlm, patches: fromLlm.patches.filter((p) => !p.remove) } : (fromLlm ?? r.graph),
              handleInfo(room),
              text,
            )
            const source = llmResult?.text === text && !explicitCommand ? "AI" : r.debug.some((d) => d.source === "jev") ? "Jev" : "Instant"
            if (graph.nodes.length || graph.edges.length || graph.patches.length) {
              const sig = JSON.stringify([graph.nodes.map((n) => [n.key, n.type, n.label, n.parent, n.props]), graph.edges, graph.patches])
              const last = versions.at(-1)
              if (last?.sig !== sig) {
                if (last && last.source === source && viewing === null) versions[versions.length - 1] = { graph, source, sig }
                else versions.push({ graph, source, sig })
                if (versions.length > 30) {
                  versions.shift()
                  if (viewing !== null) viewing = Math.max(0, viewing - 1)
                }
              }
            }
            // Jev's reading (or the instant one) is what shows; the AI's is an alternative the typist can step to.
            const autoIndex = versions.findLastIndex((v) => v.source !== "AI")
            const index = viewing ?? (autoIndex >= 0 ? autoIndex : versions.length - 1)
            const viewed = versions[index]
            const shown = viewed?.graph ?? graph
            if (shown.nodes.length === 0 && shown.edges.length === 0 && shown.patches.length === 0) return Effect.as(clearDraftWith(true), [])
            const prev = room.memory.get(user.id)
            const memory = placeNewRoots(
              room,
              user.id,
              prev,
              materialize({ graph: shown, prev, anchor, user: me, newId: () => crypto.randomUUID(), board: boardView(room) }),
            )
            const history = { at: index + 1, total: versions.length, source: viewed?.source ?? source }
            const draft: Draft = { userId: user.id, text, nodes: memory.nodes, edges: memory.edges, patches: memory.patches, history }
            room.memory.set(user.id, memory)
            const known = new Set(room.handles.keys())
            const named = [...room.nodes.values()].flatMap((n) => (n.handle ? [{ handle: n.handle, label: n.label }] : []))
            const suggestions = mergeSuggestions(known, graph.suggestions, suggestLinks(r.pieces, named)).filter(
              (x) => !text.toLowerCase().includes(x.handle),
            )
            // Only send what changed: identical drafts (a Jev answer that agrees, a no-op keystroke) aren't re-sent.
            // What people see: the text (typing indicator) and the elements. Which classifier answered doesn't count.
            const signature = JSON.stringify([text, draft.nodes, draft.edges, draft.patches, history])
            const unchanged = signature === lastDraftSignature
            lastDraftSignature = signature
            room.drafts.set(user.id, draft)
            if (unchanged) return Effect.as(sendSuggestions(suggestions), r.missing)
            // Only the typist sees their draft; everyone else sees it once it's committed.
            return sendTo(room, user.id, new DraftUpdated({ draft, debug: r.debug })).pipe(
              Effect.zipRight(relayout(room)),
              Effect.zipRight(sendSuggestions(suggestions)),
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

          setInput: (text, anchor, target) =>
            Effect.gen(function* () {
              // A new target reads the text afresh (and the LLM's old reading no longer applies).
              const nextTarget = target && room.nodes.has(target) ? target : null
              if (nextTarget !== targetId) {
                targetId = nextTarget
                llmResult = null
                pieceMemory = new Map()
              }
              yield* cancelInflight
              if (!self()) return
              if (!text.trim()) return yield* clearDraft
              yield* setTyping(true)
              // Typing goes back to the latest reading.
              if (latest?.text !== text) viewing = null
              latest = { text, anchor }
              if (llmResult?.text !== text) llmResult = null
              const missing = yield* render(text, anchor)
              const stillLatest = (then: Effect.Effect<unknown>) => Effect.suspend(() => (latest?.text === text ? then : Effect.void))
              if (missing.length > 0 && classifier.enabled) {
                // Jev answers arrive async: re-render with them only if this is still the latest input.
                // Ask Jev after a short pause (like Shapeshift's 120 ms), not on every character.
                inflight = yield* Effect.fork(
                  Effect.asVoid(
                    Effect.sleep(jevDebounce).pipe(
                      Effect.zipRight(classifier.fetch(missing)),
                      Effect.zipRight(stillLatest(render(text, anchor))),
                    ),
                  ),
                )
              }
              // The AI only reads text that already means something (not "c" or a half-typed @c).
              const meaningful = !!lastGraph && lastGraph.nodes.length + lastGraph.edges.length + lastGraph.patches.length > 0
              if (refiner.enabled && llmResult === null && !explicitCommand && meaningful) {
                // After a longer pause, the LLM cleans up what Jev can't (pronouns, chains, phrasing).
                llmFiber = yield* Effect.fork(
                  Effect.sleep(llmDebounce).pipe(
                    Effect.zipRight(refineShared(text)),
                    Effect.flatMap((graph) =>
                      stillLatest(
                        Effect.suspend(() => {
                          if (!graph) return Effect.void
                          llmResult = { text, graph }
                          return render(text, anchor)
                        }),
                      ),
                    ),
                    Effect.catchAll(() => Effect.void),
                    Effect.asVoid,
                  ),
                )
              }
            }),

          commit: Effect.gen(function* () {
            // Enter commits exactly the version showing (Jev's by default, or the one stepped to).
            yield* cancelInflight
            versions = []
            viewing = null
            pieceMemory = new Map()
            latest = null
            llmResult = null
            lastGraph = null
            yield* sendSuggestions([])
            const draft = room.drafts.get(user.id)
            // An entry can be only arrows ("connect them together").
            if (!draft || (draft.nodes.length === 0 && draft.edges.length === 0 && draft.patches.length === 0)) return yield* setTyping(false)
            lastDraftSignature = ""
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
            const committed = withHandles(room, draft.nodes)
            const tops = committed.filter((n) => n.parent === null && n.handle).map((n) => n.handle!)
            if (tops.length) recentCommits.push(tops)
            // Changes to existing elements: recolor, rename, retype, move into a container.
            const nextOrder = (parent: string | null) =>
              [...room.nodes.values()].filter((n) => n.parent === parent).reduce((m, n) => Math.max(m, n.order + 1), 0)
            const patched: BoardNode[] = []
            const unlinked: string[] = []
            /** Where a nested element sits on the canvas: its top-level ancestor's spot. */
            const rootOf = (n: BoardNode) => {
              let cur = n
              for (let hops = 0; cur.parent !== null && hops < 64; hops++) cur = room.nodes.get(cur.parent) ?? { ...cur, parent: null }
              return cur
            }
            // Removals first: the element and everything inside it, with their arrows.
            const removedIds: string[] = []
            for (const p of draft.patches) {
              if (!p.remove || !room.nodes.has(p.id)) continue
              const ids = [p.id]
              for (let i = 0; i < ids.length; i++) for (const c of room.nodes.values()) if (c.parent === ids[i]) ids.push(c.id)
              for (const d of ids) {
                const h = room.nodes.get(d)?.handle
                if (h) room.handles.delete(h)
                room.nodes.delete(d)
                removedIds.push(d)
              }
            }
            const removedSet = new Set(removedIds)
            const removedEdges = [...room.edges.values()].filter((e) => removedSet.has(e.from) || removedSet.has(e.to)).map((e) => e.id)
            for (const e of removedEdges) room.edges.delete(e)
            for (const p of draft.patches) {
              if (p.remove) continue
              const n = room.nodes.get(p.id)
              if (!n) continue
              if (p.unlink) {
                // A group stands for everything inside it, on either side ("disconnect @stack and @lb").
                const withInside = (id: string) => {
                  const out = new Set([id])
                  for (const cur of out) for (const c of room.nodes.values()) if (c.parent === cur) out.add(c.id)
                  return out
                }
                const mine = withInside(n.id)
                const theirs = p.unlink === "*" ? null : withInside(p.unlink)
                const hits = (id: string) => theirs === null || theirs.has(id)
                for (const e of room.edges.values())
                  if ((mine.has(e.from) && hits(e.to)) || (mine.has(e.to) && hits(e.from))) {
                    room.edges.delete(e.id)
                    unlinked.push(e.id)
                  }
              }
              if (p.detach && n.parent !== null) {
                // Out of its container, placed beside it (then the layout settles it).
                const root = rootOf(n)
                const next: BoardNode = { ...n, parent: null, order: 0, pinned: false, x: root.x + 380, y: root.y }
                room.nodes.set(n.id, next)
                patched.push(next)
                continue
              }
              const moving = p.parent !== undefined && p.parent !== n.parent && room.nodes.has(p.parent)
              const next: BoardNode = {
                ...n,
                ...(p.label ? { label: p.label } : {}),
                ...(p.type ? { type: p.type } : {}),
                props: {
                  ...n.props,
                  ...(p.color ? { color: p.color } : {}),
                  ...(p.note ? { note: p.note.slice(0, 2000) } : {}),
                  ...(p.items ? { items: p.items.slice(0, 12).map((x) => x.slice(0, 60)) } : {}),
                  ...(p.of ? { of: p.of } : {}),
                },
                ...(moving ? { parent: p.parent!, order: nextOrder(p.parent!) } : p.order !== undefined ? { order: p.order } : {}),
              }
              room.nodes.set(n.id, next)
              patched.push(next)
            }
            yield* store.upsert(roomId, [...moved, ...committed, ...patched], draft.edges)
            if (removedIds.length) {
              yield* store.remove(roomId, removedIds, removedEdges)
              yield* broadcast(room, new NodesRemoved({ ids: removedIds, edgeIds: removedEdges }))
            }
            if (unlinked.length) {
              yield* store.remove(roomId, [], unlinked)
              yield* broadcast(room, new NodesRemoved({ ids: [], edgeIds: unlinked }))
            }
            if (moved.length) yield* broadcast(room, new NodesUpdated({ nodes: moved }))
            yield* broadcast(room, new NodesCommitted({ nodes: committed, edges: draft.edges }))
            if (patched.length) yield* broadcast(room, new NodesUpdated({ nodes: patched }))
            yield* sendTo(room, user.id, new DraftCleared({ userId: user.id }))
            yield* setTyping(false)
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

          renameHandle: (id, wanted) =>
            Effect.gen(function* () {
              const n = room.nodes.get(id)
              const handle = normalizeHandle(wanted)
              if (!n || !handle || handle === n.handle) return
              const owner = room.handles.get(handle)
              if (owner !== undefined && owner !== id) return
              if (n.handle) room.handles.delete(n.handle)
              room.handles.set(handle, id)
              const next: BoardNode = { ...n, handle }
              room.nodes.set(id, next)
              yield* store.upsert(roomId, [next])
              yield* broadcast(room, new NodesUpdated({ nodes: [next] }))
            }),

          stepDraft: (delta) =>
            Effect.suspend(() => {
              if (versions.length < 2 || !latest) return Effect.void
              const auto = versions.findLastIndex((v) => v.source !== "AI")
              const from = viewing ?? (auto >= 0 ? auto : versions.length - 1)
              viewing = Math.min(versions.length - 1, Math.max(0, from + delta))
              return Effect.asVoid(render(latest.text, latest.anchor))
            }),

          setNote: (id, note) =>
            Effect.gen(function* () {
              const n = room.nodes.get(id)
              if (!n) return
              const text = note.trim().slice(0, 2000)
              const { note: _old, ...rest } = n.props
              const next: BoardNode = { ...n, props: text ? { ...rest, note: text } : rest }
              room.nodes.set(id, next)
              yield* store.upsert(roomId, [next])
              yield* broadcast(room, new NodesUpdated({ nodes: [next] }))
            }),

          setImage: (id, src) =>
            Effect.gen(function* () {
              const n = room.nodes.get(id)
              if (!n || (src !== null && !isImageSrc(src))) return
              const { src: _old, ...rest } = n.props
              const next: BoardNode = { ...n, props: src === null ? rest : { ...rest, src } }
              room.nodes.set(id, next)
              yield* store.upsert(roomId, [next])
              yield* broadcast(room, new NodesUpdated({ nodes: [next] }))
            }),

          dropImage: (parentId, src) =>
            Effect.gen(function* () {
              const parent = room.nodes.get(parentId)
              const me = self()
              if (!parent || !me || !isImageSrc(src)) return
              const order = [...room.nodes.values()].filter((n) => n.parent === parentId).reduce((m, n) => Math.max(m, n.order + 1), 0)
              const image: BoardNode = {
                id: crypto.randomUUID(),
                type: "image",
                label: "Image",
                parent: parentId,
                order,
                props: { src },
                x: 0,
                y: 0,
                pinned: false,
                authorId: me.id,
                authorColor: me.color,
              }
              room.nodes.set(image.id, image)
              const [named] = withHandles(room, [image])
              const saved = named ?? image
              yield* store.upsert(roomId, [saved])
              yield* broadcast(room, new NodesCommitted({ nodes: [saved], edges: [] }))
              yield* relayout(room)
            }),

          deleteNode: (id) =>
            Effect.gen(function* () {
              if (!room.nodes.has(id)) return
              const ids = [id]
              for (let i = 0; i < ids.length; i++) {
                for (const n of room.nodes.values()) if (n.parent === ids[i]) ids.push(n.id)
              }
              for (const d of ids) {
                const h = room.nodes.get(d)?.handle
                if (h) room.handles.delete(h)
                room.nodes.delete(d)
              }
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
            room.displaced.delete(user.id)
            yield* broadcast(room, new UserLeft({ id: user.id }))
            if (room.clients.size === 0) rooms.delete(roomId)
          }),
        }
        return session
      })

    return { join }
  }),
)
