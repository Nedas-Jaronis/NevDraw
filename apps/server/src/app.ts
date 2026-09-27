import { HttpRouter, HttpServer } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Layer } from "effect"
import { resolve } from "node:path"
import { BoardStore, sqliteStore } from "./BoardStore.ts"
import { ClassifierLive } from "./classify/Classifier.ts"
import { type Jev, JevFromEnv } from "./classify/Jev.ts"
import { type Refiner, RefinerFromEnv } from "./refine/Refiner.ts"
import { env } from "./env.ts"
import { RoomsLive } from "./Rooms.ts"
import { goRemote, sessionInfo } from "./session.ts"
import { roomSocket } from "./socket.ts"
import { staticFiles } from "./static.ts"

export const DEFAULT_DB_PATH = resolve(import.meta.dir, "../../../data/boards.sqlite")

export const router = HttpRouter.empty.pipe(
  HttpRouter.get("/ws/:roomId", roomSocket),
  HttpRouter.get("/api/session", sessionInfo),
  HttpRouter.post("/api/session/remote", goRemote),
  HttpRouter.get("*", staticFiles()),
)

/** The whole app on one port: the web app plus the room WebSocket. */
export const makeApp = (options: {
  port: number
  store?: Layer.Layer<BoardStore>
  jev?: Layer.Layer<Jev>
  refiner?: Layer.Layer<Refiner>
}) =>
  HttpServer.serve(router).pipe(
    HttpServer.withLogAddress,
    Layer.provide(RoomsLive),
    Layer.provide(ClassifierLive.pipe(Layer.provide(options.jev ?? JevFromEnv))),
    Layer.provide(options.refiner ?? RefinerFromEnv),
    Layer.provide(options.store ?? sqliteStore(env("DB_PATH") ?? DEFAULT_DB_PATH)),
    Layer.provideMerge(BunHttpServer.layer({ port: options.port })),
  )
