process.env.LLM_DEBOUNCE_MS = "60"
process.env.LLM_COMMIT_WAIT_MS = "400"

import type { EntryGraph } from "@rtw/shared"
import { Commit, Join, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { fromLlm, type LlmGraph, SYSTEM, userPrompt } from "../src/refine/prompt.ts"
import { gemini, openAiCompatible, RefineError, Refiner, withFallback } from "../src/refine/Refiner.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const llmGraph: LlmGraph = {
  nodes: [
    { key: "p0", type: "service", label: "Checkout", parent: "", layout: "none" },
    { key: "n1", type: "external-api", label: "Stripe", parent: "", layout: "none" },
    { key: "n2", type: "queue", label: "Email queue", parent: "", layout: "none" },
  ],
  edges: [
    { from: "p0", to: "n1", kind: "calls" },
    { from: "p0", to: "n2", kind: "publishes" },
  ],
  suggestions: [],
}

describe("LLM wire format", () => {
  test("fromLlm maps '' to top level, 'none' to no layout, and drops self-loops", () => {
    const g = fromLlm({
      nodes: [
        { key: "a", type: "page", label: " Home ", parent: "", layout: "row" },
        { key: "b", type: "hero", label: "Hero", parent: "a", layout: "none" },
        { key: "c", type: "text", label: "Orphan", parent: "zzz", layout: "none" },
      ],
      edges: [{ from: "a", to: "a", kind: "calls" }],
      suggestions: [],
    })
    expect(g.nodes.map((n) => [n.key, n.parent, n.label, n.props.layout])).toEqual([
      ["a", null, "Home", "row"],
      ["b", "a", "Hero", undefined],
      ["c", null, "Orphan", undefined],
    ])
    expect(g.edges).toEqual([])
  })

  test("the prompt carries the text, the board's handles and the draft's keys", () => {
    const u = JSON.parse(userPrompt({ text: "x", board: [{ handle: "@db", type: "database", label: "Db", parent: null }], draft: [{ key: "p0", type: "box", label: "X", parent: null }] }))
    expect(u).toEqual({
      text: "x",
      board: [{ handle: "@db", type: "database", label: "Db", parent: null }],
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

  test("OpenAI-compatible (gpt-oss): JSON mode request, decoded with our schema", async () => {
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
    expect(seen.body).toMatchObject({ model: "openai/gpt-oss-120b", response_format: { type: "json_object" } })
    expect(seen.body.messages[0].content).toBe(SYSTEM)
    expect(g.edges.map((e) => e.kind)).toEqual(["calls", "publishes"])
  })

  test("OpenAI-compatible: malformed JSON is a typed error, not a crash", async () => {
    const srv = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: "{nope" } }] }) })
    servers.push(srv)
    const impl = openAiCompatible({ baseUrl: `http://localhost:${srv.port}`, apiKey: "k-123456789012", model: "m" })
    const err = await Effect.runPromise(Effect.flip(impl.refine(input)))
    expect(err).toBeInstanceOf(RefineError)
    expect(err.reason).toContain("bad JSON")
  })

  test("Gemini through @effect/ai-google: sends a response schema and decodes the object", async () => {
    let seen: any = null
    const srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seen = { url: new URL(req.url).pathname, key: req.headers.get("x-goog-api-key"), body: await req.json() }
        return Response.json({
          candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(llmGraph) }] }, finishReason: "STOP", index: 0 }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          modelVersion: "gemini-2.5-flash",
        })
      },
    })
    servers.push(srv)
    const impl = gemini("g-123456789012", "gemini-2.5-flash", `http://localhost:${srv.port}`)
    const g = await Effect.runPromise(impl.refine(input))
    expect(seen.url).toContain("gemini-2.5-flash:generateContent")
    expect(seen.key).toBe("g-123456789012")
    expect(seen.body.generationConfig.responseMimeType).toBe("application/json")
    expect(seen.body.generationConfig.responseSchema).toBeTruthy()
    expect(g.nodes.map((n) => n.label)).toEqual(["Checkout", "Stripe", "Email queue"])
  })

  test("fallback: when the primary fails, the secondary answers", async () => {
    const failing = { enabled: true, name: "a", refine: () => Effect.fail(new RefineError({ provider: "a", reason: "down" })) }
    const working = { enabled: true, name: "b", refine: () => Effect.succeed(fromLlm(llmGraph)) }
    const g = await Effect.runPromise(withFallback(failing, working).refine(input))
    expect(g.nodes).toHaveLength(3)
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
  const instant = await b.waitFor(is("DraftUpdated"))
  const refined = await b.waitFor(is("DraftUpdated", (m) => m.draft.edges.some((e) => e.kind === "publishes")))
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
  }))
  const { join } = await setup(r.layer)
  const a = await join("Ada")
  a.send(new SetInput({ text: "api writes to ghost db", anchor }))
  const d = await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes.length === 1 && m.draft.nodes[0]!.label === "Api"))
  expect(d.draft.edges).toEqual([])
})
