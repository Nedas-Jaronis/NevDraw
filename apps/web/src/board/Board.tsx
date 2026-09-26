import { type BoardNode, Commit, DeleteNode, Discard, MoveCursor, MoveNode, NodesUpdated, type Point, SetInput, type User } from "@rtw/shared"
import { AnimatePresence } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Identity } from "../identity.ts"
import { useRoom } from "../room/useRoom.ts"
import { type Camera, panBy, pinch, toScreen, toWorld, zoomAt } from "./camera.ts"
import { InputBox } from "./InputBox.tsx"
import { RootView } from "./NodeView.tsx"
import { DebugPanel } from "./DebugPanel.tsx"
import { buildTree } from "./tree.ts"

const DEBUG = new URLSearchParams(location.search).has("debug")

const CLICK_SLOP = 4

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; startCam: Camera; start: Point; moved: boolean }
  | { kind: "drag"; id: string; start: Point; origin: Point; moved: boolean }
  | { kind: "pinch"; start: { cam: Camera; a: Point; b: Point } }

/** At most one call per animation frame for a stream of values (the latest wins). */
function useFrameThrottle<T>(flush: (v: T) => void) {
  const pending = useRef<{ v: T } | null>(null)
  const frame = useRef(0)
  const latestFlush = useRef(flush)
  latestFlush.current = flush
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return (v: T) => {
    pending.current = { v }
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (pending.current) latestFlush.current(pending.current.v)
      pending.current = null
    })
  }
}

export function Board({ roomId, identity }: { roomId: string; identity: Identity }) {
  const { state, send, applyLocal } = useRoom(roomId, identity)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const cam = useRef(camera)
  cam.current = camera
  const [selected, setSelected] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null)
  const dragRef = useRef(dragPos)
  dragRef.current = dragPos
  const boardRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture>({ kind: "none" })

  const queueCursor = useFrameThrottle((p: Point | null) => send(new MoveCursor({ cursor: p })))
  const queueMove = useFrameThrottle((m: { id: string; x: number; y: number }) => send(new MoveNode({ ...m, final: false })))

  const others = [...state.users.values()].filter((u) => u.id !== state.selfId)
  const self = state.selfId ? state.users.get(state.selfId) : undefined
  const color = self?.color ?? identity.color

  // The element being dragged follows the pointer locally; everyone else gets per-frame updates.
  const tree = useMemo(() => {
    const t = buildTree(state)
    if (!dragPos) return t
    return {
      ...t,
      roots: t.roots.map((r) => (r.node.id === dragPos.id ? { ...r, node: { ...r.node, x: dragPos.x, y: dragPos.y } } : r)),
    }
  }, [state, dragPos])

  useEffect(() => {
    if (selected && !state.nodes.has(selected)) setSelected(null)
  }, [selected, state.nodes])

  // New top-level drafts appear just above the input box, in this viewer's view.
  const anchor = () => toWorld(camera, window.innerWidth / 2, window.innerHeight / 2 - 60)

  // Wheel pans; trackpad pinch arrives as ctrl+wheel and zooms. Non-passive to stop browser zoom.
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest("[data-ui]")) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // Mouse wheels send ~100 per notch, trackpad pinches a few units: clamp so both feel smooth.
        const d = Math.max(-40, Math.min(40, e.deltaY))
        setCamera((c) => zoomAt(c, e.clientX, e.clientY, c.zoom * Math.exp(-d * 0.006)))
      }
      else setCamera((c) => panBy(c, -e.deltaX, -e.deltaY))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Delete / Backspace removes the selected element (unless typing); Esc deselects.
  // Typing a character while the canvas has focus jumps back into the input box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (document.activeElement as HTMLElement | null)?.tagName === "INPUT"
      if (typing) return
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        document.getElementById("board-input")?.focus()
        return
      }
      if (!selected) return
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        send(new DeleteNode({ id: selected }))
        setSelected(null)
      } else if (e.key === "Escape") setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, send])

  const committedRoot = (target: EventTarget | null): BoardNode | null => {
    const id = (target as Element | null)?.closest?.("[data-root-id]")?.getAttribute("data-root-id")
    const n = id ? state.nodes.get(id) : undefined
    return n && n.parent === null ? n : null
  }

  const finishDrag = (g: Extract<Gesture, { kind: "drag" }>) => {
    const pos = dragRef.current
    if (!g.moved || !pos) return
    send(new MoveNode({ id: g.id, x: pos.x, y: pos.y, final: true }))
    const n = state.nodes.get(g.id)
    if (n) applyLocal(new NodesUpdated({ nodes: [{ ...n, x: Math.round(pos.x), y: Math.round(pos.y), pinned: true }] }))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-ui]")) return
    // Clicking the canvas takes focus out of the input, so Delete / Esc act on the board.
    ;(document.activeElement as HTMLElement | null)?.blur()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const g = gesture.current
      if (g.kind === "drag") finishDrag(g)
      setDragPos(null)
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      gesture.current = { kind: "pinch", start: { cam: cam.current, a, b } }
      return
    }
    if (pointers.current.size > 2) return

    const node = committedRoot(e.target)
    const start = { x: e.clientX, y: e.clientY }
    gesture.current = node
      ? { kind: "drag", id: node.id, start, origin: { x: node.x, y: node.y }, moved: false }
      : { kind: "pan", startCam: cam.current, start, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    queueCursor(toWorld(cam.current, e.clientX, e.clientY))
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current

    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      if (a && b) setCamera(pinch(g.start, a, b))
      return
    }
    if (g.kind === "none") return
    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y
    if (!g.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    g.moved = true

    if (g.kind === "pan") setCamera(panBy(g.startCam, dx, dy))
    else {
      const pos = { id: g.id, x: g.origin.x + dx / cam.current.zoom, y: g.origin.y + dy / cam.current.zoom }
      setDragPos(pos)
      queueMove(pos)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g.kind === "drag") {
      finishDrag(g)
      if (!g.moved) setSelected(g.id)
    } else if (g.kind === "pan" && !g.moved) setSelected(null)
    setDragPos(null)
    gesture.current = { kind: "none" }
    // Lifting one finger of a pinch shouldn't turn the other into a jumpy pan.
    pointers.current.clear()
  }

  return (
    <div
      ref={boardRef}
      className="board-grid fixed inset-0 touch-none select-none overflow-hidden"
      style={{
        backgroundSize: `${22 * camera.zoom}px ${22 * camera.zoom}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => queueCursor(null)}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        <AnimatePresence>
          {tree.roots.map((item) => (
            <RootView
              key={item.node.id}
              item={item}
              tree={tree}
              selected={selected === item.node.id}
              dragging={dragPos?.id === item.node.id}
              accent={color}
              onDelete={() => {
                send(new DeleteNode({ id: item.node.id }))
                setSelected(null)
              }}
            />
          ))}
        </AnimatePresence>
      </div>
      {others.map((u) => u.cursor && <RemoteCursor key={u.id} user={u} at={toScreen(camera, u.cursor)} />)}
      <ZoomControls zoom={camera.zoom} onZoom={(z) => setCamera((c) => zoomAt(c, window.innerWidth / 2, window.innerHeight / 2, z))} />
      <InputBox
        color={color}
        onChange={(text) => send(new SetInput({ text, anchor: anchor() }))}
        onCommit={() => send(new Commit())}
        onDiscard={() => send(new Discard())}
      />
      {DEBUG && <DebugPanel pieces={(state.selfId && state.debug.get(state.selfId)) || []} />}
      <TopBar roomId={roomId} users={[...state.users.values()]} selfId={state.selfId} status={state.status} />
    </div>
  )
}

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
  return (
    <div
      data-ui
      className="absolute bottom-[104px] left-3 z-40 flex items-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-0.5 shadow-sm sm:bottom-3"
    >
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => onZoom(zoom / 1.2)}>
        −
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        className="h-8 min-w-12 rounded-lg px-1 text-xs tabular-nums text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => onZoom(1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => onZoom(zoom * 1.2)}>
        +
      </button>
    </div>
  )
}

function RemoteCursor({ user, at }: { user: User; at: Point }) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-30 transition-transform duration-75 ease-linear"
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
      <div
        data-ui
        className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-2 shadow-sm"
      >
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
      <div data-ui className="pointer-events-auto flex -space-x-2" aria-label="People in this room">
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
