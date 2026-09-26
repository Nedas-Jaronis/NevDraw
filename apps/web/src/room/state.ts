import type { ServerMessage, User } from "@rtw/shared"

export type ConnectionStatus = "connecting" | "open" | "reconnecting"

export type RoomState = {
  status: ConnectionStatus
  selfId: string | null
  users: ReadonlyMap<string, User>
}

export const initialRoomState: RoomState = { status: "connecting", selfId: null, users: new Map() }

/** Pure reducer from server messages to client room state. Welcome is a full resync. */
export function applyServerMessage(state: RoomState, msg: ServerMessage): RoomState {
  switch (msg._tag) {
    case "Welcome":
      return { status: "open", selfId: msg.selfId, users: new Map(msg.users.map((u) => [u.id, u])) }
    case "UserJoined": {
      const users = new Map(state.users)
      users.set(msg.user.id, msg.user)
      return { ...state, users }
    }
    case "UserLeft": {
      if (!state.users.has(msg.id)) return state
      const users = new Map(state.users)
      users.delete(msg.id)
      return { ...state, users }
    }
    case "CursorMoved": {
      const u = state.users.get(msg.id)
      if (!u) return state
      const users = new Map(state.users)
      users.set(msg.id, { ...u, cursor: msg.cursor })
      return { ...state, users }
    }
  }
}
