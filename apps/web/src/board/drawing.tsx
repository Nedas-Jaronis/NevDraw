import { type BoardNode, type ClientMessage, Commit, type Draft, type Point, SetSketch, StepDraft } from "@rtw/shared"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"

type Hit = { start: string | null; end: string | null }

/** How long after lifting the pen the sketch is read. */
const PAUSE_MS = 900
/** A new stroke this far (board px) from the sketch starts a new sketch. */
const NEW_SKETCH_GAP = 90

const bboxOf = (strokes: readonly Point[][]) => {
  const pts = strokes.flat()
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

/** Keep a stroke light: points at least a few px apart, at most 150. */
function lighten(pts: readonly Point[], zoom: number): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const last = out.at(-1)
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 3 / zoom) out.push({ x: Math.round(p.x), y: Math.round(p.y) })
  }
  const lastPt = pts.at(-1)
  if (lastPt && out.at(-1) !== lastPt) out.push({ x: Math.round(lastPt.x), y: Math.round(lastPt.y) })
  if (out.length <= 150) return out
  const step = out.length / 150
  return Array.from({ length: 150 }, (_, i) => out[Math.floor(i * step)]!)
}

/** The committed element under a screen point (innermost; drafts and ink don't count). */
export function nodeAtPoint(x: number, y: number, nodes: ReadonlyMap<string, BoardNode>): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest("[data-node-id]")?.getAttribute("data-node-id")
    if (id && nodes.has(id)) return id
  }
  return null
}

/**
 * Drawing mode: strokes are your private ink; on a pause the server reads the
 * sketch and it becomes a dashed draft of a real component. Enter places it,
 * Esc throws it away, ⌘Z undoes the last stroke, ‹ › picks another reading.
 */
export function useSketch(opts: {
  /** Drawing mode is on (the Draw tool). */
  on: boolean
  send: (m: ClientMessage) => void
  zoom: number
  nodes: ReadonlyMap<string, BoardNode>
  toScreen: (p: Point) => Point
}) {
  const on = opts.on
  const [strokes, setStrokes] = useState<Point[][]>([])
  /** The stroke being drawn is drawn straight onto this polyline (no re-render per pointer move). */
  const liveLine = useRef<SVGPolylineElement | null>(null)
  const paintLive = (pts: readonly Point[] | null) => {
    liveLine.current?.setAttribute("points", pts ? pts.map((p) => `${p.x},${p.y}`).join(" ") : "")
  }
  const hits = useRef<Hit[]>([])
  const current = useRef<{ pts: Point[]; start: string | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ strokes, opts })
  latest.current = { strokes, opts }

  /** The committed element under a screen point (innermost; drafts and ink don't count). */
  const nodeAt = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const id = el.closest("[data-node-id]")?.getAttribute("data-node-id")
      if (id && latest.current.opts.nodes.has(id)) return id
    }
    return null
  }

  const sendSketch = (all: Point[][]) => {
    const { opts } = latest.current
    if (!all.length) return opts.send(new SetSketch({ strokes: [] }))
    const b = bboxOf(all)
    const c = opts.toScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
    const inside = nodeAt(c.x, c.y)
    // Where among the element's children it goes: before the first one below the sketch.
    let before: string | undefined
    if (inside) {
      const kids = [...opts.nodes.values()].filter((n) => n.parent === inside).sort((a, z) => a.order - z.order)
      before = kids.find((k) => {
        const r = document.querySelector(`[data-node-id="${k.id}"]`)?.getBoundingClientRect()
        return r && r.top + r.height / 2 > c.y
      })?.id
    }
    opts.send(new SetSketch({ strokes: all, ...(inside ? { inside } : {}), ...(before ? { before } : {}), hits: hits.current.slice(0, all.length) }))
  }

  const schedule = (all: Point[][]) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => sendSketch(all), PAUSE_MS)
  }

  const reset = (tell: boolean) => {
    if (timer.current) clearTimeout(timer.current)
    current.current = null
    hits.current = []
    paintLive(null)
    setStrokes([])
    if (tell) latest.current.opts.send(new SetSketch({ strokes: [] }))
  }

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  return {
    on,
    strokes,
    liveLine,
    /** Leaving drawing mode: the sketch goes. */
    clear: () => {
      if (latest.current.strokes.length || current.current) reset(true)
    },
    /** Pen down at a board point (screen point for what's under it). */
    start: (world: Point, screen: Point) => {
      if (timer.current) clearTimeout(timer.current)
      const all = latest.current.strokes
      if (all.length) {
        const b = bboxOf(all)
        const far =
          world.x < b.x - NEW_SKETCH_GAP || world.x > b.x + b.w + NEW_SKETCH_GAP || world.y < b.y - NEW_SKETCH_GAP || world.y > b.y + b.h + NEW_SKETCH_GAP
        // Somewhere else entirely: a new sketch replaces the old one.
        if (far) {
          hits.current = []
          setStrokes([])
        }
      }
      current.current = { pts: [world], start: nodeAt(screen.x, screen.y) }
      paintLive([world])
    },
    move: (world: Point) => {
      const c = current.current
      if (!c) return
      const last = c.pts.at(-1)!
      if (Math.hypot(world.x - last.x, world.y - last.y) < 2 / latest.current.opts.zoom) return
      c.pts.push(world)
      paintLive(c.pts)
    },
    end: (screen: Point) => {
      const c = current.current
      current.current = null
      paintLive(null)
      if (!c || c.pts.length < 2) return
      const stroke = lighten(c.pts, latest.current.opts.zoom)
      hits.current = [...hits.current, { start: c.start, end: nodeAt(screen.x, screen.y) }]
      const all = [...latest.current.strokes, stroke]
      setStrokes(all)
      schedule(all)
    },
    /** Two fingers came down: that stroke was the start of a pan, not ink. */
    cancelStroke: () => {
      current.current = null
      paintLive(null)
    },
    undo: () => {
      const all = latest.current.strokes.slice(0, -1)
      hits.current = hits.current.slice(0, all.length)
      setStrokes(all)
      if (timer.current) clearTimeout(timer.current)
      sendSketch(all)
    },
    commit: () => {
      if (timer.current) clearTimeout(timer.current)
      latest.current.opts.send(new Commit())
      reset(false)
    },
    /** Esc: throw the sketch away; true when there was one (else the caller leaves drawing mode). */
    escape: () => {
      if (!latest.current.strokes.length && !current.current) return false
      reset(true)
      return true
    },
    step: (delta: -1 | 1) => latest.current.opts.send(new StepDraft({ delta })),
  }
}

/** Your ink: private, in your color; faint once it has become a draft. */
export function Ink(props: { strokes: Point[][]; liveLine: React.RefObject<SVGPolylineElement | null>; color: string; recognized: boolean }) {
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden style={{ zIndex: 30 }}>
      <polyline ref={props.liveLine} points="" fill="none" stroke={props.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      {props.strokes.map((s, i) => (
        <polyline
          key={i}
          points={s.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={props.color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={props.recognized ? 0.3 : 0.9}
        />
      ))}
    </svg>
  )
}

const CHEAT_SHEET: Array<[string, string]> = [
  ["Box with a bar across the top", "Modal"],
  ["Box with short lines inside", "Form"],
  ["Wide, short box", "Input"],
  ["Small box, or box + scribble", "Button"],
  ["Box with an X or a peak", "Image"],
  ["Box with a circle and lines", "Contact"],
  ["Box with a small box and lines", "Card"],
  ["Scribbled lines, no box", "Text"],
  ["Circle", "Avatar"],
  ["Cylinder", "Database"],
  ["Plain box", "Service"],
  ["Box with vertical stripes", "Queue"],
  ["Arrow from one element to another", "Arrow"],
]

export type Tool = "select" | "draw" | "arrow"

const TOOL_BUTTONS: Array<{ tool: Tool; label: string; key: string; icon: React.ReactNode }> = [
  { tool: "select", label: "Select", key: "V", icon: <path d="M4 2.5l8.5 5.2-3.9 1 2.2 4.3-1.6.8-2.2-4.3L4 12z" /> },
  {
    tool: "draw",
    label: "Draw",
    key: "D",
    icon: (
      <>
        <path d="M10.5 2.5l3 3L6 13H3v-3z" />
        <path d="M9 4l3 3" />
      </>
    ),
  },
  {
    tool: "arrow",
    label: "Arrow",
    key: "A",
    icon: (
      <>
        <path d="M3 13L13 3" />
        <path d="M7 3h6v6" />
      </>
    ),
  },
]

/** Select / Draw / Arrow, next to the zoom controls; the cheat sheet shows while drawing. */
export function Tools(props: { tool: Tool; onTool: (t: Tool) => void }) {
  const [sheet, setSheet] = useState(true)
  return (
    <div data-ui className="absolute bottom-[104px] left-[150px] z-40 sm:bottom-3">
      <AnimatePresence>
        {props.tool === "draw" && sheet && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            className="absolute bottom-11 left-0 w-64 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)]/90 p-3 shadow-xl backdrop-blur-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold">Draw it, it becomes it</span>
              <button type="button" onClick={() => setSheet(false)} className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)]">
                Hide
              </button>
            </div>
            <ul className="flex flex-col gap-1 text-[11.5px]">
              {CHEAT_SHEET.map(([drawn, becomes]) => (
                <li key={becomes} className="flex justify-between gap-3">
                  <span className="text-[var(--muted)]">{drawn}</span>
                  <span className="font-medium">{becomes}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] leading-snug text-[var(--muted)]">
              Pause to see it · Enter places it · Esc discards · ⌘Z undoes a stroke · two fingers or Space pan. For arrows, the
              Arrow tool (A) is the easiest.
            </p>
          </motion.div>
        )}
        {props.tool === "arrow" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            className="absolute bottom-11 left-0 w-56 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)]/90 px-3 py-2 text-[11.5px] text-[var(--muted)] shadow-lg backdrop-blur-xl"
          >
            Drag from one element to another to connect them.
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-0.5 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-0.5 shadow-sm">
        {TOOL_BUTTONS.map((b) => (
          <button
            key={b.tool}
            type="button"
            aria-label={`${b.label} (${b.key})`}
            aria-pressed={props.tool === b.tool}
            title={`${b.label} (${b.key})`}
            onClick={() => {
              if (b.tool === "draw") setSheet(true)
              props.onTool(props.tool === b.tool && b.tool !== "select" ? "select" : b.tool)
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition active:scale-95 ${
              props.tool === b.tool ? "bg-[var(--ink)] text-[var(--panel)]" : "text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {b.icon}
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

/** The Arrow tool's rubber band: a straight arrow from where you started to the pointer. */
export function ArrowPreview(props: { lineRef: React.RefObject<SVGLineElement | null>; color: string }) {
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden style={{ zIndex: 30 }}>
      <defs>
        <marker id="arrow-tool-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={props.color} />
        </marker>
      </defs>
      <line ref={props.lineRef} x1="0" y1="0" x2="0" y2="0" stroke={props.color} strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#arrow-tool-head)" visibility="hidden" />
    </svg>
  )
}

/** What your sketch became, with ‹ › for another reading, above the input. */
export function SketchBar(props: { draft: Draft | undefined; onStep: (d: -1 | 1) => void; onCommit: () => void; onDiscard: () => void }) {
  const h = props.draft?.history
  const edges = props.draft?.edges.length ?? 0
  if (!props.draft || (!h?.label && !edges)) return null
  return (
    <div data-ui className="pointer-events-auto absolute bottom-[112px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel)]/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur-xl">
      <span className="font-medium">{h?.label ?? "Arrow"}</span>
      {h && h.total > 0 && (
        <span className="flex items-center gap-1 text-[var(--muted)]">
          <button type="button" aria-label="Previous reading" disabled={h.at <= 1} onClick={() => props.onStep(-1)} className="px-1 hover:text-[var(--ink)] disabled:opacity-30">
            ‹
          </button>
          <span className="tabular-nums">
            {h.at}/{h.total} · {h.source}
          </span>
          <button type="button" aria-label="Another reading" onClick={() => props.onStep(1)} className="px-1 hover:text-[var(--ink)]">
            ›
          </button>
        </span>
      )}
      <button type="button" onClick={props.onCommit} className="rounded-full bg-[var(--ink)] px-2.5 py-0.5 font-medium text-[var(--panel)]">
        Place ↵
      </button>
      <button type="button" onClick={props.onDiscard} className="text-[var(--muted)] hover:text-[var(--ink)]">
        Esc
      </button>
    </div>
  )
}
