import { expect, test } from "bun:test"
import { route } from "./route.ts"

const box = (x: number, y: number) => ({ x, y, w: 100, h: 50 })

test("side-by-side elements connect right edge → left edge", () => {
  const r = route(box(0, 0), box(300, 0))
  expect(r.d.startsWith("M100,25")).toBe(true)
  expect(r.head.startsWith("M300,25")).toBe(true)
  expect(r.mid).toEqual({ x: 200, y: 25 })
})

test("right-to-left arrows leave from the left edge", () => {
  const r = route(box(300, 0), box(0, 0))
  expect(r.d.startsWith("M300,25")).toBe(true)
  expect(r.head.startsWith("M100,25")).toBe(true)
})

test("stacked elements connect bottom → top", () => {
  const r = route(box(0, 0), box(0, 300))
  expect(r.d.startsWith("M50,50")).toBe(true)
  expect(r.head.startsWith("M50,300")).toBe(true)
})
