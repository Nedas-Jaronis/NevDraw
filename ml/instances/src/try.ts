/**
 * Type a command, see how the parser reads it: spans, tags and links, plus the time it took.
 *
 *   bun src/try.ts [runs/ettin32m-links/onnx]
 *   bun src/try.ts runs/ettin32m-links/onnx "a hero with a dashed border"
 */
import { type Example, render } from "./markup.ts"
import { Tagger } from "./tagger.ts"

const args = process.argv.slice(2)
const dir = args[0] ?? new URL("../runs/ettin32m-links/onnx", import.meta.url).pathname
const tagger = await Tagger.load(dir, { int8: false })

async function show(text: string) {
  const t0 = performance.now()
  const spans = await tagger.tag(text)
  const ms = performance.now() - t0
  const ex: Example = { text, spans: spans.map(({ confidence, arcs, ...s }) => ({ ...s, ...(arcs ? { arcs: arcs.map(({ label, head }) => ({ label, head })) } : {}) })) }
  console.log(`\n${render(ex)}   (${ms.toFixed(1)} ms)`)
  const said = (i: number) => text.slice(spans[i]!.start, spans[i]!.end)
  for (const [i, s] of spans.entries()) {
    const links = (s.arcs ?? []).map((a) => `${a.label} → "${said(a.head)}" ${Math.round(a.confidence * 100)}%`).join(", ")
    console.log(`  ${s.tag.padEnd(8)} "${said(i)}" ${Math.round(s.confidence * 100)}%${links ? `   ${links}` : ""}`)
  }
}

if (args[1]) await show(args.slice(1).join(" "))
else {
  await tagger.tag("warm up")
  console.log(`parser loaded from ${dir}. Type a command (Ctrl+C to quit).`)
  process.stdout.write("> ")
  for await (const line of console) {
    if (line.trim()) await show(line.trim())
    process.stdout.write("\n> ")
  }
}
