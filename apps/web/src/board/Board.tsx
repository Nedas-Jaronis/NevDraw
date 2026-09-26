import {
  type BoardNode,
  Commit,
  DeleteNode,
  Discard,
  MoveCursor,
  MoveNode,
  NodesUpdated,
  type Point,
  SetImage,
  SetInput,
  type User,
} from "@rtw/shared"
import { AnimatePresence } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Identity } from "../identity.ts"
import { useRoom } from "../room/useRoom.ts"
import { type Camera, panBy, pinch, toScreen, toWorld, zoomAt } from "./camera.ts"
import { InputBox } from "./InputBox.tsx"
import { BoardActions } from "./images.tsx"
import { HighlightContext, RootView } from "./NodeView.tsx"
import { DebugPanel } from "./DebugPanel.tsx"
import { EdgeLayer } from "./EdgeLayer.tsx"
import { buildTree } from "./tree.ts"
import { applyTheme, followSystem, loadTheme, type ThemePref } from "../theme.ts"

const DEBUG = new URLSearchParams(location.search).has("debug")

const CLICK_SLOP = 4

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; startCam: Camera; start: Point; moved: boolean }
  /** Moving one or more selected elements together. */
  | { kind: "drag"; clicked: string; ids: string[]; start: Point; origins: Map<string, Point>; moved: boolean; shift: boolean }
  /** Rubber-band selection on empty canvas. */
  | { kind: "marquee"; start: Point; base: ReadonlySet<string>; moved: boolean }
  | { kind: "pinch"; start: { cam: Camera; a: Point; b: Point } }

type Rect = { left: number; top: number; right: number; bottom: number }
const rectOf = (a: Point, b: Point): Rect => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  right: Math.max(a.x, b.x),
  bottom: Math.max(a.y, b.y),
})
const touches = (r: Rect, d: DOMRect) => d.left < r.right && d.right > r.left && d.top < r.bottom && d.bottom > r.top

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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  /** Elements being dragged follow the pointer locally; everyone else gets per-frame updates. */
  const [dragPos, setDragPos] = useState<ReadonlyMap<string, Point> | null>(null)
  const dragRef = useRef(dragPos)
  dragRef.current = dragPos
  const [spaceHeld, setSpaceHeld] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture>({ kind: "none" })

  const queueCursor = useFrameThrottle((p: Point | null) => send(new MoveCursor({ cursor: p })))
  const queueMove = useFrameThrottle((moves: ReadonlyMap<string, Point>) => {
    for (const [id, p] of moves) send(new MoveNode({ id, x: p.x, y: p.y, final: false }))
  })

  const boardActions = useMemo(() => ({ setImage: (id: string, src: string | null) => send(new SetImage({ id, src })) }), [send])
  const handles = useMemo(
    () =>
      [...state.nodes.values()].flatMap((n) => (n.handle ? [{ handle: n.handle, label: n.label, type: n.type }] : [])),
    [state.nodes],
  )
  const others = [...state.users.values()].filter((u) => u.id !== state.selfId)
  const self = state.selfId ? state.users.get(state.selfId) : undefined
  const color = self?.color ?? identity.color

  const tree = useMemo(() => {
    const t = buildTree(state)
    if (!dragPos) return t
    return {
      ...t,
      roots: t.roots.map((r) => {
        const p = dragPos.get(r.node.id)
        return p ? { ...r, node: { ...r.node, x: p.x, y: p.y } } : r
      }),
    }
  }, [state, dragPos])

  // Forget selected elements that no longer exist (deleted here or by someone else).
  useEffect(() => {
    if ([...selected].some((id) => !state.nodes.has(id))) setSelected(new Set([...selected].filter((id) => state.nodes.has(id))))
  }, [selected, state.nodes])

  const deleteSelected = () => {
    for (const id of selected) send(new DeleteNode({ id }))
    setSelected(new Set())
  }

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
      } else setCamera((c) => panBy(c, -e.deltaX, -e.deltaY))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Delete / Backspace removes the selection (unless typing); Esc clears it; Ctrl/⌘+A selects all;
  // Space held turns dragging into panning. Typing a character jumps back into the input box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (document.activeElement as HTMLElement | null)?.tagName === "INPUT"
      if (typing) return
      if (e.key === " ") {
        e.preventDefault()
        setSpaceHeld(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        setSelected(new Set([...state.nodes.values()].filter((n) => n.parent === null).map((n) => n.id)))
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        document.getElementById("board-input")?.focus()
        return
      }
      if (selected.size === 0) return
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        deleteSelected()
      } else if (e.key === "Escape") setSelected(new Set())
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKeyUp)
    }
  })

  const committedRoot = (target: EventTarget | null): BoardNode | null => {
    const id = (target as Element | null)?.closest?.("[data-root-id]")?.getAttribute("data-root-id")
    const n = id ? state.nodes.get(id) : undefined
    return n && n.parent === null ? n : null
  }

  const finishDrag = (g: Extract<Gesture, { kind: "drag" }>) => {
    const moves = dragRef.current
    if (!g.moved || !moves) return
    const updated: BoardNode[] = []
    for (const [id, p] of moves) {
      send(new MoveNode({ id, x: p.x, y: p.y, final: true }))
      const n = state.nodes.get(id)
      if (n) updated.push({ ...n, x: Math.round(p.x), y: Math.round(p.y), pinned: true })
    }
    if (updated.length) applyLocal(new NodesUpdated({ nodes: updated }))
  }

  /** Committed top-level elements whose box touches the rubber band (screen coordinates). */
  const hitsIn = (r: Rect) => {
    const out: string[] = []
    for (const el of boardRef.current?.querySelectorAll("[data-root-id]") ?? []) {
      const id = el.getAttribute("data-root-id")
      if (id && touches(r, el.getBoundingClientRect())) out.push(id)
    }
    return out
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
      setMarquee(null)
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      gesture.current = { kind: "pinch", start: { cam: cam.current, a, b } }
      return
    }
    if (pointers.current.size > 2) return

    const start = { x: e.clientX, y: e.clientY }
    const panning = spaceHeld || e.button === 1 || e.pointerType === "touch"
    const node = panning ? null : committedRoot(e.target)
    if (node) {
      // Dragging a selected element moves the whole selection.
      const ids = selected.has(node.id) ? [...selected] : [node.id]
      const origins = new Map<string, Point>()
      for (const id of ids) {
        const n = state.nodes.get(id)
        if (n && n.parent === null) origins.set(id, state.displaced.get(id) ?? { x: n.x, y: n.y })
      }
      gesture.current = { kind: "drag", clicked: node.id, ids, start, origins, moved: false, shift: e.shiftKey }
    } else if (panning) {
      gesture.current = { kind: "pan", startCam: cam.current, start, moved: false }
    } else {
      gesture.current = { kind: "marquee", start, base: e.shiftKey ? selected : new Set(), moved: false }
    }
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
    else if (g.kind === "marquee") {
      const r = rectOf(g.start, { x: e.clientX, y: e.clientY })
      setMarquee(r)
      setSelected(new Set([...g.base, ...hitsIn(r)]))
    } else {
      const z = cam.current.zoom
      const moves = new Map<string, Point>()
      for (const [id, o] of g.origins) moves.set(id, { x: o.x + dx / z, y: o.y + dy / z })
      setDragPos(moves)
      queueMove(moves)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g.kind === "drag") {
      finishDrag(g)
      if (!g.moved) {
        if (g.shift) {
          const next = new Set(selected)
          if (next.has(g.clicked)) next.delete(g.clicked)
          else next.add(g.clicked)
          setSelected(next)
        } else setSelected(new Set([g.clicked]))
      } else if (!selected.has(g.clicked)) setSelected(new Set([g.clicked]))
    } else if (g.kind === "marquee" && !g.moved) {
      if (g.base.size === 0) setSelected(new Set())
    } else if (g.kind === "pan" && !g.moved) setSelected(new Set())
    setDragPos(null)
    setMarquee(null)
    gesture.current = { kind: "none" }
    // Lifting one finger of a pinch shouldn't turn the other into a jumpy pan.
    pointers.current.clear()
  }

  return (
    <div
      ref={boardRef}
      className={`board-grid fixed inset-0 touch-none select-none overflow-hidden ${spaceHeld ? "cursor-grab" : ""}`}
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
        <EdgeLayer edges={tree.edges} camera={camera} />
        <BoardActions.Provider value={boardActions}>
        <HighlightContext.Provider value={{ handle: highlight, color }}>
        <AnimatePresence>
          {tree.roots.map((item) => (
            <RootView
              key={item.node.id}
              item={item}
              tree={tree}
              selected={selected.has(item.node.id)}
              showDelete={selected.size === 1}
              dragging={dragPos?.has(item.node.id) ?? false}
              accent={color}
              onDelete={() => {
                send(new DeleteNode({ id: item.node.id }))
                setSelected(new Set())
              }}
            />
          ))}
        </AnimatePresence>
        </HighlightContext.Provider>
        </BoardActions.Provider>
      </div>
      {marquee && (
        <div
          className="pointer-events-none absolute z-30 rounded-sm"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
            border: `1px solid ${color}`,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
          }}
        />
      )}
      {selected.size > 1 && (
        <div
          data-ui
          className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel)] py-1 pl-3 pr-1 text-xs shadow-sm"
        >
          <span className="tabular-nums text-[var(--muted)]">{selected.size} selected</span>
          <button type="button" onClick={deleteSelected} className="rounded-full bg-red-500/90 px-2.5 py-0.5 font-medium text-white hover:bg-red-500">
            Delete
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="rounded-full px-2 py-0.5 text-[var(--muted)] hover:text-[var(--ink)]">
            Clear
          </button>
        </div>
      )}
      {others.map((u) => u.cursor && <RemoteCursor key={u.id} user={u} at={toScreen(camera, u.cursor)} />)}
      <ZoomControls zoom={camera.zoom} onZoom={(z) => setCamera((c) => zoomAt(c, window.innerWidth / 2, window.innerHeight / 2, z))} />
      <InputBox
        color={color}
        handles={handles}
        suggestions={state.suggestions}
        onHighlight={setHighlight}
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

const THEMES: Array<{ pref: ThemePref; label: string; icon: string }> = [
  { pref: "system", label: "Theme: system", icon: "◐" },
  { pref: "light", label: "Theme: light", icon: "☀" },
  { pref: "dark", label: "Theme: dark", icon: "☾" },
]

/** System → light → dark. System (the default) follows the OS live. */
function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(loadTheme)
  useEffect(() => {
    applyTheme(pref)
    return followSystem(pref)
  }, [pref])
  const current = THEMES.find((t) => t.pref === pref)!
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!
  return (
    <button
      type="button"
      onClick={() => setPref(next.pref)}
      aria-label={`${current.label}. Switch to ${next.pref}`}
      title={current.label}
      className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--panel-border)] text-xs text-[var(--muted)] hover:text-[var(--ink)]"
    >
      {current.icon}
    </button>
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
        <ThemeToggle />
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
