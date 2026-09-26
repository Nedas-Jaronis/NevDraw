import { Commit, Join, SetInput } from "@rtw/shared"
import type { EntryGraph } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { aliasLabel, countOf } from "../src/engine/assemble.ts"
import { interpretOffline } from "../src/engine/index.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const shape = (g: EntryGraph) => g.nodes.map((n) => `${n.type}:${n.label}${n.parent ? "<" : ""}`)

describe("numbers: counts vs values", () => {
  test.each([
    ["three pricing cards", 3],
    ["4 feature tiles", 4],
    ["25 min timer", 1],
    ["25 min timers", 1],
    ["2 column layout", 1],
    ["5 star rating", 1],
    ["12 widgets", 8],
  ] as const)("%p → %p", (text, n) => {
    expect(countOf(text)).toBe(n)
  })

  test("the reported bug: a 25 min timer is one timer, with its number kept", () => {
    expect(shape(interpretOffline("25 min timer and a 25 min stop watch"))).toEqual(["timer:25 min timer", "stopwatch:25 min stop watch"])
  })
})

describe("widgets are real types, not boxes", () => {
  test.each([
    ["pomodoro timer", "timer"],
    ["lap timer", "stopwatch"],
    ["revenue chart", "chart"],
    ["date picker", "calendar"],
    ["store locator map", "map"],
    ["video player", "video"],
    ["support chat", "chat"],
    ["settings tabs", "tabs"],
    ["country dropdown", "select"],
    ["dark mode toggle", "toggle"],
    ["volume slider", "slider"],
    ["upload progress bar", "progress"],
    ["user avatar", "avatar"],
    ["search bar", "search"],
    ["revenue kpi", "stat"],
  ] as const)("%p → %p", (text, type) => {
    expect(interpretOffline(text).nodes[0]!.type).toBe(type)
  })
})

describe("conversational phrasing", () => {
  test("lead-ins and meta nouns disappear", () => {
    expect(shape(interpretOffline("Can you create a flowchart with a database and server"))).toEqual(["database:Database", "service:Server"])
    expect(shape(interpretOffline("please make a diagram of a client calling an api"))).toEqual(["client:Client", "service:Api"])
    expect(shape(interpretOffline("I want a landing page with a hero"))).toEqual(["page:Landing page", "hero:Hero<"])
  })

  test("'being / called / named' name the listed elements in order", () => {
    expect(shape(interpretOffline("Create a flowchart with a server and a database, being server and sql"))).toEqual([
      "service:Server",
      "database:SQL Database",
    ])
    expect(shape(interpretOffline("a database called postgres"))).toEqual(["database:Postgres"])
    expect(shape(interpretOffline("a page named Pricing"))).toEqual(["page:Pricing"])
    expect(shape(interpretOffline("a server and a database, being"))).toEqual(["service:Server", "database:Database"])
  })

  test("alias labels", () => {
    expect(aliasLabel("Server", "server")).toBe("Server")
    expect(aliasLabel("Database", "sql")).toBe("SQL Database")
    expect(aliasLabel("Database", "postgres")).toBe("Postgres")
    expect(aliasLabel("Database", "orders database")).toBe("Orders Database")
  })

  test("'connect X and Y' is a relation", () => {
    const g = interpretOffline("connect the api and postgres")
    expect(shape(g)).toEqual(["service:Api", "database:Postgres"])
    expect(g.edges.map((e) => e.kind)).toEqual(["calls"])
  })
})

// ---------------------------------------------------------------------------

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

test("the reported flow: name a server and SQL database, then 'connect them together'", async () => {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const anchor = { x: 0, y: 0 }

  c.send(new SetInput({ text: "Create a flowchart with a server and a database, being server and sql", anchor }))
  c.send(new Commit())
  const first = await c.waitFor(is("NodesCommitted"))
  expect(first.nodes.map((n) => n.label)).toEqual(["Server", "SQL Database"])
  const [srv, db] = first.nodes

  c.send(new SetInput({ text: "lets connected them together", anchor }))
  const d = await c.waitFor(is("DraftUpdated", (m) => m.draft.text.startsWith("lets")))
  expect(d.draft.nodes).toEqual([]) // no new boxes
  expect(d.draft.edges.map((e) => [e.from, e.to, e.label])).toEqual([[srv!.id, db!.id, "connects"]])

  c.send(new Commit())
  const second = await c.waitFor(is("NodesCommitted", (m) => m.edges.length > 0))
  expect(second.nodes).toEqual([])
  expect(second.edges[0]).toMatchObject({ from: srv!.id, to: db!.id })
})
