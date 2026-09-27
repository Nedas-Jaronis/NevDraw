import { Context, Effect, Layer } from "effect"
import type { PieceAnswers } from "../engine/answers.ts"
import { Jev, type PieceState } from "./Jev.ts"

/** Small LRU on top of Map's insertion order. */
export class LRU<K, V> {
  private map = new Map<K, V>()
  constructor(private readonly max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k)
    if (v !== undefined) {
      this.map.delete(k)
      this.map.set(k, v)
    }
    return v
  }
  set(k: K, v: V) {
    this.map.delete(k)
    this.map.set(k, v)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K)
  }
  get size() {
    return this.map.size
  }
}

export const cacheKey = (s: PieceState) => JSON.stringify([s.piece.toLowerCase(), s.previous?.toLowerCase() ?? null, s.container?.toLowerCase() ?? null, s.handles])

/**
 * Jev answers per piece, cached on the whole piece state. While someone
 * types, only the piece being edited misses the cache, so a keystroke costs
 * about one Jev call no matter how long the entry is.
 */
export class Classifier extends Context.Tag("Classifier")<
  Classifier,
  {
    readonly enabled: boolean
    /** Synchronous cache lookup; undefined means "use the keyword placeholder for now". */
    readonly peek: (state: PieceState) => PieceAnswers | undefined
    /** Ask Jev for every uncached state in parallel. Failures are logged and skipped. */
    readonly fetch: (states: readonly PieceState[]) => Effect.Effect<{ fetched: number; failed: number }>
    /** Drawing mode: Jev's pick for a sketch description (null when Jev is off or fails). */
    readonly sketch: (sketch: string, exclude: readonly string[]) => Effect.Effect<{ component: string; confidence: number } | null>
  }
>() {}

export const ClassifierLive = Layer.effect(
  Classifier,
  Effect.gen(function* () {
    const jev = yield* Jev
    const cache = new LRU<string, PieceAnswers>(5000)
    let lastWarn = 0

    return {
      enabled: jev.enabled,
      peek: (state) => cache.get(cacheKey(state)),
      sketch: (sketch, exclude) =>
        jev.enabled && jev.sketch ? jev.sketch({ sketch, exclude }).pipe(Effect.catchAll(() => Effect.succeed(null))) : Effect.succeed(null),
      fetch: (states) => {
        if (!jev.enabled) return Effect.succeed({ fetched: 0, failed: 0 })
        const unique = new Map(states.map((s) => [cacheKey(s), s] as const))
        const missing = [...unique].filter(([k]) => !cache.get(k))
        return Effect.forEach(
          missing,
          ([k, s]) =>
            jev.answer(s).pipe(
              Effect.tap((a) => Effect.sync(() => cache.set(k, a))),
              Effect.as(true),
              Effect.catchAll((e) =>
                Effect.sync(() => {
                  if (Date.now() - lastWarn > 10_000) {
                    lastWarn = Date.now()
                    console.warn(`[jev] call failed (${e.reason}); keyword placeholder stays`)
                  }
                  return false
                }),
              ),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((oks) => ({ fetched: oks.filter(Boolean).length, failed: oks.filter((x) => !x).length })))
      },
    }
  }),
)
