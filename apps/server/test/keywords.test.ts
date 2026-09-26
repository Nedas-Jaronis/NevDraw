import { expect, test } from "bun:test"
import { classifyKeywords, labelFrom } from "../src/classify/keywords.ts"

test.each([
  ["landing page", "page"],
  ["signup button", "button"],
  ["card input", "input"],
  ["signup form", "form"],
  ["postgres", "database"],
  ["api server", "service"],
  ["redis cache", "cache"],
  ["kafka queue", "queue"],
  ["stripe", "external-api"],
  ["navbar", "navbar"],
  ["pricing table", "table"],
  ["zebra crossing", "box"],
] as const)("%p → %p", (text, type) => {
  expect(classifyKeywords(text).type).toBe(type)
})

test("keywords match whole words only", () => {
  expect(classifyKeywords("rapid prototyping").type).toBe("box") // not "api"
  expect(classifyKeywords("databases").type).toBe("database") // plural ok
})

test("the catch-all is low confidence", () => {
  expect(classifyKeywords("something else").confidence).toBeLessThan(0.4)
})

test("labels drop filler and are capitalized", () => {
  expect(labelFrom("add a landing page")).toBe("Landing page")
  expect(labelFrom("  the   api  ")).toBe("Api")
  expect(labelFrom("x".repeat(60))).toHaveLength(48)
})
