import { Commit, Join, SetInput } from "@rtw/shared"
import { is, startServer, TestClient } from "../test/helpers.ts"
const server = await startServer()
const c = await TestClient.connect(server.url, "r")
c.send(new Join({ name: "Ada", color: "#e11d48" }))
await c.waitFor(is("Welcome"))
for (const text of [process.argv[2]!]) {
  c.send(new SetInput({ text, anchor: { x: 0, y: 0 } }))
  const d = await c.waitFor(is("DraftUpdated"))
  console.log("DRAFT", d.draft.nodes.map((n) => `${n.label}@${n.x},${n.y}`).join(" | "))
  c.send(new Commit())
  const m = await c.waitFor(is("NodesCommitted"))
  console.log("COMMIT", m.nodes.map((n) => `${n.label}@${n.x},${n.y}`).join(" | "))
}
c.close(); await server.stop()
