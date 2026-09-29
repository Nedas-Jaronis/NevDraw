import { HttpServer } from "@effect/platform"
import { type ClientMessage, decodeServerMessage, encodeClientMessage, type ServerMessage } from "@rtw/shared"
import { Effect, Either, type Layer, ManagedRuntime } from "effect"
import { makeApp } from "../src/app.ts"
import { type BoardStore, makeMemoryStore } from "../src/BoardStore.ts"
import { type Jev, JevDisabled } from "../src/classify/Jev.ts"
import { type Parser, ParserDisabled } from "../src/parse/Parser.ts"
import { type Refiner, RefinerDisabled } from "../src/refine/Refiner.ts"

/** Boots the real server on a random port for protocol-level tests. */
export async function startServer(
  options: { store?: Layer.Layer<BoardStore>; jev?: Layer.Layer<Jev>; refiner?: Layer.Layer<Refiner>; parser?: Layer.Layer<Parser> } = {},
) {
  const runtime = ManagedRuntime.make(
    makeApp({
      port: 0,
      store: options.store ?? makeMemoryStore(),
      jev: options.jev ?? JevDisabled,
      refiner: options.refiner ?? RefinerDisabled,
      parser: options.parser ?? ParserDisabled,
    }),
  )
  const address = await runtime.runPromise(Effect.map(HttpServer.HttpServer, (s) => s.address))
  if (address._tag !== "TcpAddress") throw new Error("expected a TCP address")
  return {
    url: `ws://127.0.0.1:${address.port}`,
    httpUrl: `http://127.0.0.1:${address.port}`,
    stop: () => runtime.dispose(),
  }
}

/** A WebSocket client that records every decoded server message. */
export class TestClient {
  readonly received: ServerMessage[] = []
  private waiters: Array<() => void> = []
  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const msg = decodeServerMessage(String(e.data))
      if (Either.isLeft(msg)) throw new Error(`undecodable server message: ${e.data}`)
      this.received.push(msg.right)
      for (const w of this.waiters.splice(0)) w()
    })
  }

  static async connect(baseUrl: string, roomId: string) {
    const ws = new WebSocket(`${baseUrl}/ws/${roomId}`)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", () => reject(new Error("ws failed to open")), { once: true })
    })
    return new TestClient(ws)
  }

  send(msg: ClientMessage) {
    this.ws.send(encodeClientMessage(msg))
  }

  /** Resolves with the first received message (past or future) matching `pred`. */
  async waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const hit = this.received.find(pred)
      if (hit) return hit
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`timed out; received: ${this.received.map((m) => m._tag).join(", ")}`)
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left)
        this.waiters.push(() => {
          clearTimeout(t)
          resolve()
        })
      })
    }
  }

  close() {
    this.ws.close()
  }
}

export const is =
  <Tag extends ServerMessage["_tag"]>(tag: Tag, where: (m: Extract<ServerMessage, { _tag: Tag }>) => boolean = () => true) =>
  (m: ServerMessage): m is Extract<ServerMessage, { _tag: Tag }> =>
    m._tag === tag && where(m as Extract<ServerMessage, { _tag: Tag }>)
