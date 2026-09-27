import { Commit, DeleteNode, Join, SetInput } from "@rtw/shared"
import type { EntryGraph } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { makeMemoryStore } from "../src/BoardStore.ts"
import { interpretOffline, materialize } from "../src/engine/index.ts"
import { ROW_GAP } from "../src/engine/layered.ts"
import { ARROW_GAP } from "../src/engine/materialize.ts"
import { split } from "../src/engine/split.ts"
import { is, startServer, TestClient } from "./helpers.ts"

/** "from -kind-> to" using labels, plus node types. */
function arrows(g: EntryGraph) {
  const label = new Map(g.nodes.map((n) => [n.key, n.label]))
  return g.edges.map((e) => `${label.get(e.from)} -${e.kind}-> ${label.get(e.to)}`)
}
const types = (g: EntryGraph) => g.nodes.map((n) => `${n.type}:${n.label}`)

describe("relation verbs", () => {
  test("the acceptance example: three nodes, writes + publishes from the subject", () => {
    const g = interpretOffline("api server writes to postgres and publishes to a queue")
    expect(types(g)).toEqual(["service:Api server", "database:Postgres", "queue:Queue"])
    expect(arrows(g)).toEqual(["Api server -writes-> Postgres", "Api server -publishes-> Queue"])
  })

  test("page navigation", () => {
    expect(arrows(interpretOffline("login page navigates to dashboard"))).toEqual(["Login page -navigates-to-> Dashboard"])
  })

  test("a repeated name is the same element across clauses", () => {
    const g = interpretOffline("client calls api, api writes to postgres")
    expect(types(g)).toEqual(["client:Client", "service:Api", "database:Postgres"])
    expect(arrows(g)).toEqual(["Client -calls-> Api", "Api -writes-> Postgres"])
  })

  test("arrow chains", () => {
    expect(arrows(interpretOffline("web app -> api -> postgres"))).toEqual(["Web app -calls-> Api", "Api -calls-> Postgres"])
  })

  test("one verb, several targets", () => {
    expect(arrows(interpretOffline("checkout calls stripe and sendgrid"))).toEqual([
      "Checkout -calls-> Stripe",
      "Checkout -calls-> Sendgrid",
    ])
  })

  test("reads / subscribes kinds", () => {
    expect(arrows(interpretOffline("worker consumes from kafka queue and writes to s3 bucket"))).toEqual([
      "Worker -subscribes-> Kafka queue",
      "Worker -writes-> S3 bucket",
    ])
    expect(arrows(interpretOffline("dashboard reads from redis cache"))).toEqual(["Dashboard -reads-> Redis cache"])
  })

  test("bare verb stems don't split UI text", () => {
    expect(split("page with a read more button").map((p) => p.text)).toEqual(["page", "a read more button"])
  })

  test("a nested element can be an arrow source; targets stay top-level", () => {
    const g = interpretOffline("landing page with signup form. signup form posts to api")
    const byKey = new Map(g.nodes.map((n) => [n.key, n]))
    expect(arrows(g)).toEqual(["Signup form -calls-> Api"])
    expect(byKey.get(g.edges[0]!.to)!.parent).toBeNull()
  })
})

describe("placement near what it connects to", () => {
  const user = { id: "u", name: "A", color: "#000", cursor: null }
  let n = 0
  const newId = () => `id${++n}`

  test("targets sit in a column to the right of their source, centered on it", () => {
    const m = materialize({
      graph: interpretOffline("api writes to postgres and publishes to queue"),
      prev: undefined,
      anchor: { x: 0, y: 0 },
      user,
      newId,
    })
    const [api, pg, q] = m.nodes
    expect(pg!.x).toBe(api!.x + 240 + ARROW_GAP)
    expect(q!.x).toBe(pg!.x)
    expect(q!.y - pg!.y).toBe(ROW_GAP)
    expect((pg!.y + q!.y) / 2).toBe(api!.y)
    expect(m.edges.map((e) => [e.from, e.to])).toEqual([
      [api!.id, pg!.id],
      [api!.id, q!.id],
    ])
  })

  test("edge ids are stable while typing continues", () => {
    const a = materialize({ graph: interpretOffline("api writes to postgres"), prev: undefined, anchor: { x: 0, y: 0 }, user, newId })
    const b = materialize({ graph: interpretOffline("api writes to postgres and publishes to queue"), prev: a, anchor: { x: 0, y: 0 }, user, newId })
    expect(b.edges[0]!.id).toBe(a.edges[0]!.id)
  })
})

// ---------------------------------------------------------------------------

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

test("arrows travel with drafts, commit, persist, and vanish with their nodes", async () => {
  const store = makeMemoryStore()
  const server = await startServer({ store })
  cleanups.push(() => server.stop())
  const join = async (name: string) => {
    const c = await TestClient.connect(server.url, "r")
    cleanups.push(() => c.close())
    c.send(new Join({ name, color: "#e11d48" }))
    return { c, welcome: await c.waitFor(is("Welcome")) }
  }
  const a = await join("Ada")
  const b = await join("Bo")
  a.c.send(new SetInput({ text: "api server writes to postgres and publishes to a queue", anchor: { x: 0, y: 0 } }))
  const draft = await a.c.waitFor(is("DraftUpdated"))
  expect(draft.draft.edges.map((e) => e.kind)).toEqual(["writes", "publishes"])

  a.c.send(new Commit())
  const committed = await b.c.waitFor(is("NodesCommitted"))
  expect(committed.edges.map((e) => e.id)).toEqual(draft.draft.edges.map((e) => e.id))

  const late = await join("Cy")
  expect(late.welcome.edges).toHaveLength(2)

  const pg = committed.nodes.find((n) => n.type === "database")!
  a.c.send(new DeleteNode({ id: pg.id }))
  const removed = await b.c.waitFor(is("NodesRemoved"))
  expect(removed.edgeIds).toEqual([committed.edges.find((e) => e.to === pg.id)!.id])

  await server.stop()
  const again = await startServer({ store })
  cleanups.push(() => again.stop())
  const c = await TestClient.connect(again.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Dee", color: "#000" }))
  const w = await c.waitFor(is("Welcome"))
  expect(w.edges.map((e) => e.kind)).toEqual(["publishes"])
})
