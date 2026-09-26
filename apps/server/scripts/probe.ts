/**
 * bun run probe: measure real latency of the services the draft engine uses,
 * with whichever keys are in .env, and print recommended tuning values.
 * Missing keys are skipped, never fatal.
 */
import { Effect, Layer } from "effect"
import { Jev, JevFromEnv, looksLikeKey, type PieceState } from "../src/classify/Jev.ts"
import { pieceStates } from "../src/engine/index.ts"
import { split } from "../src/engine/split.ts"
import { gemini, openAiCompatible } from "../src/refine/Refiner.ts"

const RUNS = Number(process.env.PROBE_RUNS) || 5
const ENTRY = "landing page with navbar, hero, three pricing cards in a row and signup form. signup form posts to api server which writes to postgres"

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0)
}
const time = async <A>(f: () => Promise<A>) => {
  const t = performance.now()
  const value = await f()
  return { ms: performance.now() - t, value }
}
const line = (label: string, xs: number[]) =>
  console.log(`  ${label.padEnd(30)} p50 ${String(pct(xs, 50)).padStart(5)} ms   p95 ${String(pct(xs, 95)).padStart(5)} ms   (n=${xs.length})`)

const result: { jevBatchP95?: number; llmP50?: number } = {}

// ── Jev ────────────────────────────────────────────────────────────────────
console.log("\nJev (TypeSafe)")
if (!looksLikeKey(process.env.TYPESAFE_API_KEY)) {
  console.log("  skipped: no TYPESAFE_API_KEY in .env")
} else {
  const pieces = split(ENTRY)
  const states = pieceStates(pieces, ["@postgres"])
  console.log(`  entry split into ${pieces.length} pieces; ${RUNS} runs, one parallel call per piece`)
  const perCall: number[] = []
  const perBatch: number[] = []
  let failures = 0
  const program = Effect.gen(function* () {
    const jev = yield* Jev
    for (let r = 0; r < RUNS; r++) {
      const t = performance.now()
      const answers = yield* Effect.forEach(
        states,
        (s: PieceState) =>
          Effect.gen(function* () {
            const t0 = performance.now()
            const a = yield* Effect.either(jev.answer(s))
            perCall.push(performance.now() - t0)
            if (a._tag === "Left") failures++
            return a
          }),
        { concurrency: "unbounded" },
      )
      perBatch.push(performance.now() - t)
      if (r === 0) {
        for (const [i, a] of answers.entries()) {
          const shown = a._tag === "Right" ? `${a.right.nodeType.value} (${a.right.nodeType.confidence.toFixed(2)})` : `error: ${a.left.reason}`
          console.log(`    ${pieces[i]!.text.padEnd(34)} → ${shown}`)
        }
      }
    }
  })
  await Effect.runPromise(Effect.provide(program, JevFromEnv as Layer.Layer<Jev>))
  line("one piece", perCall)
  line(`whole entry (${pieces.length} in parallel)`, perBatch)
  if (failures) console.log(`  ${failures} failed calls`)
  result.jevBatchP95 = pct(perBatch, 95)
}

// ── LLMs ───────────────────────────────────────────────────────────────────
const llmInput = {
  text: "the checkout page calls stripe, then it emails the user via a queue. an admin dashboard reads orders from @postgres",
  board: [{ handle: "@postgres", type: "database", label: "Postgres", parent: null }],
  draft: [],
}
const llms = [
  looksLikeKey(process.env.GEMINI_API_KEY)
    ? gemini(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-2.5-flash")
    : { name: "gemini", skip: "no GEMINI_API_KEY in .env" },
  looksLikeKey(process.env.GPTOSS_API_KEY)
    ? openAiCompatible({
        baseUrl: process.env.GPTOSS_BASE_URL || "https://api.groq.com/openai/v1",
        apiKey: process.env.GPTOSS_API_KEY,
        model: process.env.GPTOSS_MODEL || "openai/gpt-oss-120b",
      })
    : { name: "gpt-oss", skip: "no GPTOSS_API_KEY in .env" },
]
const llmP50s: number[] = []
for (const impl of llms) {
  console.log(`\nLLM ${impl.name}`)
  if ("skip" in impl) {
    console.log(`  skipped: ${impl.skip}`)
    continue
  }
  const xs: number[] = []
  for (let r = 0; r < Math.min(RUNS, 3); r++) {
    const { ms, value } = await time(() => Effect.runPromise(Effect.either(impl.refine(llmInput))))
    xs.push(ms)
    if (r === 0) {
      if (value._tag === "Right") {
        const g = value.right
        console.log(`    nodes: ${g.nodes.map((n) => `${n.type}:${n.label}`).join(", ")}`)
        console.log(`    edges: ${g.edges.map((e) => `${e.from} -${e.kind}-> ${e.to}`).join(", ")}`)
      } else console.log(`    error: ${value.left.reason}`)
    }
  }
  line("refine", xs)
  llmP50s.push(pct(xs, 50))
}
if (llmP50s.length) result.llmP50 = Math.min(...llmP50s)

// ── Recommendations ────────────────────────────────────────────────────────
console.log("\nRecommended .env tuning")
if (result.jevBatchP95 !== undefined) console.log(`  JEV_TIMEOUT_MS=${Math.max(800, Math.round((result.jevBatchP95 * 2) / 100) * 100)}`)
else console.log("  JEV_TIMEOUT_MS: (needs a Jev key)")
if (result.llmP50 !== undefined) {
  console.log(`  LLM_DEBOUNCE_MS=${Math.max(900, Math.min(2000, Math.round(result.llmP50 / 100) * 100))}`)
  console.log(`  LLM_COMMIT_WAIT_MS=${Math.min(2500, Math.round((result.llmP50 * 1.3) / 100) * 100)}`)
} else console.log("  LLM_DEBOUNCE_MS / LLM_COMMIT_WAIT_MS: (need a Gemini or gpt-oss key)")
console.log("")
