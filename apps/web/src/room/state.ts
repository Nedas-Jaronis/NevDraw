import type { BoardNode, Draft, ServerMessage, User } from "@rtw/shared"

export type ConnectionStatus = "connecting" | "open" | "reconnecting"

export type RoomState = {
  status: ConnectionStatus
  selfId: string | null
  users: ReadonlyMap<string, User>
  /** Committed layer. */
  nodes: ReadonlyMap<string, BoardNode>
  /** Draft layer, keyed by the typing user's id. */
  drafts: ReadonlyMap<string, Draft>
}

export const initialRoomState: RoomState = {
  status: "connecting",
  selfId: null,
  users: new Map(),
  nodes: new Map(),
  drafts: new Map(),
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
        drafts: new Map(msg.drafts.map((d) => [d.userId, d])),
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
      return { ...state, drafts: withEntry(state.drafts, msg.draft.userId, msg.draft) }
    case "DraftCleared": {
      const drafts = without(state.drafts, msg.userId)
      return drafts === state.drafts ? state : { ...state, drafts }
    }
    case "NodesCommitted": {
      const nodes = new Map(state.nodes)
      for (const n of msg.nodes) nodes.set(n.id, n)
      return { ...state, nodes }
    }
  }
}
