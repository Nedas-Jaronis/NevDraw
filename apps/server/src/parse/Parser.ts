import { type BoardEdge, type BoardNode } from "@rtw/shared"
import { render, Tagger, type TaggedSpan } from "@rtw/parser"
import { Context, Duration, Effect, Layer } from "effect"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { existsSync } from "node:fs"
import { LRU } from "../classify/Classifier.ts"
import { env, envNumber } from "../env.ts"

/**
 * The instance parser (packages/parser), loaded in-process from models/parser/.
 *
 *   off     not loaded; the board reads text exactly as before
 *   shadow  loaded; every commit is also read by the model and logged next to what the board made
 *           (data/parser-shadow.jsonl), but nothing on the board changes
 *   on      reserved for when the model's reading drives drafts
 *
 * Default: shadow when the model files are there (`bun run fetch-model`), off otherwise.
 */
export type ParserMode = "off" | "shadow" | "on"

export class Parser extends Context.Tag("Parser")<
  Parser,
  {
    readonly mode: ParserMode
    /** Release and run it was trained as, e.g. "parser-v2 (ettin32m-nested)". */
    readonly version: string | null
    /** The model's reading of `text`, cached by text; null when off, failed or slower than the timeout. */
    readonly parse: (text: string) => Effect.Effect<TaggedSpan[] | null>
    /** Shadow mode: log the model's reading of a committed entry next to what the board made. */
    readonly shadow: (text: string, made: { nodes: readonly BoardNode[]; edges: readonly BoardEdge[] }) => Effect.Effect<void>
  }
>() {}

export const DEFAULT_MODEL_DIR = resolve(import.meta.dir, "../../../../models/parser")
export const DEFAULT_SHADOW_LOG = resolve(import.meta.dir, "../../../../data/parser-shadow.jsonl")

const disabled: Parser["Type"] = {
  mode: "off",
  version: null,
  parse: () => Effect.succeed(null),
  shadow: () => Effect.void,
}
export const ParserDisabled = Layer.succeed(Parser, disabled)

/** Loads the model when PARSER (or the default) says so; any failure logs once and leaves the board as before. */
export const ParserFromEnv = Layer.effect(
  Parser,
  Effect.gen(function* () {
    const dir = env("MODEL_DIR") ?? DEFAULT_MODEL_DIR
    const asked = env("PARSER")
    const mode: ParserMode = asked === "off" || asked === "shadow" || asked === "on" ? asked : existsSync(`${dir}/model.onnx`) ? "shadow" : "off"
    if (mode === "off") {
      console.log(asked ? "[parser] off" : "[parser] off: no model in models/parser (run `bun run fetch-model`)")
      return disabled
    }
    const loaded = yield* Effect.tryPromise(() => Tagger.load(dir, { int8: false, threads: envNumber("PARSER_THREADS") ?? 2 })).pipe(
      Effect.tapError((e) => Effect.sync(() => console.warn(`[parser] off: couldn't load ${dir} (${e.cause instanceof Error ? e.cause.message : e.cause})`))),
      Effect.option,
    )
    if (loaded._tag === "None") return disabled
    const tagger = loaded.value
    const version = existsSync(`${dir}/VERSION`) ? (yield* Effect.promise(() => Bun.file(`${dir}/VERSION`).text())).trim() : dir
    const timeout = Duration.millis(envNumber("PARSER_TIMEOUT_MS") ?? 50)
    const log = env("PARSER_LOG") ?? DEFAULT_SHADOW_LOG
    const cache = new LRU<string, TaggedSpan[]>(2000)
    console.log(`[parser] ${mode}: ${version}`)

    const parse = (text: string) =>
      Effect.suspend(() => {
        const hit = cache.get(text)
        if (hit) return Effect.succeed(hit as TaggedSpan[] | null)
        return Effect.tryPromise(() => tagger.tag(text)).pipe(
          Effect.tap((spans) => Effect.sync(() => cache.set(text, spans))),
          Effect.timeout(timeout),
          Effect.orElseSucceed(() => null),
        )
      })

    return {
      mode,
      version,
      parse,
      shadow: (text, made) =>
        Effect.gen(function* () {
          // Commit is off the typing path, so this read gets a longer leash than a keystroke's.
          const spans = yield* Effect.tryPromise(() => tagger.tag(text)).pipe(Effect.orElseSucceed(() => null))
          if (!spans) return
          const entry = shadowEntry(text, spans, made, version)
          yield* Effect.tryPromise(async () => {
            await mkdir(dirname(log), { recursive: true })
            await appendFile(log, JSON.stringify(entry) + "\n")
          }).pipe(Effect.ignore)
          if (!entry.agree) console.log(`[parser] shadow: differs on "${text.length > 80 ? text.slice(0, 77) + "..." : text}"`)
        }),
    }
  }),
)

/** A name as both sides can compare it: "Load balancer 2" and "load balancers" are the same thing. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^[@{]|}$/g, "")
    .replace(/\b(a|an|the|\d+)\b/g, "")
    .replace(/[^a-z]/g, "")
    .replace(/(?<!s)s$/, "")

/**
 * One commit, read both ways. `agree` compares what sits inside what and what connects to what,
 * by name; the full readings are kept so a person can judge the disagreements.
 */
export function shadowEntry(text: string, spans: readonly TaggedSpan[], made: { nodes: readonly BoardNode[]; edges: readonly BoardEdge[] }, version: string) {
  const said = (i: number) => text.slice(spans[i]!.start, spans[i]!.end)
  // A back-reference ("the databases") stands for what it refers to.
  const meant = (i: number): number => {
    const same = spans[i]!.arcs?.find((a) => a.label === "same")
    return same && same.head !== i ? meant(same.head) : i
  }
  const modelInside = new Set<string>()
  const modelEdges = new Set<string>()
  spans.forEach((s, i) => {
    for (const a of s.arcs ?? []) if (a.label === "in") modelInside.add(`${norm(said(meant(i)))}<${norm(said(meant(a.head)))}`)
  })
  spans.forEach((s, r) => {
    if (s.tag !== "RELATION") return
    const ends = (label: string) => spans.flatMap((x, i) => (x.arcs?.some((a) => a.label === label && a.head === r) ? [norm(said(meant(i)))] : []))
    for (const from of ends("src")) for (const to of ends("dst")) modelEdges.add(`${from}>${to}`)
  })
  const byId = new Map(made.nodes.map((n) => [n.id, n]))
  const boardInside = new Set(made.nodes.flatMap((n) => (n.parent && byId.has(n.parent) ? [`${norm(n.label)}<${norm(byId.get(n.parent)!.label)}`] : [])))
  const boardEdges = new Set(made.edges.flatMap((e) => (byId.has(e.from) && byId.has(e.to) ? [`${norm(byId.get(e.from)!.label)}>${norm(byId.get(e.to)!.label)}`] : [])))
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))
  return {
    at: new Date().toISOString(),
    version,
    text,
    agree: same(modelInside, boardInside) && same(modelEdges, boardEdges),
    model: render({ text, spans: spans.map(({ confidence, arcs, ...s }) => ({ ...s, ...(arcs ? { arcs: arcs.map(({ label, head }) => ({ label, head })) } : {}) })) }),
    modelInside: [...modelInside],
    boardInside: [...boardInside],
    modelEdges: [...modelEdges],
    boardEdges: [...boardEdges],
    board: made.nodes.map((n) => ({ label: n.label, type: n.type, inside: n.parent ? (byId.get(n.parent)?.label ?? "(existing)") : null })),
  }
}
