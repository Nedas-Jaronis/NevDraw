process.env.LLM_DEBOUNCE_MS = "60"
process.env.LLM_COMMIT_WAIT_MS = "400"

import type { EntryGraph } from "@rtw/shared"
import { Commit, Join, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { fromLlm, type LlmGraph, SYSTEM, userPrompt } from "../src/refine/prompt.ts"
import { openAiCompatible, RefineError, Refiner } from "../src/refine/Refiner.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const llmGraph: LlmGraph = {
  nodes: [
    { key: "p0", type: "service", label: "Checkout", parent: "", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
    { key: "n1", type: "external-api", label: "Stripe", parent: "", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
    { key: "n2", type: "queue", label: "Email queue", parent: "", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
  ],
  edges: [
    { from: "p0", to: "n1", kind: "calls" },
    { from: "p0", to: "n2", kind: "publishes" },
  ],
  suggestions: [],
  patches: [],
}

describe("LLM wire format", () => {
  test("fromLlm maps '' to top level, 'none' to no layout, and drops self-loops", () => {
    const g = fromLlm({
      nodes: [
        { key: "a", type: "page", label: " Home ", parent: "", layout: "row", of: "none", items: [], color: "", after: "", before: "" },
        { key: "b", type: "hero", label: "Hero", parent: "a", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
        { key: "c", type: "text", label: "Orphan", parent: "zzz", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
      ],
      edges: [{ from: "a", to: "a", kind: "calls" }],
      suggestions: [],
      patches: [],
    })
    expect(g.nodes.map((n) => [n.key, n.parent, n.label, n.props.layout])).toEqual([
      ["a", null, "Home", "row"],
      ["b", "a", "Hero", undefined],
      ["c", null, "Orphan", undefined],
    ])
    expect(g.edges).toEqual([])
  })

  test("the prompt carries the text, the board's handles and the draft's keys", () => {
    const u = JSON.parse(userPrompt({ text: "x", board: [{ handle: "@db", type: "database", label: "Db", parent: null, order: 0 }], draft: [{ key: "p0", type: "box", label: "X", parent: null }] }))
    expect(u).toEqual({
      text: "x",
      board: [{ handle: "@db", type: "database", label: "Db", parent: null, order: 0 }],
      recent: [],
      draft: [{ key: "p0", type: "box", label: "X", parent: null }],
    })
    expect(SYSTEM).toContain("never invent handles")
  })
})

describe("providers against mock HTTP servers", () => {
  const servers: Array<{ stop: () => void }> = []
  afterEach(() => servers.splice(0).forEach((s) => s.stop()))
  const input = { text: "checkout calls stripe, then it emails the user via a queue", board: [], draft: [] }

  test("OpenAI-compatible (gpt-oss): strict json_schema request, decoded with our schema", async () => {
    let seen: any = null
    const srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seen = { url: new URL(req.url).pathname, auth: req.headers.get("authorization"), body: await req.json() }
        return Response.json({ choices: [{ message: { content: JSON.stringify(llmGraph) } }] })
      },
    })
    servers.push(srv)
    const impl = openAiCompatible({ baseUrl: `http://localhost:${srv.port}/v1/`, apiKey: "k-123456789012", model: "openai/gpt-oss-120b" })
    const g = await Effect.runPromise(impl.refine(input))
    expect(seen.url).toBe("/v1/chat/completions")
    expect(seen.auth).toBe("Bearer k-123456789012")
    expect(seen.body).toMatchObject({ model: "openai/gpt-oss-120b", response_format: { type: "json_schema", json_schema: { strict: true } } })
    expect(seen.body.response_format.json_schema.schema.required).toEqual(["nodes", "edges", "suggestions", "patches"])
    expect(seen.body.response_format.json_schema.schema.$schema).toBeUndefined()
    expect(seen.body.messages[0].content).toBe(SYSTEM)
    expect(g.edges.map((e) => e.kind)).toEqual(["calls", "publishes"])
  })

  test("OpenAI-compatible: a provider without strict mode gets plain JSON mode (and it's remembered)", async () => {
    const formats: string[] = []
    const srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = (await req.json()) as any
        formats.push(body.response_format.type)
        if (body.response_format.type === "json_schema") return new Response("response_format json_schema not supported", { status: 400 })
        return Response.json({ choices: [{ message: { content: JSON.stringify(llmGraph) } }] })
      },
    })
    servers.push(srv)
    const impl = openAiCompatible({ baseUrl: `http://localhost:${srv.port}`, apiKey: "k-123456789012", model: "m" })
    await Effect.runPromise(impl.refine(input))
    await Effect.runPromise(impl.refine(input))
    expect(formats).toEqual(["json_schema", "json_object", "json_object"])
  })

  test("OpenAI-compatible: the real garbled reply from gpt-oss (JSON mode) still decodes", async () => {
    // Verbatim shape of what Cerebras gpt-oss-120b returned in json_object mode.
    const garbled = {
      nodes: [
        { "key 다": "n1", type: "page", label: "Checkout page", parent: "", "layout поздрав": "none" },
        { key: "n2", type: "external-api", label: "Stripe", parent: "", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
        { key: "n3", type: "queue", label: "Email queue", parent: "", layout: "none", of: "none", items: [], color: "", after: "", before: "" },
      ],
      edges: [
        { sourceuib: "n1", target: "n2", kind: "calls" },
        { source: "n1", target: "n3", kind: "calls" },
      ],
    }
    const srv = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: JSON.stringify(garbled) } }] }) })
    servers.push(srv)
    const impl = openAiCompatible({ baseUrl: `http://localhost:${srv.port}`, apiKey: "k-123456789012", model: "m" })
    const g = await Effect.runPromise(impl.refine(input))
    expect(g.nodes.map((n) => [n.key, n.label])).toEqual([
      ["n1", "Checkout page"],
      ["n2", "Stripe"],
      ["n3", "Email queue"],
    ])
    expect(g.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["n1->n2", "n1->n3"])
  })

  test("OpenAI-compatible: malformed JSON is a typed error, not a crash", async () => {
    const srv = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: "{nope" } }] }) })
    servers.push(srv)
    const impl = openAiCompatible({ baseUrl: `http://localhost:${srv.port}`, apiKey: "k-123456789012", model: "m" })
    const err = await Effect.runPromise(Effect.flip(impl.refine(input)))
    expect(err).toBeInstanceOf(RefineError)
    expect(err.reason).toContain("bad JSON")
  })

})

// ---------------------------------------------------------------------------
// Protocol with a stub refiner
// ---------------------------------------------------------------------------

function stubRefiner(respond: (text: string) => EntryGraph | null, delayMs = 0) {
  const calls: string[] = []
  const layer = Layer.succeed(Refiner, {
    enabled: true,
    name: "stub",
    refine: (input) =>
      Effect.gen(function* () {
        calls.push(input.text)
        if (delayMs) yield* Effect.sleep(delayMs)
        const g = respond(input.text)
        return g ?? (yield* Effect.fail(new RefineError({ provider: "stub", reason: "no" })))
      }),
  })
  return { layer, calls }
}

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function setup(refiner: Layer.Layer<Refiner>) {
  const server = await startServer({ refiner })
  cleanups.push(() => server.stop())
  const join = async (name: string) => {
    const c = await TestClient.connect(server.url, "r")
    cleanups.push(() => c.close())
    c.send(new Join({ name, color: "#e11d48" }))
    await c.waitFor(is("Welcome"))
    return c
  }
  return { join }
}
const anchor = { x: 0, y: 0 }
const TEXT = "checkout calls stripe, then it emails the user via a queue"

test("after a pause the LLM refines the draft, keeping reused keys' elements", async () => {
  const r = stubRefiner(() => fromLlm(llmGraph))
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  const b = await join("Bo")
  a.send(new SetInput({ text: TEXT, anchor }))
  const instant = await a.waitFor(is("DraftUpdated"))
  const refined = await a.waitFor(is("DraftUpdated", (m) => m.draft.edges.some((e) => e.kind === "publishes")))
  expect(refined.draft.nodes.map((n) => n.label)).toEqual(["Checkout", "Stripe", "Email queue"])
  expect(refined.draft.nodes[0]!.id).toBe(instant.draft.nodes[0]!.id) // p0 reused → same element morphs
})

test("Enter commits the LLM version when it arrives within the wait", async () => {
  process.env.LLM_DEBOUNCE_MS = "60"
  const r = stubRefiner(() => fromLlm(llmGraph), 150)
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  a.send(new SetInput({ text: TEXT, anchor }))
  a.send(new Commit()) // before the debounce fires
  const c = await a.waitFor(is("NodesCommitted"), 3000)
  expect(c.nodes.map((n) => n.label)).toEqual(["Checkout", "Stripe", "Email queue"])
})

test("Enter never waits longer than the commit wait; the instant version is committed", async () => {
  const r = stubRefiner(() => fromLlm(llmGraph), 5000)
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  a.send(new SetInput({ text: "api server", anchor }))
  const started = Date.now()
  a.send(new Commit())
  const c = await a.waitFor(is("NodesCommitted"), 3000)
  expect(Date.now() - started).toBeLessThan(1500)
  expect(c.nodes.map((n) => n.label)).toEqual(["Api server"])
})

test("a stale LLM answer never replaces newer text", async () => {
  const r = stubRefiner((t) => (t === "old idea" ? fromLlm(llmGraph) : null), 200)
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  a.send(new SetInput({ text: "old idea", anchor }))
  await Bun.sleep(120) // debounce fired, refine in flight
  a.send(new SetInput({ text: "postgres", anchor }))
  await Bun.sleep(400)
  const drafts = a.received.flatMap((m) => (m._tag === "DraftUpdated" ? [m.draft] : []))
  expect(drafts.at(-1)!.text).toBe("postgres")
  expect(drafts.some((d) => d.nodes.some((n) => n.label === "Stripe"))).toBe(false)
})

test("handles the LLM invents are dropped; the rest of its graph still shows", async () => {
  const r = stubRefiner(() => ({
    nodes: [{ key: "p0", type: "service", label: "Api", parent: null, props: {} }],
    edges: [{ from: "p0", to: "@ghost", kind: "writes" }],
    suggestions: [{ text: "ghost", handle: "@ghost" }],
    patches: [],
  }))
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  a.send(new SetInput({ text: "api writes to ghost db", anchor }))
  const d = await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes.length === 1 && m.draft.nodes[0]!.label === "Api"))
  expect(d.draft.edges).toEqual([])
})

test("explicit @-commands (edit / wrap / include) are deterministic: the LLM isn't asked to rewrite them", async () => {
  process.env.LLM_DEBOUNCE_MS = "30"
  // The LLM has nothing to add here (declines), so the instant reading is what commits.
  const r = stubRefiner(() => null)
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  a.send(new SetInput({ text: "blue 25 minute timer", anchor }))
  a.send(new Commit())
  const [timer] = (await a.waitFor(is("NodesCommitted"))).nodes
  const before = r.calls.length
  a.send(new SetInput({ text: `make ${timer!.handle} a red clock`, anchor }))
  await Bun.sleep(150)
  a.send(new Commit())
  const up = await a.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === timer!.id)))
  expect(r.calls.slice(before)).toEqual([]) // no refine for the command
  expect(up.nodes.find((n) => n.id === timer!.id)).toMatchObject({ type: "timer", props: { color: "#e03131" } })
})

describe("an LLM answer that only lists changes never wipes the draft", () => {
  const instant = {
    nodes: [
      { key: "p0", type: "service" as const, label: "Checkout service", parent: null, props: {} },
      { key: "p1", type: "external-api" as const, label: "Stripe", parent: null, props: {} },
      { key: "p2", type: "external-api" as const, label: "Then it emails the user via sendgrid", parent: null, props: {} },
    ],
    edges: [{ from: "p0", to: "p1", kind: "calls" as const }],
    suggestions: [],
    patches: [],
  }
  test("an empty answer keeps the instant graph", async () => {
    const { completeFromInstant } = await import("../src/engine/index.ts")
    expect(completeFromInstant({ nodes: [], edges: [], suggestions: [], patches: [] }, instant)).toEqual(instant)
  })
  test("arrows between draft keys bring their nodes, with the model's fixes applied", async () => {
    const { completeFromInstant } = await import("../src/engine/index.ts")
    const g = completeFromInstant(
      {
        nodes: [],
        edges: [
          { from: "p0", to: "p1", kind: "calls" },
          { from: "p0", to: "p2", kind: "calls" },
        ],
        suggestions: [],
        patches: [{ target: "p2", label: "Sendgrid" }],
      },
      instant,
    )
    expect(g.nodes.map((n) => n.label)).toEqual(["Checkout service", "Stripe", "Sendgrid"])
    expect(g.edges).toHaveLength(2)
    expect(g.patches).toEqual([])
  })
})

test("handles the model invents for new elements are local keys, so their arrows survive", async () => {
  const { referToExisting } = await import("../src/engine/index.ts")
  const handles = new Map([["@signup-form", { container: true, type: "form" as const, label: "Signup form", parent: "@signup-page" }]])
  const g = referToExisting(
    {
      nodes: [
        { key: "@signup-form", type: "form", label: "Signup form", parent: "@signup-page", props: {} },
        { key: "@auth-service", type: "service", label: "Auth service", parent: null, props: {} },
      ],
      edges: [{ from: "@signup-form", to: "@auth-service", kind: "calls" }],
      suggestions: [],
      patches: [],
    },
    handles,
    "the signup form posts to an auth service",
  )
  expect(g.nodes.map((n) => [n.key, n.label])).toEqual([["new:auth-service", "Auth service"]])
  expect(g.edges).toEqual([{ from: "@signup-form", to: "new:auth-service", kind: "calls" }])
})
