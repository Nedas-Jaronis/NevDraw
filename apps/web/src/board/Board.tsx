import { Commit, Discard, MoveCursor, type Point, SetInput, type User } from "@rtw/shared"
import { AnimatePresence } from "motion/react"
import { useEffect, useRef, useState } from "react"
import type { Identity } from "../identity.ts"
import { useRoom } from "../room/useRoom.ts"
import { InputBox } from "./InputBox.tsx"
import { RootView } from "./NodeView.tsx"
import { buildTree } from "./tree.ts"

/** Pan/zoom of this viewer. Identity for now; #4 makes it interactive. */
export type Camera = { x: number; y: number; zoom: number }

const toWorld = (cam: Camera, sx: number, sy: number): Point => ({ x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom })
const toScreen = (cam: Camera, p: Point): Point => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y })

export function Board({ roomId, identity }: { roomId: string; identity: Identity }) {
  const { state, send } = useRoom(roomId, identity)
  const [camera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const pending = useRef<Point | null | undefined>(undefined)
  const frame = useRef(0)

  // Coalesce pointer moves to one message per animation frame.
  const queueCursor = (p: Point | null) => {
    pending.current = p
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (pending.current !== undefined) send(new MoveCursor({ cursor: pending.current }))
      pending.current = undefined
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const others = [...state.users.values()].filter((u) => u.id !== state.selfId)
  const self = state.selfId ? state.users.get(state.selfId) : undefined
  const tree = buildTree(state)

  // New top-level drafts appear just above the input box, in this viewer's view.
  const anchor = () => toWorld(camera, window.innerWidth / 2, window.innerHeight / 2 - 60)

  return (
    <div
      className="board-grid fixed inset-0 touch-none select-none overflow-hidden"
      onPointerMove={(e) => queueCursor(toWorld(camera, e.clientX, e.clientY))}
      onPointerLeave={() => queueCursor(null)}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        <AnimatePresence>
          {tree.roots.map((item) => (
            <RootView key={item.node.id} item={item} tree={tree} />
          ))}
        </AnimatePresence>
      </div>
      {others.map((u) => u.cursor && <RemoteCursor key={u.id} user={u} at={toScreen(camera, u.cursor)} />)}
      <InputBox
        color={self?.color ?? identity.color}
        onChange={(text) => send(new SetInput({ text, anchor: anchor() }))}
        onCommit={() => send(new Commit())}
        onDiscard={() => send(new Discard())}
      />
      <TopBar roomId={roomId} users={[...state.users.values()]} selfId={state.selfId} status={state.status} />
    </div>
  )
}

function RemoteCursor({ user, at }: { user: User; at: Point }) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-50 transition-transform duration-75 ease-linear"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
        <path d="M2 2 L16 8 L9.5 9.5 L8 16 Z" fill={user.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span
        className="ml-3 -mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-white shadow"
        style={{ background: user.color }}
      >
        {user.name}
      </span>
    </div>
  )
}

function TopBar(props: { roomId: string; users: User[]; selfId: string | null; status: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (insecure context); the URL bar still works
    }
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-2 shadow-sm">
        <span className="whitespace-nowrap font-semibold">Live Wireframes</span>
        <span className="hidden text-sm text-[var(--muted)] sm:inline">/ {props.roomId}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-[var(--panel-border)] px-2 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        {props.status !== "open" && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            {props.status === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>
      <div className="pointer-events-auto flex -space-x-2" aria-label="People in this room">
        {props.users.map((u) => (
          <div
            key={u.id}
            title={u.id === props.selfId ? `${u.name} (you)` : u.name}
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--panel)] text-xs font-semibold text-white"
            style={{ background: u.color }}
          >
            {u.name.slice(0, 2).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  )
}
