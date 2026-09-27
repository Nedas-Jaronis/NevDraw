import { Commit, Join, SetInput } from "@rtw/shared"
import { afterEach, describe, expect, test } from "bun:test"
import { interpretOffline, meaningful, withoutPartialMentions } from "../src/engine/index.ts"
import { itemEditOf } from "../src/engine/items.ts"
import { is, startServer, TestClient } from "./helpers.ts"

const H = new Map([
  ["@contact-form", { container: true, type: "form" as never, label: "Contact Form", parent: null, items: ["Name", "Email", "Message"] }],
  ["@footer", { container: true, type: "section" as never, label: "Footer", parent: null, items: ["About", "Blog", "Privacy", "Terms"] }],
])

describe("editing one entry of an element's list, and nothing else", () => {
  test.each([
    ["@contact-form change `email` to `username`", ["Name", "Username", "Message"]],
    ["rename the email field to Username in @contact-form", ["Name", "Username", "Message"]],
    ["@contact-form add a phone field", ["Name", "Email", "Message", "Phone"]],
    ["@contact-form add a company field after email", ["Name", "Email", "Company", "Message"]],
    ["@contact-form remove the message field", ["Name", "Email"]],
  ] as const)("%p", (text, items) => {
    expect(itemEditOf(text.replace(/`/g, ""), H, null)).toEqual({ target: "@contact-form", items: [...items] })
  })
  test("the clicked target is the element when no @ is given", () => {
    expect(itemEditOf("replace Blog with Docs", H, "@footer")).toEqual({ target: "@footer", items: ["About", "Docs", "Privacy", "Terms"] })
  })
  test("not a list edit: an entry that isn't there", () => {
    expect(itemEditOf("@contact-form change phone to mobile", H, null)).toBeNull()
  })
})

describe("nothing drafts until the text means something", () => {
  test("a reference being typed, a fragment, or only references", () => {
    expect(withoutPartialMentions("@c", H)).toBe("")
    expect(withoutPartialMentions("connect @api to @co", H)).toBe("connect api to")
    expect(meaningful("@contact-form")).toBe(false)
    expect(meaningful("c")).toBe(false)
    expect(interpretOffline("@c", H).nodes).toEqual([])
  })
})

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

test("over the protocol: renaming a form's field keeps the form and its other fields", async () => {
  const server = await startServer()
  cleanups.push(() => server.stop())
  const c = await TestClient.connect(server.url, "r")
  cleanups.push(() => c.close())
  c.send(new Join({ name: "Ada", color: "#e11d48" }))
  await c.waitFor(is("Welcome"))
  const anchor = { x: 0, y: 0 }
  c.send(new SetInput({ text: "a contact form", anchor }))
  c.send(new Commit())
  const [form] = (await c.waitFor(is("NodesCommitted"))).nodes

  c.send(new SetInput({ text: "@c", anchor }))
  await Bun.sleep(150)
  expect(c.received.some((m) => m._tag === "DraftUpdated" && m.draft.text === "@c" && m.draft.nodes.length > 0)).toBe(false)

  c.send(new SetInput({ text: `${form!.handle} change \`email\` to \`username\``, anchor }))
  const d = await c.waitFor(is("DraftUpdated", (m) => m.draft.text.includes("username")))
  expect(d.draft.nodes).toEqual([])
  expect(d.draft.patches).toEqual([{ id: form!.id, items: ["Name", "Username", "Message"] }])
  c.send(new Commit())
  const up = await c.waitFor(is("NodesUpdated", (m) => m.nodes.some((n) => n.id === form!.id)))
  expect(up.nodes[0]).toMatchObject({ id: form!.id, type: "form", label: form!.label, props: { items: ["Name", "Username", "Message"] } })
})
