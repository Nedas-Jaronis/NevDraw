import { expect, test } from "bun:test"
import { acceptSuggestion, activeMention, insertMention, matchHandles, referencedHandles } from "./mentions.ts"

const options = [
  { handle: "@landing-page", label: "Landing page", type: "page" },
  { handle: "@postgres", label: "Postgres", type: "database" },
  { handle: "@api-server", label: "Api server", type: "service" },
]

test("a mention is active only right after @ at a word start", () => {
  expect(activeMention("server writes to @pos", 21)).toEqual({ start: 17, query: "pos" })
  expect(activeMention("@", 1)).toEqual({ start: 0, query: "" })
  expect(activeMention("email me@home", 13)).toBeNull()
  expect(activeMention("@postgres and", 13)).toBeNull()
})

test("matches rank handle prefixes first, then label matches", () => {
  expect(matchHandles("p", options).map((o) => o.handle)).toEqual(["@postgres", "@api-server", "@landing-page"])
  expect(matchHandles("server", options).map((o) => o.handle)).toEqual(["@api-server"])
  expect(matchHandles("zzz", options)).toEqual([])
})

test("inserting replaces the partial token and adds a space", () => {
  expect(insertMention("writes to @pos", 14, 10, "@postgres")).toEqual({ text: "writes to @postgres ", caret: 20 })
  expect(insertMention("add form to @la and more", 15, 12, "@landing-page")).toEqual({
    text: "add form to @landing-page and more",
    caret: 26,
  })
})

test("only known handles count as references", () => {
  expect(referencedHandles("api writes to @postgres and @nope, @postgres", new Set(["@postgres"]))).toEqual(["@postgres"])
})

test("accepting a suggestion rewrites the last plain mention into the handle", () => {
  const s = { text: "postgres", handle: "@postgres" }
  expect(acceptSuggestion("api writes to postgres", s)).toBe("api writes to @postgres")
  expect(acceptSuggestion("postgres backup; api writes to Postgres now", s)).toBe("postgres backup; api writes to @postgres now")
  expect(acceptSuggestion("api writes to @postgres", s)).toBe("api writes to @postgres")
  expect(acceptSuggestion("the landing  page", { text: "landing page", handle: "@landing-page" })).toBe("the @landing-page")
  expect(acceptSuggestion("postgresql", s)).toBe("postgresql")
})
