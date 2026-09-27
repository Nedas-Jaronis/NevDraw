import { HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Option } from "effect"
import { cloudflaredPath, openTunnel, publicUrl } from "./tunnel.ts"

/**
 * The host is whoever is on this machine: a loopback address and no
 * Cloudflare headers (everyone arriving through the tunnel has those).
 */
const isHost = (req: HttpServerRequest.HttpServerRequest) => {
  const h = req.headers
  if (h["cf-connecting-ip"] || h["cf-ray"] || h["x-forwarded-for"]) return false
  const addr = Option.getOrElse(req.remoteAddress, () => "")
  return addr === "" || addr === "::1" || addr.startsWith("127.") || addr === "::ffff:127.0.0.1" || addr === "localhost"
}

/** What this viewer can do: the public link if there is one, and whether they may open one. */
export const sessionInfo = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const host = isHost(req)
  return yield* HttpServerResponse.json({ publicUrl: publicUrl(), host, canGoRemote: host && cloudflaredPath() !== null })
}).pipe(Effect.orDie)

/** Host only: open (or reuse) the public tunnel to the port this page came from. */
export const goRemote = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  if (!isHost(req)) return yield* HttpServerResponse.json({ error: "only the host can open a public link" }, { status: 403 })
  const port = /:(\d+)$/.exec(req.headers.host ?? "")?.[1] ?? "80"
  const result = yield* Effect.tryPromise(() => openTunnel(`http://localhost:${port}`)).pipe(
    Effect.map((url) => ({ publicUrl: url })),
    Effect.catchAll((e) => Effect.succeed({ error: e.error instanceof Error ? e.error.message : "couldn't open a public link" })),
  )
  return yield* HttpServerResponse.json(result, { status: "error" in result ? 500 : 200 })
}).pipe(Effect.orDie)
