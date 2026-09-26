import { HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { join, normalize, resolve, sep } from "node:path"

export const WEB_DIST = resolve(import.meta.dir, "../../web/dist")

/**
 * Serves the built web app. Unknown paths fall back to index.html so client
 * routes like /b/<id> work on reload.
 */
export const staticFiles = (root: string = WEB_DIST) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname)
    const candidate = normalize(join(root, pathname))
    const insideRoot = candidate === root || candidate.startsWith(root + sep)

    if (insideRoot && pathname !== "/" && (yield* Effect.promise(() => Bun.file(candidate).exists()))) {
      return yield* HttpServerResponse.file(candidate)
    }
    const index = join(root, "index.html")
    if (!(yield* Effect.promise(() => Bun.file(index).exists()))) {
      return HttpServerResponse.text("Web app not built. Run `bun run build`, or use `bun dev`.", { status: 503 })
    }
    return yield* HttpServerResponse.file(index)
  }).pipe(Effect.orDie)
