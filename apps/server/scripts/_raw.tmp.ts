import { Effect } from "effect"
import { openAiCompatible } from "../src/refine/Refiner.ts"
const r = openAiCompatible({ baseUrl: (process.env.GPTOSS_BASE_URL ?? "https://api.cerebras.ai/v1").trim(), apiKey: process.env.GPTOSS_API_KEY!.trim(), model: (process.env.GPTOSS_MODEL ?? "gpt-oss-120b").trim() })
const board = [{ handle: "@signup-page", type: "page", label: "Signup page", parent: null, order: 0 }, { handle: "@signup-form", type: "form", label: "Signup form", parent: "@signup-page", order: 0 }]
const draft = [["p1","service","Auth service"],["p2","database","Users database"]].map(([key,type,label]) => ({ key: key!, type: type!, label: label!, parent: null }))
for (let i = 0; i < 2; i++) console.log(JSON.stringify(await Effect.runPromise(r.refine({ text: "the signup form posts to an auth service which writes to a users database", board, recent: ["@signup-page"], draft }))))
