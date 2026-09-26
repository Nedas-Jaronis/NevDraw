import { CursorMoved, UserJoined, UserLeft, Welcome } from "@rtw/shared"
import { expect, test } from "bun:test"
import { applyServerMessage, initialRoomState } from "./state.ts"

const ada = { id: "a", name: "Ada", color: "#e11d48", cursor: null }
const bo = { id: "b", name: "Bo", color: "#2563eb", cursor: null }

test("Welcome replaces state entirely (reconnect resync)", () => {
  const stale = applyServerMessage(initialRoomState, new Welcome({ selfId: "old", users: [ada, bo] }))
  const fresh = applyServerMessage({ ...stale, status: "reconnecting" }, new Welcome({ selfId: "a2", users: [ada] }))
  expect(fresh.status).toBe("open")
  expect(fresh.selfId).toBe("a2")
  expect([...fresh.users.keys()]).toEqual(["a"])
})

test("join, cursor and leave update presence", () => {
  let s = applyServerMessage(initialRoomState, new Welcome({ selfId: "a", users: [ada] }))
  s = applyServerMessage(s, new UserJoined({ user: bo }))
  s = applyServerMessage(s, new CursorMoved({ id: "b", cursor: { x: 3, y: 4 } }))
  expect(s.users.get("b")?.cursor).toEqual({ x: 3, y: 4 })
  s = applyServerMessage(s, new UserLeft({ id: "b" }))
  expect(s.users.has("b")).toBe(false)
})

test("cursor for an unknown user is ignored", () => {
  const s = applyServerMessage(initialRoomState, new Welcome({ selfId: "a", users: [ada] }))
  expect(applyServerMessage(s, new CursorMoved({ id: "zz", cursor: { x: 1, y: 1 } }))).toBe(s)
})
