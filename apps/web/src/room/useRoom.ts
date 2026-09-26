import { type ClientMessage, decodeServerMessage, encodeClientMessage, Join } from "@rtw/shared"
import { Either } from "effect"
import { useCallback, useEffect, useReducer, useRef } from "react"
import type { Identity } from "../identity.ts"
import { applyServerMessage, initialRoomState, type RoomState } from "./state.ts"

type Action = { type: "server"; msg: Parameters<typeof applyServerMessage>[1] } | { type: "status"; status: RoomState["status"] }

function reducer(state: RoomState, action: Action): RoomState {
  if (action.type === "status") return { ...state, status: action.status }
  return applyServerMessage(state, action.msg)
}

function socketUrl(roomId: string) {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${location.host}/ws/${encodeURIComponent(roomId)}`
}

/**
 * One WebSocket per room with automatic reconnect (exponential backoff with
 * jitter). Every (re)connect re-sends Join, and the server's Welcome resyncs
 * the full room state.
 */
export function useRoom(roomId: string, identity: Identity) {
  const [state, dispatch] = useReducer(reducer, initialRoomState)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const connect = () => {
      const ws = new WebSocket(socketUrl(roomId))
      wsRef.current = ws
      ws.onopen = () => {
        attempt = 0
        ws.send(encodeClientMessage(new Join(identity)))
      }
      ws.onmessage = (e) => {
        const msg = decodeServerMessage(String(e.data))
        if (Either.isRight(msg)) dispatch({ type: "server", msg: msg.right })
      }
      ws.onclose = () => {
        if (disposed) return
        dispatch({ type: "status", status: "reconnecting" })
        const delay = Math.min(500 * 2 ** attempt++, 5000) * (0.75 + Math.random() * 0.5)
        timer = setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      disposed = true
      clearTimeout(timer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [roomId, identity])

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(encodeClientMessage(msg))
  }, [])

  return { state, send }
}
