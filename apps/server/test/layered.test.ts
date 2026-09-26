import { expect, test } from "bun:test"
import { interpretOffline, materialize } from "../src/engine/index.ts"
import { COLUMN_GAP, layeredPositions, ROW_GAP } from "../src/engine/layered.ts"

const node = (key: string) => ({ key, type: "service" as const, label: key, parent: null, props: {} })
const e = (from: string, to: string) => ({ from, to, kind: "calls" as const })

test("the reported stack: load balancer | 5 servers | 3 databases, columns centered", () => {
  const servers = [1, 2, 3, 4, 5].map((i) => `s${i}`)
  const dbs = [1, 2, 3].map((i) => `d${i}`)
  const graph = {
    nodes: [node("lb"), ...servers.map(node), ...dbs.map(node)],
    edges: [...servers.map((s) => e("lb", s)), ...servers.flatMap((s) => dbs.map((d) => e(s, d)))],
  }
  const p = layeredPositions(graph, () => 240)
  expect(p.get("lb")).toEqual({ x: 0, y: 0 })
  expect(servers.map((s) => p.get(s)!.x)).toEqual(Array(5).fill(240 + COLUMN_GAP))
  expect(servers.map((s) => p.get(s)!.y)).toEqual([-2, -1, 0, 1, 2].map((r) => r * ROW_GAP))
  expect(dbs.map((d) => p.get(d)!.x)).toEqual(Array(3).fill(2 * (240 + COLUMN_GAP)))
  expect(dbs.map((d) => p.get(d)!.y)).toEqual([-1, 0, 1].map((r) => r * ROW_GAP))
})

test("cycles don't hang and unconnected elements aren't placed", () => {
  const p = layeredPositions({ nodes: [node("a"), node("b"), node("c")], edges: [e("a", "b"), e("b", "a")] }, () => 240)
  expect([...p.keys()].sort()).toEqual(["a", "b"])
})

test("a typed architecture lays out as columns; elements already placed keep their spot", () => {
  const user = { id: "u", name: "A", color: "#000", cursor: null }
  let i = 0
  const newId = () => `id${++i}`
  const g1 = interpretOffline("web app calls api server")
  const m1 = materialize({ graph: g1, prev: undefined, anchor: { x: 1000, y: 500 }, user, newId })
  const g2 = interpretOffline("web app calls api server. api server writes to postgres and publishes to a queue")
  const m2 = materialize({ graph: g2, prev: m1, anchor: { x: 1000, y: 500 }, user, newId })
  const at = (label: string) => m2.nodes.find((n) => n.label === label)!
  expect([at("Web app").x, at("Web app").y]).toEqual([m1.nodes[0]!.x, m1.nodes[0]!.y])
  expect(at("Postgres").x).toBe(at("Queue").x)
  expect(at("Postgres").x).toBeGreaterThan(at("Api server").x)
  expect(at("Postgres").y).not.toBe(at("Queue").y)
})
