/**
 * Export the board as an image, the way Excalidraw does it: the committed
 * elements (or only the selected ones) and their arrows, tightly cropped with
 * a little padding, at 1×/2×/3×, with or without the background, in light or
 * dark. Drafts, selection rings and editing controls are left out.
 */
import { toCanvas } from "html-to-image"

export const EXPORT_SCALES = [1, 2, 3] as const
/** Around the content, in board pixels (Excalidraw uses 10; our cards have soft shadows). */
export const EXPORT_PADDING = 24

export type ExportOptions = {
  /** Only these top-level element ids (and arrows between them); null = everything. */
  only: ReadonlySet<string> | null
  background: boolean
  dark: boolean
  scale: number
}

type Bounds = { x: number; y: number; w: number; h: number }

/** The world layer: the transformed div holding every element and the arrow layer. */
const worldOf = () => document.querySelector<HTMLElement>("[data-world]")

const rootIdOf = (el: Element) => el.closest("[data-root-id]")?.getAttribute("data-root-id") ?? null

/** Which arrows are in the picture: every one, or those whose ends are both exported. */
function keepEdge(g: SVGGElement, only: ReadonlySet<string> | null) {
  if (g.style.visibility === "hidden") return false
  if (!only) return true
  const within = (id: string | null) => {
    if (!id) return false
    const el = document.querySelector(`[data-node-id="${id}"]`)
    const root = el ? rootIdOf(el) : null
    return root !== null && only.has(root)
  }
  return within(g.getAttribute("data-from")) && within(g.getAttribute("data-to"))
}

/** The exported area in board coordinates. Null when there's nothing to export. */
function boundsOf(world: HTMLElement, only: ReadonlySet<string> | null, zoom: number): Bounds | null {
  const origin = world.getBoundingClientRect()
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + w)
    y1 = Math.max(y1, y + h)
  }
  for (const el of world.querySelectorAll<HTMLElement>("[data-root-id]")) {
    if (only && !only.has(el.getAttribute("data-root-id")!)) continue
    const r = el.getBoundingClientRect()
    add((r.left - origin.left) / zoom, (r.top - origin.top) / zoom, r.width / zoom, r.height / zoom)
  }
  for (const g of world.querySelectorAll<SVGGElement>("svg g[data-edge]")) {
    if (!keepEdge(g, only)) continue
    const b = g.getBBox()
    add(b.x, b.y, b.width, b.height)
  }
  if (!Number.isFinite(x0)) return null
  const p = EXPORT_PADDING
  return { x: Math.floor(x0 - p), y: Math.floor(y0 - p), w: Math.ceil(x1 - x0 + 2 * p), h: Math.ceil(y1 - y0 + 2 * p) }
}

/** Run `f` with the page in the export's theme and editing chrome hidden, then restore. */
async function staged<T>(dark: boolean, background: boolean, f: () => Promise<T>): Promise<T> {
  const root = document.documentElement
  // applyTheme always puts the resolved theme on <html>.
  const before = root.getAttribute("data-theme")
  root.setAttribute("data-exporting", background ? "" : "transparent")
  if ((before === "dark") !== dark) root.setAttribute("data-theme", dark ? "dark" : "light")
  // Let styles settle before they're read.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  // SVG text loses stylesheet styles in the copy: pin its resolved look inline for the capture.
  const labels = [...document.querySelectorAll<SVGTextElement>("svg g[data-edge] text")].map((t) => {
    const saved = t.getAttribute("style")
    const cs = getComputedStyle(t)
    t.setAttribute(
      "style",
      `font-size:${cs.fontSize};font-family:${cs.fontFamily};letter-spacing:${cs.letterSpacing};fill:${cs.fill};stroke:${cs.stroke};stroke-width:${cs.strokeWidth};paint-order:${cs.paintOrder}`,
    )
    return () => (saved === null ? t.removeAttribute("style") : t.setAttribute("style", saved))
  })
  try {
    return await f()
  } finally {
    for (const restore of labels) restore()
    root.removeAttribute("data-exporting")
    if (before === null) root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", before)
  }
}

/** Draw the export onto a canvas. Null when there's nothing to export. */
export async function renderExport(opts: ExportOptions, zoom: number): Promise<HTMLCanvasElement | null> {
  const world = worldOf()
  if (!world) return null
  return staged(opts.dark, opts.background, async () => {
    const b = boundsOf(world, opts.only, zoom)
    if (!b) return null
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--board-bg").trim() || (opts.dark ? "#121212" : "#ffffff")
    return toCanvas(world, {
      width: b.w,
      height: b.h,
      pixelRatio: opts.scale,
      ...(opts.background ? { backgroundColor: bg } : {}),
      cacheBust: false,
      // Draw the world at 1:1 with the content's corner at the image's corner.
      style: { transform: `translate(${-b.x}px, ${-b.y}px)`, transformOrigin: "top left", left: "0", top: "0" },
      filter: (node) => {
        if (!(node instanceof Element)) return true
        if (node.hasAttribute("data-export-hide")) return false
        // Drafts (someone's typing) aren't part of the picture.
        if (node.hasAttribute("data-draft-root")) return false
        if (opts.only && node.hasAttribute("data-root-id") && !opts.only.has(node.getAttribute("data-root-id")!)) return false
        if (node instanceof SVGGElement && node.hasAttribute("data-edge")) return keepEdge(node, opts.only)
        return true
      },
    })
  })
}

const fileName = (room: string, ext: string) => `${room || "board"}-${new Date().toISOString().slice(0, 10)}.${ext}`

function download(url: string, name: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
}

export function savePng(canvas: HTMLCanvasElement, room: string) {
  download(canvas.toDataURL("image/png"), fileName(room, "png"))
}

/** One page sized to the picture (landscape or portrait), the image filling it. */
export async function savePdf(canvas: HTMLCanvasElement, room: string, scale: number) {
  const { jsPDF } = await import("jspdf")
  const w = canvas.width / scale
  const h = canvas.height / scale
  const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "px", format: [w, h], hotfixes: ["px_scaling"] })
  pdf.setProperties({ title: room ? `NevDraw · ${room}` : "NevDraw" })
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST")
  pdf.save(fileName(room, "pdf"))
}

/** Copy as a PNG to the clipboard. False where the browser doesn't allow it. */
export async function copyPng(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"))
    if (!blob || !("ClipboardItem" in window)) return false
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
    return true
  } catch {
    return false
  }
}
