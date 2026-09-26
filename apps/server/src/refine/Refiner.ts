import { LanguageModel } from "@effect/ai"
import { GoogleClient, GoogleLanguageModel } from "@effect/ai-google"
import { FetchHttpClient } from "@effect/platform"
import type { EntryGraph } from "@rtw/shared"
import { Context, Data, Duration, Effect, JSONSchema, Layer, Redacted, Schema } from "effect"
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

/** gemini-2.5-flash is closed to new API users; this is the current default. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"

/** Gemini through @effect/ai-google, with the schema enforced by Gemini itself. */
export function gemini(apiKey: string, model: string, apiUrl?: string): Impl {
  const layer = GoogleLanguageModel.layer({ model }).pipe(
    Layer.provide(GoogleClient.layer({ apiKey: Redacted.make(apiKey), ...(apiUrl ? { apiUrl } : {}) })),
    Layer.provide(FetchHttpClient.layer),
  )
  return {
    enabled: true,
    name: `gemini:${model}`,
    refine: (input) =>
      LanguageModel.generateObject({
        prompt: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [{ type: "text", text: userPrompt(input) }] },
        ],
        schema: LlmGraph,
        objectName: "entry_graph",
      }).pipe(
        Effect.map((r) => fromLlm(r.value)),
        Effect.provide(layer),
        Effect.timeoutFail({ duration: TIMEOUT(), onTimeout: () => new RefineError({ provider: "gemini", reason: "timeout" }) }),
        Effect.mapError((e) => (e instanceof RefineError ? e : new RefineError({ provider: "gemini", reason: String(e) }))),
      ),
  }
}

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
        reasoning_effort: "low",
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

/** Try the primary; on any failure, the fallback. */
export function withFallback(primary: Impl, fallback: Impl | null): Impl {
  if (!fallback) return primary
  return {
    enabled: true,
    name: `${primary.name} → ${fallback.name}`,
    refine: (input) =>
      primary.refine(input).pipe(
        Effect.tapError((e) => Effect.sync(() => console.warn(`[llm] ${e.provider} failed (${e.reason.slice(0, 120)}); falling back`))),
        Effect.orElse(() => fallback.refine(input)),
      ),
  }
}

/**
 * From the environment: GEMINI_API_KEY / GEMINI_MODEL, GPTOSS_API_KEY /
 * GPTOSS_BASE_URL / GPTOSS_MODEL, LLM_PROVIDER picks the primary (gemini | gptoss).
 * No keys → the pass is off and drafts come from Jev / keywords only.
 */
export const RefinerFromEnv = Layer.suspend(() => {
  const geminiKey = env("GEMINI_API_KEY")
  const gptossKey = env("GPTOSS_API_KEY")
  const g = looksLikeKey(geminiKey) ? gemini(geminiKey, env("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL) : null
  const o = looksLikeKey(gptossKey)
    ? openAiCompatible({
        baseUrl: env("GPTOSS_BASE_URL") ?? "https://api.cerebras.ai/v1",
        apiKey: gptossKey,
        model: env("GPTOSS_MODEL") ?? "gpt-oss-120b",
      })
    : null
  const [primary, fallback] = env("LLM_PROVIDER") === "gptoss" ? [o, g] : [g, o]
  const impl = primary ? withFallback(primary, fallback) : fallback
  if (!impl) {
    console.info("[llm] off: no GEMINI_API_KEY or GPTOSS_API_KEY; the cleanup pass is disabled")
    return RefinerDisabled
  }
  console.info(`[llm] on: ${impl.name}`)
  return Layer.succeed(Refiner, impl)
})
