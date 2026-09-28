/**
 * Score an exported model on the gold set and time it, the way the server would run it.
 *
 *   bun src/eval.ts runs/ettin-encoder-32m/onnx [--fp32] [--threads 2] [--errors]
 *
 * Checks first that this tokenizer builds the same ids Python trained on
 * (wordcheck.json); a mismatch would make every score meaningless.
 */
import { type Example, type Span, TAGS, parseFile, render } from "./markup.ts"
import { Tagger } from "./tagger.ts"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
if (!dir) throw new Error("usage: bun src/eval.ts <runs/NAME/onnx> [--fp32] [--threads N] [--errors]")
const threads = Number(args[args.indexOf("--threads") + 1]) || 2
const tagger = await Tagger.load(dir, { int8: !args.includes("--fp32"), threads })

// 1. Same token ids as training?
const check: Record<string, number[]> = await Bun.file(`${dir}/wordcheck.json`).json()
const bad = Object.entries(check).filter(([w, ids]) => tagger.wordIds(w).join() !== ids.join())
if (bad.length) {
  console.error(`tokenizer mismatch on ${bad.length} words, e.g.`, bad.slice(0, 3).map(([w, ids]) => ({ w, python: ids, bun: tagger.wordIds(w) })))
  process.exit(1)
}
console.log(`tokenizer: ${Object.keys(check).length} words match Python`)

// 2. Accuracy on gold.
const gold = parseFile(await Bun.file(new URL("../data/gold.txt", import.meta.url)).text())
const preds: Span[][] = []
for (const ex of gold) preds.push(await tagger.tag(ex.text))

type Count = { tp: number; fp: number; fn: number }
const per = Object.fromEntries(TAGS.map((t) => [t, { tp: 0, fp: 0, fn: 0 } as Count]))
const key = (s: Span) => `${s.start}:${s.end}:${s.tag}`
let exact = 0
gold.forEach((g, i) => {
  const gs = new Set(g.spans.map(key))
  const ps = new Set(preds[i]!.map(key))
  if (gs.size === ps.size && [...gs].every((k) => ps.has(k))) exact++
  for (const t of TAGS) {
    const gt = [...gs].filter((k) => k.endsWith(":" + t))
    const pt = [...ps].filter((k) => k.endsWith(":" + t))
    per[t]!.tp += gt.filter((k) => ps.has(k)).length
    per[t]!.fn += gt.filter((k) => !ps.has(k)).length
    per[t]!.fp += pt.filter((k) => !gs.has(k)).length
  }
})
const f1 = (c: Count) => {
  const p = c.tp / (c.tp + c.fp || 1)
  const r = c.tp / (c.tp + c.fn || 1)
  return { p, r, f: p + r ? (2 * p * r) / (p + r) : 0 }
}
const total = Object.values(per).reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }), { tp: 0, fp: 0, fn: 0 })
const o = f1(total)
console.log(`\nGOLD: F1 ${o.f.toFixed(3)} (P ${o.p.toFixed(3)} R ${o.r.toFixed(3)}), whole sentence right ${((100 * exact) / gold.length).toFixed(1)}%`)
for (const t of TAGS) {
  const s = f1(per[t]!)
  console.log(`  ${t.padEnd(9)} F1 ${s.f.toFixed(3)}  P ${s.p.toFixed(3)}  R ${s.r.toFixed(3)}  (n=${per[t]!.tp + per[t]!.fn})`)
}

// 3. Latency: tokenize + run + decode, per input, after warm-up. Fresh cache for a fair number.
const texts = gold.map((g) => g.text)
for (const t of texts) await tagger.tag(t)
const times: number[] = []
for (let round = 0; round < 5; round++)
  for (const t of texts) {
    const a = performance.now()
    await tagger.tag(t)
    times.push(performance.now() - a)
  }
times.sort((a, b) => a - b)
const pct = (p: number) => times[Math.floor(times.length * p)]!.toFixed(1)
console.log(`\nlatency (${threads} threads, ${args.includes("--fp32") ? "fp32" : "int8"}): p50 ${pct(0.5)} ms  p95 ${pct(0.95)} ms  p99 ${pct(0.99)} ms`)

if (args.includes("--errors")) {
  console.log("\nmisses:")
  gold.forEach((g, i) => {
    const got: Example = { text: g.text, spans: preds[i]! }
    if (render(g) !== render(got)) console.log(`want ${render(g)}\ngot  ${render(got)}\n`)
  })
}
