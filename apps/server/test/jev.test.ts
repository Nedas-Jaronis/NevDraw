import { Commit, Join, SetInput, StepDraft } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Classifier, ClassifierLive } from "../src/classify/Classifier.ts"
import { Jev, JevError, type PieceState, toPieceAnswers } from "../src/classify/Jev.ts"
import { keywordAnswers, type PieceAnswers } from "../src/engine/answers.ts"
import { stabilize } from "../src/engine/stabilize.ts"
import { is, startServer, TestClient } from "./helpers.ts"

// ---------------------------------------------------------------------------
// A stub Jev: answers from a lookup table, counts calls, optional delay/failure.
// ---------------------------------------------------------------------------

function stubJev(table: Record<string, Partial<PieceAnswers> & { type?: PieceAnswers["nodeType"]["value"] }>, opts: { delayMs?: number; fail?: boolean } = {}) {
  const calls: PieceState[] = []
  const layer = Layer.succeed(Jev, {
    enabled: true,
    model: "jev-stub",
    answer: (s) =>
      Effect.gen(function* () {
        calls.push(s)
        if (opts.delayMs) yield* Effect.sleep(opts.delayMs)
        if (opts.fail) return yield* Effect.fail(new JevError({ reason: "boom" }))
        const base = keywordAnswers({ index: 0, text: s.piece, connector: "and" })
        const hit = table[s.piece.toLowerCase()] ?? {}
        return {
          ...base,
          ...hit,
          nodeType: hit.type ? { value: hit.type, confidence: 0.95 } : { ...base.nodeType, confidence: 0.95 },
          source: "jev" as const,
        }
      }),
  })
  return { layer, calls }
}

const answer = (type: PieceAnswers["nodeType"]["value"], confidence: number, source: PieceAnswers["source"] = "jev"): PieceAnswers => ({
  nodeType: { value: type, confidence },
  isContainer: 0,
  childOfContainer: 0,
  layout: { value: "none", confidence: 0 },
  edgeKind: { value: "none", confidence: 1 },
  targetsHandle: 0,
  accent: { value: "none", confidence: 1 },
  source,
})

describe("stabilize (per-piece hysteresis, ported from decide.ts)", () => {
  test("Jev replaces a keyword placeholder immediately", () => {
    const first = stabilize(undefined, answer("box", 0.3, "keyword"))
    const next = stabilize(first.memory, answer("page", 0.5))
    expect(next.answers.nodeType.value).toBe("page")
  })

  test("a weak challenger must win twice in a row", () => {
    let m = stabilize(undefined, answer("section", 0.8)).memory
    let r = stabilize(m, answer("card", 0.6))
    expect(r.answers.nodeType.value).toBe("section")
    m = r.memory
    r = stabilize(m, answer("card", 0.6))
    expect(r.answers.nodeType.value).toBe("card")
  })

  test("a different challenger resets the count", () => {
    let m = stabilize(undefined, answer("section", 0.8)).memory
    m = stabilize(m, answer("card", 0.6)).memory
    const r = stabilize(m, answer("form", 0.6))
    expect(r.answers.nodeType.value).toBe("section")
  })

  test("a very confident challenger wins at once", () => {
    const m = stabilize(undefined, answer("section", 0.8)).memory
    expect(stabilize(m, answer("database", 0.9)).answers.nodeType.value).toBe("database")
  })

  test("a low-confidence challenger never wins", () => {
    let m = stabilize(undefined, answer("section", 0.8)).memory
    m = stabilize(m, answer("card", 0.2)).memory
    expect(stabilize(m, answer("card", 0.2)).answers.nodeType.value).toBe("section")
  })
})

test("raw systemOne answers map onto PieceAnswers; unknown types become box", () => {
  const raw = {
    nodeType: { choice: "banana", confidence: 0.7 },
    isContainer: { noul: 0.9 },
    childOfContainer: { noul: 0.1 },
    layout: { choice: "row", confidence: 0.8 },
    edgeKind: { choice: "writes", confidence: 0.6 },
    targetsHandle: { noul: 0 },
  }
  expect(toPieceAnswers(raw)).toMatchObject({ nodeType: { value: "box" }, isContainer: 0.9, layout: { value: "row" }, edgeKind: { value: "writes" }, source: "jev" })
})

test("the classifier caches per piece state and fetches misses in parallel", async () => {
  const jev = stubJev({}, { delayMs: 50 })
  const run = <A>(e: Effect.Effect<A, never, Classifier>) => Effect.runPromise(Effect.provide(e, ClassifierLive.pipe(Layer.provide(jev.layer))))
  const s = (piece: string): PieceState => ({ piece, previous: null, container: null, handles: [] })
  const started = Date.now()
  const out = await run(
    Effect.gen(function* () {
      const c = yield* Classifier
      const first = yield* c.fetch([s("a"), s("b"), s("c"), s("a")])
      const second = yield* c.fetch([s("a"), s("b"), s("d")])
      return { first, second, hit: c.peek(s("c")) }
    }),
  )
  expect(out.first.fetched).toBe(3) // "a" deduplicated
  expect(out.second.fetched).toBe(1) // only "d" was missing
  expect(out.hit?.source).toBe("jev")
  expect(Date.now() - started).toBeLessThan(400) // parallel, not 4 × 50ms serial … twice
  expect(jev.calls.map((c) => c.piece)).toEqual(["a", "b", "c", "d"])
})

// ---------------------------------------------------------------------------
// Protocol: instant keyword draft, then the Jev refinement.
// ---------------------------------------------------------------------------

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})
async function boot(jev: Layer.Layer<Jev>) {
  const server = await startServer({ jev })
  cleanups.push(() => server.stop())
  return server
}
async function join(url: string, name: string) {
  const c = await TestClient.connect(url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name, color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  return c
}
const anchor = { x: 0, y: 0 }

test("a draft appears instantly from keywords, then Jev's answer refines it", async () => {
  // Keywords can't tell "big brand moment" is a hero; Jev can.
  const jev = stubJev({ "big brand moment": { type: "hero" } }, { delayMs: 60 })
  const s = await boot(jev.layer)
  const a = await join(s.url, "Ada")
  const b = await join(s.url, "Bo")
  a.send(new SetInput({ text: "big brand moment", anchor }))
  const first = await a.waitFor(is("DraftUpdated"))
  expect(first.draft.nodes[0]!.type).toBe("box")
  expect(first.debug?.[0]?.source).toBe("keyword")
  const refined = await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes[0]?.type === "hero"))
  expect(refined.draft.nodes[0]!.id).toBe(first.draft.nodes[0]!.id) // same element, it morphs
  expect(refined.debug?.[0]?.source).toBe("jev")
})

test("typing at the end only asks Jev about the piece that changed", async () => {
  const jev = stubJev({})
  const s = await boot(jev.layer)
  const a = await join(s.url, "Ada")
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(20)
  }
  a.send(new SetInput({ text: "landing page with navbar", anchor }))
  await until(() => jev.calls.length >= 2)
  const before = jev.calls.length
  a.send(new SetInput({ text: "landing page with navbar, hero", anchor }))
  await until(() => jev.calls.length > before)
  await Bun.sleep(100)
  expect(jev.calls.slice(before).map((c) => c.piece)).toEqual(["hero"])
})

test("a stale Jev answer never overwrites newer text (latest input wins)", async () => {
  const jev = stubJev({ "old idea": { type: "hero" } }, { delayMs: 150 })
  const s = await boot(jev.layer)
  const a = await join(s.url, "Ada")
  const b = await join(s.url, "Bo")
  a.send(new SetInput({ text: "old idea", anchor }))
  await a.waitFor(is("DraftUpdated", (m) => m.draft.text === "old idea"))
  a.send(new SetInput({ text: "postgres", anchor }))
  await a.waitFor(is("DraftUpdated", (m) => m.draft.text === "postgres"))
  await Bun.sleep(450) // the slow "old idea" answer lands in here, and must not be shown
  const texts = a.received.flatMap((m) => (m._tag === "DraftUpdated" ? [m.draft.text] : []))
  expect(texts.lastIndexOf("old idea")).toBeLessThan(texts.indexOf("postgres"))
})

test("when Jev fails, drafts still work from keywords and commit normally", async () => {
  const jev = stubJev({}, { fail: true })
  const s = await boot(jev.layer)
  const a = await join(s.url, "Ada")
  a.send(new SetInput({ text: "redis cache", anchor }))
  await a.waitFor(is("DraftUpdated"))
  a.send(new Commit())
  const committed = await a.waitFor(is("NodesCommitted"))
  expect(committed.nodes[0]!.type).toBe("cache")
})

test("step back to an earlier version of the draft (Instant ← Jev) and commit that one", async () => {
  const jev = stubJev({ "big brand moment": { type: "hero" } }, { delayMs: 60 })
  const s = await boot(jev.layer)
  const a = await join(s.url, "Ada")
  a.send(new SetInput({ text: "big brand moment", anchor }))
  const refined = await a.waitFor(is("DraftUpdated", (m) => m.draft.nodes[0]?.type === "hero"))
  expect(refined.draft.history).toEqual({ at: 2, total: 2, source: "Jev" })
  a.send(new StepDraft({ delta: -1 }))
  const back = await a.waitFor(is("DraftUpdated", (m) => m.draft.history?.at === 1 && m.draft.history.total === 2))
  expect(back.draft.nodes[0]!.type).toBe("box")
  expect(back.draft.history).toEqual({ at: 1, total: 2, source: "Instant" })
  a.send(new Commit())
  const committed = await a.waitFor(is("NodesCommitted"))
  expect(committed.nodes[0]!.type).toBe("box")
})
