import { HttpRouter, HttpServer } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Layer } from "effect"
import { resolve } from "node:path"
import { BoardStore, sqliteStore } from "./BoardStore.ts"
import { RoomsLive } from "./Rooms.ts"
import { roomSocket } from "./socket.ts"
import { staticFiles } from "./static.ts"

export const DEFAULT_DB_PATH = resolve(import.meta.dir, "../../../data/boards.sqlite")

export const router = HttpRouter.empty.pipe(
  HttpRouter.get("/ws/:roomId", roomSocket),
  HttpRouter.get("*", staticFiles()),
)

/** The whole app on one port: the web app plus the room WebSocket. */
export const makeApp = (options: { port: number; store?: Layer.Layer<BoardStore> }) =>
  HttpServer.serve(router).pipe(
    HttpServer.withLogAddress,
    Layer.provide(RoomsLive),
    Layer.provide(options.store ?? sqliteStore(process.env.DB_PATH ?? DEFAULT_DB_PATH)),
    Layer.provideMerge(BunHttpServer.layer({ port: options.port })),
  )
