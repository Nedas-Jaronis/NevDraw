import { Commit, isImageSrc, Join, SetImage, SetInput } from "@rtw/shared"
import { afterEach, expect, test } from "bun:test"
import { makeMemoryStore } from "../src/BoardStore.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

test("image sources: raster data-URLs and https only", () => {
  expect(isImageSrc(PNG)).toBe(true)
  expect(isImageSrc("https://example.com/a.jpg")).toBe(true)
  expect(isImageSrc("http://example.com/a.jpg")).toBe(false)
  expect(isImageSrc("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false)
  expect(isImageSrc("javascript:alert(1)")).toBe(false)
  expect(isImageSrc(`data:image/png;base64,${"A".repeat(700_000)}`)).toBe(false)
})

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

test("putting a picture into a hero syncs to everyone, persists, and can be removed", async () => {
  const store = makeMemoryStore()
  const server = await startServer({ store })
  cleanups.push(() => server.stop())
  const join = async (name: string) => {
    const c = await TestClient.connect(server.url, "r")
    cleanups.push(() => c.close())
    c.send(new Join({ name, color: "#000" }))
    return { c, welcome: await c.waitFor(is("Welcome")) }
  }
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "landing page with a hero area", anchor: { x: 0, y: 0 } }))
  a.c.send(new Commit())
  const hero = (await a.c.waitFor(is("NodesCommitted"))).nodes.find((n) => n.type === "hero")!

  b.c.send(new SetImage({ id: hero.id, src: "javascript:alert(1)" })) // rejected
  b.c.send(new SetImage({ id: hero.id, src: PNG }))
  const up = await a.c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === hero.id)))
  expect(up.nodes[0]!.props.src).toBe(PNG)
  expect(a.c.received.filter(is("NodesUpdated")).length).toBe(1)

  const late = await join("Cy")
  expect(late.welcome.nodes.find((n) => n.id === hero.id)!.props.src).toBe(PNG)

  a.c.send(new SetImage({ id: hero.id, src: null }))
  const removed = await b.c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === hero.id && !n.props.src)))
  expect(removed.nodes[0]!.props.src).toBeUndefined()
})

test("images survive a server restart (SQLite), and a drop onto any element adds an image inside it", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join: joinPath } = await import("node:path")
  const { sqliteStore } = await import("../src/BoardStore.ts")
  const { DropImage } = await import("@rtw/shared")
  const dir = mkdtempSync(joinPath(tmpdir(), "rtw-img-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const db = joinPath(dir, "boards.sqlite")

  const first = await startServer({ store: sqliteStore(db) })
  const a = await TestClient.connect(first.url, "r")
  a.send(new Join({ name: "Ada", color: "#000" }))
  await a.waitFor(is("Welcome"))
  a.send(new SetInput({ text: "pricing card", anchor: { x: 0, y: 0 } }))
  a.send(new Commit())
  const [card] = (await a.waitFor(is("NodesCommitted"))).nodes
  a.send(new DropImage({ parent: card!.id, src: PNG }))
  const dropped = await a.waitFor(is("NodesCommitted", (m) => m.nodes[0]?.type === "image"))
  expect(dropped.nodes[0]).toMatchObject({ parent: card!.id, props: { src: PNG }, handle: "@image" })
  a.close()
  await first.stop()

  const second = await startServer({ store: sqliteStore(db) })
  cleanups.push(() => second.stop())
  const b = await TestClient.connect(second.url, "r")
  cleanups.push(() => b.close())
  b.send(new Join({ name: "Bo", color: "#000" }))
  const w = await b.waitFor(is("Welcome"))
  expect(w.nodes.find((n) => n.type === "image")).toMatchObject({ parent: card!.id, props: { src: PNG } })
})
