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

describe("references with filler words", () => {
  const h = new Map([
    ["@25-minute-timer", { container: false, type: "timer" as const }],
    ["@server", { container: false, type: "service" as const }],
    ["@sql-database", { container: false, type: "database" as const }],
  ])
  const edges = (t: string) => interpretOffline(t, h).edges.map((e) => `${e.from} -${e.label ?? e.kind}-> ${e.to}`)

  test("'the/both the @x' is the existing element, never a new one", () => {
    expect(interpretOffline("Link the @25-minute-timer to both the @server", h).nodes).toEqual([])
    expect(edges("Link the @25-minute-timer to both the @server")).toEqual(["@25-minute-timer -connects-> @server"])
    expect(edges("the @server writes to the @sql-database")).toEqual(["@server -writes-> @sql-database"])
  })

  test("'… linked together' and 'link … together' draw the arrow", () => {
    expect(edges("both the @server and @sql-database linked together")).toEqual(["@server -connects-> @sql-database"])
    expect(edges("link the @25-minute-timer and @server together")).toEqual(["@25-minute-timer -connects-> @server"])
  })

  test("a reference with real extra words is new, and @ never leaks into labels", () => {
    expect(shape(interpretOffline("a timer like @25-minute-timer", h))).toEqual(["timer:Timer like 25 minute timer"])
    expect(shape(interpretOffline("@nothing-here box", h))).toEqual(["box:Nothing here box"])
  })
})

test("the reported flow: linking to a committed timer adds an arrow, not a new timer", async () => {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const anchor = { x: 0, y: 0 }
  c.send(new SetInput({ text: "25 minute timer. a server", anchor }))
  c.send(new Commit())
  const first = await c.waitFor(is("NodesCommitted"))
  expect(first.nodes.map((n) => n.handle)).toEqual(["@25-minute-timer", "@server"])

  c.send(new SetInput({ text: "Link the @25-minute-timer to both the @server", anchor }))
  c.send(new Commit())
  const second = await c.waitFor(is("NodesCommitted", (m) => m.edges.length > 0))
  expect(second.nodes).toEqual([])
  expect(second.edges[0]).toMatchObject({ from: first.nodes[0]!.id, to: first.nodes[1]!.id, label: "connects" })
})
