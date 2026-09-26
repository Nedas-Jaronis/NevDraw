import { HttpRouter, HttpServer } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Layer } from "effect"
import { RoomsLive } from "./Rooms.ts"
import { roomSocket } from "./socket.ts"
import { staticFiles } from "./static.ts"

export const router = HttpRouter.empty.pipe(
  HttpRouter.get("/ws/:roomId", roomSocket),
  HttpRouter.get("*", staticFiles()),
)

/** The whole app on one port: the web app plus the room WebSocket. */
export const makeApp = (options: { port: number }) =>
  HttpServer.serve(router).pipe(
    HttpServer.withLogAddress,
    Layer.provide(RoomsLive),
    Layer.provideMerge(BunHttpServer.layer({ port: options.port })),
  )
