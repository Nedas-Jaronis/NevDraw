import type { Point } from "@rtw/shared"

/** This viewer's pan and zoom. Screen = world * zoom + (x, y). */
export type Camera = { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const toWorld = (cam: Camera, sx: number, sy: number): Point => ({
  x: (sx - cam.x) / cam.zoom,
  y: (sy - cam.y) / cam.zoom,
})

export const toScreen = (cam: Camera, p: Point): Point => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y })

export const panBy = (cam: Camera, dx: number, dy: number): Camera => ({ ...cam, x: cam.x + dx, y: cam.y + dy })

/** Zoom to `zoom` keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, zoom: number): Camera {
  const z = clampZoom(zoom)
  const w = toWorld(cam, sx, sy)
  return { zoom: z, x: sx - w.x * z, y: sy - w.y * z }
}

/** Two-finger gesture: the world point under the first midpoint follows the new midpoint. */
export function pinch(
  start: { cam: Camera; a: Point; b: Point },
  a: Point,
  b: Point,
): Camera {
  const d0 = Math.hypot(start.b.x - start.a.x, start.b.y - start.a.y) || 1
  const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const m0 = { x: (start.a.x + start.b.x) / 2, y: (start.a.y + start.b.y) / 2 }
  const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const z = clampZoom(start.cam.zoom * (d1 / d0))
  const w = toWorld(start.cam, m0.x, m0.y)
  return { zoom: z, x: m1.x - w.x * z, y: m1.y - w.y * z }
}
