import { expect, test } from "bun:test"
import { MAX_ZOOM, MIN_ZOOM, pinch, toScreen, toWorld, zoomAt } from "./camera.ts"

const cam = { x: 100, y: -50, zoom: 1.5 }

test("toWorld and toScreen are inverses", () => {
  const w = toWorld(cam, 640, 360)
  expect(toScreen(cam, w)).toEqual({ x: 640, y: 360 })
})

test("zoomAt keeps the point under the cursor fixed", () => {
  const before = toWorld(cam, 300, 200)
  const next = zoomAt(cam, 300, 200, 2.5)
  expect(next.zoom).toBe(2.5)
  const after = toWorld(next, 300, 200)
  expect(after.x).toBeCloseTo(before.x)
  expect(after.y).toBeCloseTo(before.y)
})

test("zoom is clamped", () => {
  expect(zoomAt(cam, 0, 0, 99).zoom).toBe(MAX_ZOOM)
  expect(zoomAt(cam, 0, 0, 0.001).zoom).toBe(MIN_ZOOM)
})

test("pinch: spreading fingers zooms in around their midpoint, moving them pans", () => {
  const start = { cam: { x: 0, y: 0, zoom: 1 }, a: { x: 100, y: 100 }, b: { x: 200, y: 100 } }
  const zoomed = pinch(start, { x: 50, y: 100 }, { x: 250, y: 100 })
  expect(zoomed.zoom).toBe(2)
  expect(toWorld(zoomed, 150, 100)).toEqual({ x: 150, y: 100 })
  const panned = pinch(start, { x: 110, y: 130 }, { x: 210, y: 130 })
  expect(panned).toEqual({ zoom: 1, x: 10, y: 30 })
})
