import { useEffect, useRef } from "react"
import type { Camera } from "./camera.ts"
import { type Rect, route } from "./route.ts"
import type { EdgeItem } from "./tree.ts"

const LABELS: Record<string, string> = {
  calls: "calls",
  reads: "reads",
  writes: "writes",
  publishes: "publishes",
  subscribes: "subscribes",
  "navigates-to": "navigates to",
}

/**
 * Arrows in world space. React renders one group per edge; a single rAF loop
 * measures both endpoints from the DOM every frame and writes the geometry
 * straight onto the SVG, so arrows stay glued through drags, springs and
 * reflow without re-rendering React.
 */
const labelOf = (e: EdgeItem["edge"]) => e.label ?? LABELS[e.kind] ?? e.kind

/** Arrows between the same two elements in the same direction draw as one: "reads / writes". */
function merged(edges: EdgeItem[]): Array<EdgeItem & { text: string }> {
  const out = new Map<string, EdgeItem & { text: string }>()
  for (const item of edges) {
    const key = `${item.edge.from}>${item.edge.to}>${item.draft ? "d" : "c"}`
    const had = out.get(key)
    const text = labelOf(item.edge)
    if (!had) out.set(key, { ...item, text })
    else if (!had.text.split(" / ").includes(text)) had.text = `${had.text} / ${text}`
  }
  return [...out.values()]
}

export function EdgeLayer({ edges: all, camera }: { edges: EdgeItem[]; camera: Camera }) {
  const edges = merged(all)
  const cam = useRef(camera)
  cam.current = camera
  const groups = useRef(new Map<string, SVGGElement>())
  const list = useRef(edges)
  list.current = edges

  useEffect(() => {
    let raf = 0
    const toWorld = (r: DOMRect): Rect => {
      const c = cam.current
      return { x: (r.left - c.x) / c.zoom, y: (r.top - c.y) / c.zoom, w: r.width / c.zoom, h: r.height / c.zoom }
    }
    const tick = () => {
      for (const { edge } of list.current) {
        const g = groups.current.get(edge.id)
        const a = document.querySelector(`[data-node-id="${edge.from}"]`)
        const b = document.querySelector(`[data-node-id="${edge.to}"]`)
        if (!g) continue
        if (!a || !b) {
          g.style.visibility = "hidden"
          continue
        }
        const r = route(toWorld(a.getBoundingClientRect()), toWorld(b.getBoundingClientRect()))
        const [line, head, label] = g.children as unknown as [SVGPathElement, SVGPathElement, SVGTextElement]
        line.setAttribute("d", r.d)
        head.setAttribute("d", r.head)
        label.setAttribute("x", String(r.mid.x))
        label.setAttribute("y", String(r.mid.y - 6))
        g.style.visibility = "visible"
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
      {edges.map(({ edge, draft, text }) => {
        const color = draft ? edge.authorColor : "var(--edge)"
        return (
          <g
            key={edge.id}
            ref={(el) => {
              if (el) groups.current.set(edge.id, el)
              else groups.current.delete(edge.id)
            }}
            style={{ visibility: "hidden" }}
          >
            <path fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeDasharray={draft ? "5 4" : undefined} />
            <path fill={color} stroke="none" />
            <text
              textAnchor="middle"
              className="text-[10px] tracking-wide"
              fill={draft ? edge.authorColor : "var(--muted)"}
              stroke="var(--board-bg)"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
