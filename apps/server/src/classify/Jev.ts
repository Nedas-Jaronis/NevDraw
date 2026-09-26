import { type Accent, ACCENT_NAMES, type EdgeKind, type Layout, NODE_TYPES, type NodeType } from "@rtw/shared"
import { TypeSafeClient } from "@typesafe-ai/sdk"
import { Context, Data, Duration, Effect, Layer } from "effect"
import type { PieceAnswers } from "../engine/answers.ts"
import { env, envNumber } from "../env.ts"
import { pieceQuestions } from "./jevQuestions.ts"

/** What Jev sees for one piece. Also the cache key, so keep it small and deterministic. */
export type PieceState = {
  piece: string
  previous: string | null
  container: string | null
  handles: readonly string[]
}

export class JevError extends Data.TaggedError("JevError")<{ reason: string }> {}

export class Jev extends Context.Tag("Jev")<
  Jev,
  {
    readonly enabled: boolean
    readonly model: string
    readonly answer: (state: PieceState) => Effect.Effect<PieceAnswers, JevError>
  }
>() {}

/** A real-looking key: not empty and not a copied placeholder. */
export function looksLikeKey(key: string | undefined): key is string {
  const k = key?.trim() ?? ""
  return k.length >= 12 && !/\.\.\.|your|xxx|placeholder|changeme|<|>/i.test(k)
}

const NODE_TYPE_SET = new Set<string>(NODE_TYPES)

type Choice<T extends string> = { choice: T; confidence: number }

/** Map a raw systemOne result onto PieceAnswers. Exported for tests. */
export function toPieceAnswers(a: {
  nodeType: Choice<string>
  isContainer: { noul: number }
  childOfContainer: { noul: number }
  layout: Choice<string>
  edgeKind: Choice<string>
  targetsHandle: { noul: number }
  accent?: Choice<string>
}): PieceAnswers {
  const type = (NODE_TYPE_SET.has(a.nodeType.choice) ? a.nodeType.choice : "box") as NodeType
  return {
    nodeType: { value: type, confidence: a.nodeType.confidence },
    isContainer: a.isContainer.noul,
    childOfContainer: a.childOfContainer.noul,
    layout: { value: a.layout.choice as Layout | "none", confidence: a.layout.confidence },
    edgeKind: { value: a.edgeKind.choice as EdgeKind | "none", confidence: a.edgeKind.confidence },
    targetsHandle: a.targetsHandle.noul,
    accent:
      a.accent && (ACCENT_NAMES as string[]).includes(a.accent.choice)
        ? { value: a.accent.choice as Accent, confidence: a.accent.confidence }
        : { value: "none", confidence: a.accent?.confidence ?? 1 },
    source: "jev",
  }
}

export const JevDisabled = Layer.succeed(Jev, {
  enabled: false,
  model: "jev-offline",
  answer: () => Effect.fail(new JevError({ reason: "disabled" })),
})

/**
 * Jev from the environment: TYPESAFE_API_KEY enables it, JEV_MODEL pins the
 * version, JEV_TIMEOUT_MS bounds one attempt. One fast attempt, no retries:
 * a stale answer is worse than the keyword placeholder.
 */
export const JevFromEnv = Layer.suspend(() => {
  const key = env("TYPESAFE_API_KEY")
  if (!looksLikeKey(key)) {
    console.info("[jev] offline: no TYPESAFE_API_KEY set; drafts use the keyword classifier")
    return JevDisabled
  }
  const model = env("JEV_MODEL") ?? "jev-latest"
  // Live probe 2026-09-26: whole entry p95 ≈ 420 ms; 800 ms keeps drafts snappy.
  const timeout = envNumber("JEV_TIMEOUT_MS") ?? 800
  const client = new TypeSafeClient({ apiKey: key, defaultModel: model, retry: { maxRetries: 0 }, timeout })
  console.info(`[jev] online: ${model}, timeout ${timeout}ms`)
  return Layer.succeed(Jev, {
    enabled: true,
    model,
    answer: (state) =>
      Effect.tryPromise({
        try: (signal) => client.systemOne({ state: { ...state, handles: [...state.handles] }, questions: pieceQuestions }, { signal }),
        catch: (e) => new JevError({ reason: e instanceof Error ? e.message : String(e) }),
      }).pipe(
        Effect.map((res) => toPieceAnswers(res.answers)),
        Effect.timeoutFail({ duration: Duration.millis(timeout + 250), onTimeout: () => new JevError({ reason: "timeout" }) }),
      ),
  })
})
