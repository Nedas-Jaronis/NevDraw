import { BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"
import { makeApp } from "./app.ts"
import { envNumber } from "./env.ts"

const port = envNumber("PORT") ?? 3000

BunRuntime.runMain(Layer.launch(makeApp({ port })))
