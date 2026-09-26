import type { BoardEdge, BoardNode, Draft, PieceDebug, ServerMessage, Suggestion, User } from "@rtw/shared"

export type ConnectionStatus = "connecting" | "open" | "reconnecting"

export type RoomState = {
  status: ConnectionStatus
  selfId: string | null
  users: ReadonlyMap<string, User>
  /** Committed layer. */
  nodes: ReadonlyMap<string, BoardNode>
  edges: ReadonlyMap<string, BoardEdge>
  /** Draft layer, keyed by the typing user's id. */
  drafts: ReadonlyMap<string, Draft>
  /** Committed elements drafts are currently pushing aside (derived by the server). */
  displaced: ReadonlyMap<string, { x: number; y: number }>
  /** "link to @x?" chips for this user's own input (the server sends them only to us). */
  suggestions: readonly Suggestion[]
  /** How each draft's pieces were classified (for ?debug=1), keyed by user id. */
  debug: ReadonlyMap<string, readonly PieceDebug[]>
}

export const initialRoomState: RoomState = {
  status: "connecting",
  selfId: null,
  users: new Map(),
  nodes: new Map(),
  edges: new Map(),
  drafts: new Map(),
  displaced: new Map(),
  suggestions: [],
  debug: new Map(),
}

const withEntry = <K, V>(m: ReadonlyMap<K, V>, k: K, v: V) => new Map(m).set(k, v)
const without = <K, V>(m: ReadonlyMap<K, V>, k: K) => {
  if (!m.has(k)) return m
  const next = new Map(m)
  next.delete(k)
  return next
}

/** Pure reducer from server messages to client room state. Welcome is a full resync. */
export function applyServerMessage(state: RoomState, msg: ServerMessage): RoomState {
  switch (msg._tag) {
    case "Welcome":
      return {
        status: "open",
        selfId: msg.selfId,
        users: new Map(msg.users.map((u) => [u.id, u])),
        nodes: new Map(msg.nodes.map((n) => [n.id, n])),
        edges: new Map(msg.edges.map((e) => [e.id, e])),
        drafts: new Map(msg.drafts.map((d) => [d.userId, d])),
        displaced: new Map(msg.displaced.map((d) => [d.id, { x: d.x, y: d.y }])),
        suggestions: [],
        debug: new Map(),
      }
    case "UserJoined":
      return { ...state, users: withEntry(state.users, msg.user.id, msg.user) }
    case "UserLeft": {
      const users = without(state.users, msg.id)
      return users === state.users ? state : { ...state, users }
    }
    case "CursorMoved": {
      const u = state.users.get(msg.id)
      if (!u) return state
      return { ...state, users: withEntry(state.users, msg.id, { ...u, cursor: msg.cursor }) }
    }
    case "DraftUpdated":
      return {
        ...state,
        drafts: withEntry(state.drafts, msg.draft.userId, msg.draft),
        debug: msg.debug ? withEntry(state.debug, msg.draft.userId, msg.debug) : state.debug,
      }
    case "DraftCleared": {
      const drafts = without(state.drafts, msg.userId)
      return drafts === state.drafts ? state : { ...state, drafts, debug: without(state.debug, msg.userId) }
    }
    case "NodesCommitted": {
      const nodes = new Map(state.nodes)
      for (const n of msg.nodes) nodes.set(n.id, n)
      const edges = new Map(state.edges)
      for (const e of msg.edges) edges.set(e.id, e)
      return { ...state, nodes, edges }
    }
    case "NodesUpdated": {
      const nodes = new Map(state.nodes)
      for (const n of msg.nodes) nodes.set(n.id, n)
      return { ...state, nodes }
    }
    case "SuggestionsUpdated":
      return { ...state, suggestions: msg.suggestions }
    case "LayoutUpdated":
      return { ...state, displaced: new Map(msg.displaced.map((d) => [d.id, { x: d.x, y: d.y }])) }
    case "NodesRemoved": {
      const nodes = new Map(state.nodes)
      for (const id of msg.ids) nodes.delete(id)
      const edges = new Map(state.edges)
      for (const id of msg.edgeIds) edges.delete(id)
      return { ...state, nodes, edges }
    }
  }
}
