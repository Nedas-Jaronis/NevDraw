import { describe, expect, test } from "bun:test"
import { collectionOf, colonList, explicitColor, isModifierOnly, sequenceItems } from "../src/engine/modifiers.ts"
import { interpretOffline } from "../src/engine/index.ts"

const nodes = (t: string) => interpretOffline(t).nodes.map((n) => ({ type: n.type, label: n.label, ...n.props }))

describe("collections", () => {
  test("the collection word is the head noun; the rest is the item type", () => {
    expect(collectionOf("a table of timers")).toEqual({ type: "table", of: "timer" })
    expect(collectionOf("list of todos")).toEqual({ type: "list", of: "checklist" })
    expect(collectionOf("a grid of pricing cards")).toEqual({ type: "section", layout: "grid", of: "card" })
    expect(collectionOf("a row of buttons")).toEqual({ type: "section", layout: "row", of: "button" })
    expect(collectionOf("a table of foo")).toEqual({ type: "table" })
    expect(collectionOf("pricing table")).toBeNull()
  })

  test("the second reported phrasing: number before 'increments'", () => {
    const expected = [{ type: "table", label: "Table of timers", of: "timer", items: ["15 min", "30 min", "45 min", "60 min"] }] as ReturnType<typeof nodes>
    expect(nodes("a table of timers 15 min increments")).toEqual(expected)
    expect(nodes("a table of timers in 15-minute increments")).toEqual(expected)
    expect(nodes("a table of timers with 15 minute intervals")).toEqual(expected)
  })

  test("the reported case: a table of timers with increments of 15", () => {
    expect(nodes("a table of timers with increments of 15")).toEqual([
      { type: "table", label: "Table of timers", of: "timer", items: ["15 min", "30 min", "45 min", "60 min"] },
    ])
  })
})

describe("sequences", () => {
  test.each([
    ["increments of 15", "timer", ["15 min", "30 min", "45 min", "60 min"]],
    ["in steps of 10 up to 50", undefined, ["10", "20", "30", "40", "50"]],
    ["every 10 minutes up to 30", undefined, ["10 min", "20 min", "30 min"]],
    ["from 5 to 20 min by 5", undefined, ["5 min", "10 min", "15 min", "20 min"]],
    ["from $10 to $40 by 10", undefined, ["$10", "$20", "$30", "$40"]],
    ["from 0 to 100% by 25", undefined, ["0%", "25%", "50%", "75%", "100%"]],
  ] as const)("%p", (text, of, items) => {
    expect(sequenceItems(text, of)).toEqual([...items])
  })
  test("caps at 8 items and knows modifier-only pieces", () => {
    expect(sequenceItems("increments of 1 up to 100")).toHaveLength(8)
    expect(isModifierOnly("increments of 15")).toBe(true)
    expect(isModifierOnly("a timer with increments of 15")).toBe(false)
  })
})

describe("lists and colors", () => {
  test("colon lists become items of the element before the colon", () => {
    expect(colonList("a checklist: milk, eggs and bread")).toEqual({ head: "a checklist", items: ["Milk", "Eggs", "Bread"] })
    expect(nodes("poll: pizza, burgers or tacos")).toEqual([{ type: "poll", label: "Poll", items: ["Pizza", "Burgers", "Tacos"] }])
    expect(nodes("settings tabs: profile, billing, team")[0]).toMatchObject({ type: "tabs", items: ["Profile", "Billing", "Team"] })
  })

  test("explicit colors: hex, names, references, modifiers; not evocative words", () => {
    expect(explicitColor("a red signup button")).toBe("#e03131")
    expect(explicitColor("#FF6B35 hero")).toBe("#ff6b35")
    expect(explicitColor("tiffany blue navbar")).toBe("#0abab5")
    expect(explicitColor("coffee shop landing page")).toBeNull()
    expect(explicitColor("login page")).toBeNull()
    expect(nodes("a navy navbar")[0]).toMatchObject({ type: "navbar", color: "#1b2a5c" })
  })
})

test("code-computed values beat the LLM's guesses for the same element", async () => {
  const { keepComputed } = await import("../src/engine/index.ts")
  const instant = interpretOffline("a red delete button. a table of timers with increments of 15")
  const llm = {
    nodes: [
      { key: "p0", type: "button" as const, label: "Delete", parent: null, props: { color: "#ff0000" } },
      { key: "p1", type: "table" as const, label: "Timers", parent: null, props: { of: "timer" as const, items: ["15", "30"] } },
      { key: "n9", type: "text" as const, label: "Extra", parent: null, props: { color: "#123456" } },
    ],
    edges: [],
    suggestions: [],
  }
  const merged = keepComputed(llm, instant)
  expect(merged.nodes.map((n) => [n.label, n.props.color, n.props.items])).toEqual([
    ["Delete", "#e03131", undefined],
    ["Timers", undefined, ["15 min", "30 min", "45 min", "60 min"]],
    ["Extra", "#123456", undefined],
  ])
})
