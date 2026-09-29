import { expect, test } from "bun:test"
import { parse, parseFile, render } from "./markup.ts"

test("markup round-trips through character offsets", () => {
  const line = "a [landing page](INSTANCE) with [3](COUNT) [pricing cards](INSTANCE)"
  const ex = parse(line)
  expect(ex.text).toBe("a landing page with 3 pricing cards")
  expect(ex.spans.map((s) => ex.text.slice(s.start, s.end))).toEqual(["landing page", "3", "pricing cards"])
  expect(render(ex)).toBe(line)
})

test("links name another span by its text", () => {
  const line = "a [landing page](INSTANCE) with [3](COUNT mod:pricing cards) [pricing cards](INSTANCE in:landing page)"
  const ex = parse(line)
  expect(ex.spans[1]!.arcs).toEqual([{ label: "mod", head: 2 }])
  expect(ex.spans[2]!.arcs).toEqual([{ label: "in", head: 0 }])
  expect(ex.spans[0]!.arcs).toBeUndefined()
  expect(render(ex)).toBe(line)
})

test("a span can have several links; the nearest span with the text wins, ~N picks one", () => {
  const ex = parse("[api](INSTANCE) [writes to](RELATION) [db](INSTANCE dst:writes to) and [publishes to](RELATION) [q](INSTANCE dst:publishes to)")
  expect(ex.spans[2]!.arcs).toEqual([{ label: "dst", head: 1 }])
  const multi = parse("[api](INSTANCE src:writes to src:publishes to) [writes to](RELATION) [db](INSTANCE) and [publishes to](RELATION)")
  expect(multi.spans[0]!.arcs).toEqual([{ label: "src", head: 1 }, { label: "src", head: 3 }])
  const twice = parse("a [footer](INSTANCE) and a [hero](INSTANCE), the [footer](REF same:footer~1) [last](ATTR mod:footer~2)")
  expect(twice.spans[2]!.arcs).toEqual([{ label: "same", head: 0 }])
  expect(twice.spans[3]!.arcs).toEqual([{ label: "mod", head: 2 }])
  // Nearest wins, so render drops the ~N where it isn't needed.
  expect(render(twice)).toBe("a [footer](INSTANCE) and a [hero](INSTANCE), the [footer](REF same:footer) [last](ATTR mod:footer)")
  expect(render(parse(render(twice)))).toBe(render(twice))
})

test("unknown tags, links, targets and broken markup are rejected", () => {
  expect(() => parse("a [hero](THING)")).toThrow()
  expect(() => parse("a [hero(INSTANCE)")).not.toThrow() // no closing bracket: plain text
  expect(() => parse("a [hero](INSTANCE")).toThrow()
  expect(() => parse("a [hero](INSTANCE near:page)")).toThrow()
  expect(() => parse("a [hero](INSTANCE in:page)")).toThrow()
})

test("every gold line parses", async () => {
  const gold = parseFile(await Bun.file(new URL("../data/gold.txt", import.meta.url)).text())
  expect(gold.length).toBeGreaterThan(100)
})
