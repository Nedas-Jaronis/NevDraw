import { expect, test } from "bun:test"
import { parse, parseFile, render } from "./markup.ts"

test("markup round-trips through character offsets", () => {
  const line = "a [landing page](INSTANCE) with [3](COUNT) [pricing cards](INSTANCE)"
  const ex = parse(line)
  expect(ex.text).toBe("a landing page with 3 pricing cards")
  expect(ex.spans.map((s) => ex.text.slice(s.start, s.end))).toEqual(["landing page", "3", "pricing cards"])
  expect(render(ex)).toBe(line)
})

test("unknown tags and broken markup are rejected", () => {
  expect(() => parse("a [hero](THING)")).toThrow()
  expect(() => parse("a [hero(INSTANCE)")).not.toThrow() // no closing bracket: plain text
  expect(() => parse("a [hero](INSTANCE")).toThrow()
})

test("every gold line parses", async () => {
  const gold = parseFile(await Bun.file(new URL("../data/gold.txt", import.meta.url)).text())
  expect(gold.length).toBeGreaterThan(100)
})
