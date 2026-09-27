/**
 * bun run arrows: runs the test scenarios through the real engine (Jev + the
 * LLM in the loop, keys from the root .env) and prints what was made and every
 * arrow. Multi-step scenarios commit each step in order, so references resolve
 * against what's already on the board. `{words}` in a step becomes the @handle
 * of the element whose label contains those words.
 *
 *   bun run arrows            # full pipeline (Jev + LLM)
 *   bun run arrows --instant  # keyword + code only (deterministic)
 *   bun run arrows 5 7        # only these scenarios
 *   bun run arrows --typing   # type like a person (a key every 40 ms), pause, then Enter
 *   bun run arrows --typing --pause=300   # …with a shorter pause before Enter
 */
import { HttpServer } from "@effect/platform"
import { type BoardEdge, type BoardNode, Commit, Join, SetInput } from "@rtw/shared"
import { Effect, ManagedRuntime } from "effect"
import { makeApp } from "../src/app.ts"
import { makeMemoryStore } from "../src/BoardStore.ts"
import { JevDisabled } from "../src/classify/Jev.ts"
import { RefinerDisabled } from "../src/refine/Refiner.ts"
import { is, TestClient } from "../test/helpers.ts"

const SCENARIOS: Array<{ id: string; steps: string[] }> = [
  { id: "1a", steps: ["create a stack of 5 servers connected to a load balancer which is then connected to 3 databases"] },
  { id: "1b", steps: ["a mobile app and a web app both call an api gateway which calls an auth service, an orders service and a payments service"] },
  { id: "1c", steps: ["a web app calls a cdn which calls an api which reads from postgres"] },
  {
    id: "2",
    steps: [
      "an orders service publishes to a kafka queue. an email worker and an analytics worker both consume from the kafka queue. the analytics worker writes to a data warehouse",
    ],
  },
  { id: "3", steps: ["an api reads from a redis cache and writes to postgres. an upload service stores files in an s3 bucket"] },
  { id: "4", steps: ["a checkout service calls stripe, then it emails the user via sendgrid"] },
  {
    id: "5",
    steps: [
      "an api server writes to postgres. a worker reads from postgres",
      "add a redis cache between {api server} and {postgres}",
      "make {postgres} blue",
      "wrap {api server} {postgres} {redis} into a backend box",
    ],
  },
  { id: "6a", steps: ["monolith: a web app calls one api server which reads and writes to postgres"] },
  {
    id: "6b",
    steps: [
      "microservices: a web app calls an api gateway which routes to a users service, an orders service and a payments service. each service writes to its own database",
    ],
  },
  { id: "7", steps: ["a signup page with a signup form", "the signup form posts to an auth service which writes to a users database"] },
  {
    id: "8",
    steps: [
      "a stack of 5 servers",
      "a load balancer connected to {servers stack}",
      "make {servers stack} green",
      "turn all servers inside {servers stack} blue",
      "detach {server 1} from {servers stack}",
      "disconnect {load balancer} from {servers stack}",
    ],
  },
  {
    id: "10",
    steps: ["give me 5 server stack that goes through 2 load balancers, and then connects to 6 databases. each loadbalacer takes 3 databases."],
  },
  {
    id: "9",
    steps: ["a landing page with a hero, a features section and a footer", "embed an image inside the hero"],
  },
]

const args = process.argv.slice(2)
const instant = args.includes("--instant")
const only = args.filter((a) => !a.startsWith("--"))
const typing = args.includes("--typing")
const pauseArg = args.find((a) => a.startsWith("--pause="))
const typingPause = pauseArg ? Number(pauseArg.slice(8)) : instant ? 300 : typing ? 600 : 3500

const runtime = ManagedRuntime.make(
  makeApp({
    port: 0,
    store: makeMemoryStore(),
    ...(instant ? { jev: JevDisabled, refiner: RefinerDisabled } : {}),
  }),
)
const address = await runtime.runPromise(Effect.map(HttpServer.HttpServer, (s) => s.address))
if (address._tag !== "TcpAddress") throw new Error("expected a TCP address")
const url = `ws://127.0.0.1:${address.port}`

console.log(instant ? "Instant pass only (keyword + code, no Jev or LLM)\n" : "Full pipeline (Jev + LLM, keys from .env)\n")

for (const s of SCENARIOS) {
  if (only.length && !only.includes(s.id)) continue
  const c = await TestClient.connect(url, `arrows-${s.id}-${Date.now()}`)
  c.send(new Join({ name: "arrows", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const nodes = new Map<string, BoardNode>()
  const edges = new Map<string, BoardEdge>()
  let seen = 0
  const sync = () => {
    for (const m of c.received.slice(seen)) {
      if (m._tag === "NodesCommitted") {
        for (const n of m.nodes) nodes.set(n.id, n)
        for (const e of m.edges) edges.set(e.id, e)
      } else if (m._tag === "NodesUpdated") for (const n of m.nodes) nodes.set(n.id, n)
      else if (m._tag === "NodesRemoved") {
        for (const id of m.ids) nodes.delete(id)
        for (const id of m.edgeIds) edges.delete(id)
      }
    }
    seen = c.received.length
  }
  const handleFor = (words: string) => {
    const want = words.toLowerCase()
    const hit =
      [...nodes.values()].find((n) => n.label.toLowerCase() === want) ??
      [...nodes.values()].find((n) => n.label.toLowerCase().includes(want))
    return hit?.handle ?? `{${words}?}`
  }

  console.log(`━━ ${s.id}`)
  for (const raw of s.steps) {
    const text = raw.replace(/\{([^}]+)\}/g, (_, w: string) => handleFor(w))
    console.log(`  › ${text}`)
    const before = new Map(nodes)
    const edgesBefore = new Set(edges.keys())
    if (typing) {
      for (let i = 1; i <= text.length; i++) {
        c.send(new SetInput({ text: text.slice(0, i), anchor: { x: 0, y: 0 } }))
        await Bun.sleep(40)
      }
    } else c.send(new SetInput({ text, anchor: { x: 0, y: 0 } }))
    await Bun.sleep(typingPause)
    const t0 = Date.now()
    if (process.env.ARROWS_DEBUG) for (const m of c.received.slice(seen)) console.log("      ", m._tag, JSON.stringify(m).slice(0, Number(process.env.ARROWS_DEBUG) > 1 ? 4000 : 400))
    // Only a DraftCleared after this Enter counts (typing can clear the draft on the way).
    sync()
    c.received.splice(0)
    seen = 0
    c.send(new Commit())
    await c.waitFor(is("DraftCleared"), 4000).catch(() => null)
    await Bun.sleep(200)
    if (process.env.ARROWS_DEBUG) for (const m of c.received) console.log("     after Enter:", m._tag, JSON.stringify(m).slice(0, Number(process.env.ARROWS_DEBUG) > 1 ? 4000 : 400))
    sync()
    if (!instant) console.log(`    (committed in ${Date.now() - t0} ms)`)
    if (s.steps.length > 1) {
      const label = (id: string) => nodes.get(id)?.label ?? "?"
      for (const n of nodes.values()) {
        const was = before.get(n.id)
        if (!was) console.log(`      + ${n.label} (${n.type})${n.parent ? ` inside ${label(n.parent)}` : ""}`)
        else if (was.parent !== n.parent || was.props.color !== n.props.color || was.label !== n.label)
          console.log(`      ~ ${n.label}${n.parent ? ` inside ${label(n.parent)}` : " top-level"}${n.props.color ? ` ${n.props.color}` : ""}`)
      }
      for (const e of edges.values()) if (!edgesBefore.has(e.id)) console.log(`      + ${label(e.from)} —${e.label ?? e.kind}→ ${label(e.to)}`)
    }
    // DraftCleared from this commit is consumed; the next step waits for a fresh one.
    c.received.splice(0)
    seen = 0
  }

  const name = (id: string) => nodes.get(id)?.label ?? "?"
  console.log("  elements:")
  for (const n of [...nodes.values()].sort((a, b) => (a.parent ?? "").localeCompare(b.parent ?? "") || a.order - b.order))
    console.log(
      `    ${n.label} (${n.type})${n.parent ? ` inside ${name(n.parent)}` : ""}${n.props.color ? ` ${n.props.color}` : ""}${n.handle ? `  ${n.handle}` : ""}`,
    )
  console.log("  arrows:")
  if (edges.size === 0) console.log("    (none)")
  for (const e of edges.values()) console.log(`    ${name(e.from)} —${e.label ?? e.kind}→ ${name(e.to)}`)
  console.log()
  c.close()
}

await runtime.dispose()
