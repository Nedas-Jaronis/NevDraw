import { BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"
import { makeApp } from "./app.ts"

const port = Number(process.env.PORT ?? 3000)

BunRuntime.runMain(Layer.launch(makeApp({ port })))
