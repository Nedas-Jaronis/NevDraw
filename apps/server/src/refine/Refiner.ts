import type { EntryGraph } from "@rtw/shared"
import { Context, Data, Duration, Effect, JSONSchema, Layer, Schema } from "effect"
import { looksLikeKey } from "../classify/Jev.ts"
import { env, envNumber } from "../env.ts"
import { fromLlm, LlmGraph, normalizeLlmJson, type RefineInput, SYSTEM, userPrompt } from "./prompt.ts"

export class RefineError extends Data.TaggedError("RefineError")<{ provider: string; reason: string }> {}

/** The background cleanup pass: full entry text + board → an improved EntryGraph. */
export class Refiner extends Context.Tag("Refiner")<
  Refiner,
  {
    readonly enabled: boolean
    readonly name: string
    readonly refine: (input: RefineInput) => Effect.Effect<EntryGraph, RefineError>
  }
>() {}

type Impl = Context.Tag.Service<Refiner>

export const RefinerDisabled = Layer.succeed(Refiner, {
  enabled: false,
  name: "off",
  refine: () => Effect.fail(new RefineError({ provider: "off", reason: "disabled" })),
})

const TIMEOUT = () => Duration.millis(envNumber("LLM_TIMEOUT_MS") ?? 8000)

const decodeLlm = Schema.decodeUnknown(LlmGraph)

/** Our wire schema as JSON Schema, for providers' strict structured output. */
const { $schema: _, ...LLM_JSON_SCHEMA } = JSONSchema.make(LlmGraph) as unknown as Record<string, unknown>

const parseReply = (content: string) =>
  Effect.try({
    try: () => normalizeLlmJson(JSON.parse(content)),
    catch: () => new RefineError({ provider: "gptoss", reason: `bad JSON: ${content.slice(0, 120)}` }),
  }).pipe(
    Effect.flatMap((json) =>
      decodeLlm(json).pipe(Effect.mapError((e) => new RefineError({ provider: "gptoss", reason: `bad JSON: ${e.message.slice(0, 200)}` }))),
    ),
  )

/**
 * gpt-oss-120b (or any model) behind an OpenAI-compatible /chat/completions
 * endpoint (Groq, Cerebras, OpenRouter, …), in JSON mode, decoded with our Schema.
 */
export function openAiCompatible(options: { baseUrl: string; apiKey: string; model: string }): Impl {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`
  /** Strict json_schema (constrained decoding) unless this provider rejects it; then plain JSON mode. */
  let strict = true
  const post = (input: RefineInput, signal: AbortSignal, schemaMode: boolean) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        reasoning_effort: env("LLM_REASONING") ?? "medium",
        response_format: schemaMode
          ? { type: "json_schema", json_schema: { name: "entry_graph", strict: true, schema: LLM_JSON_SCHEMA } }
          : { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(input) },
        ],
      }),
    })
  return {
    enabled: true,
    name: `openai-compat:${options.model} @ ${new URL(url).host}`,
    refine: (input) =>
      Effect.tryPromise({
        try: async (signal) => {
          let res = await post(input, signal, strict)
          if (strict && (res.status === 400 || res.status === 422)) {
            // This provider doesn't do strict json_schema: remember, and use plain JSON mode.
            strict = false
            res = await post(input, signal, false)
          }
          if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
          const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
          return body.choices?.[0]?.message?.content ?? ""
        },
        catch: (e) => new RefineError({ provider: "gptoss", reason: e instanceof Error ? e.message : String(e) }),
      }).pipe(
        Effect.flatMap(parseReply),
        Effect.map(fromLlm),
        Effect.timeoutFail({ duration: TIMEOUT(), onTimeout: () => new RefineError({ provider: "gptoss", reason: "timeout" }) }),
      ),
  }
}

/**
 * From the environment: GPTOSS_API_KEY / GPTOSS_BASE_URL / GPTOSS_MODEL
 * (Cerebras by default). No key → the pass is off and drafts come from
 * Jev / keywords only.
 */
export const RefinerFromEnv = Layer.suspend(() => {
  const key = env("GPTOSS_API_KEY")
  if (!looksLikeKey(key)) {
    console.info("[llm] off: no GPTOSS_API_KEY; the cleanup pass is disabled")
    return RefinerDisabled
  }
  const impl = openAiCompatible({
    baseUrl: env("GPTOSS_BASE_URL") ?? "https://api.cerebras.ai/v1",
    apiKey: key,
    model: env("GPTOSS_MODEL") ?? "gpt-oss-120b",
  })
  console.info(`[llm] on: ${impl.name}`)
  return Layer.succeed(Refiner, impl)
})
