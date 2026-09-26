import type { BoardNode } from "@rtw/shared"
import { CursorMoved, DraftCleared, DraftUpdated, NodesCommitted, UserJoined, UserLeft, Welcome } from "@rtw/shared"
import { expect, test } from "bun:test"
import { applyServerMessage, initialRoomState } from "./state.ts"

const ada = { id: "a", name: "Ada", color: "#e11d48", cursor: null }
const bo = { id: "b", name: "Bo", color: "#2563eb", cursor: null }
const node = (id: string): BoardNode => ({
  id,
  type: "page",
  label: "Landing page",
  parent: null,
  props: {},
  x: 0,
  y: 0,
  pinned: false,
  authorId: "a",
  authorColor: "#e11d48",
})
const welcome = (selfId: string, users = [ada], extra: Partial<{ nodes: BoardNode[] }> = {}) =>
  new Welcome({ selfId, users, nodes: extra.nodes ?? [], drafts: [] })

test("Welcome replaces state entirely (reconnect resync)", () => {
  const stale = applyServerMessage(initialRoomState, welcome("old", [ada, bo], { nodes: [node("n1")] }))
  const withDraft = applyServerMessage(stale, new DraftUpdated({ draft: { userId: "b", text: "x", nodes: [] } }))
  const fresh = applyServerMessage({ ...withDraft, status: "reconnecting" }, welcome("a2", [ada], { nodes: [node("n2")] }))
  expect(fresh.status).toBe("open")
  expect(fresh.selfId).toBe("a2")
  expect([...fresh.users.keys()]).toEqual(["a"])
  expect([...fresh.nodes.keys()]).toEqual(["n2"])
  expect(fresh.drafts.size).toBe(0)
})

test("join, cursor and leave update presence", () => {
  let s = applyServerMessage(initialRoomState, welcome("a"))
  s = applyServerMessage(s, new UserJoined({ user: bo }))
  s = applyServerMessage(s, new CursorMoved({ id: "b", cursor: { x: 3, y: 4 } }))
  expect(s.users.get("b")?.cursor).toEqual({ x: 3, y: 4 })
  s = applyServerMessage(s, new UserLeft({ id: "b" }))
  expect(s.users.has("b")).toBe(false)
})

test("cursor for an unknown user is ignored", () => {
  const s = applyServerMessage(initialRoomState, welcome("a"))
  expect(applyServerMessage(s, new CursorMoved({ id: "zz", cursor: { x: 1, y: 1 } }))).toBe(s)
})

test("drafts are replaced per user, cleared, and commits land in the committed layer", () => {
  let s = applyServerMessage(initialRoomState, welcome("a"))
  s = applyServerMessage(s, new DraftUpdated({ draft: { userId: "a", text: "land", nodes: [node("n1")] } }))
  s = applyServerMessage(s, new DraftUpdated({ draft: { userId: "a", text: "landing page", nodes: [node("n1")] } }))
  expect(s.drafts.get("a")?.text).toBe("landing page")
  s = applyServerMessage(s, new NodesCommitted({ nodes: [node("n1")] }))
  s = applyServerMessage(s, new DraftCleared({ userId: "a" }))
  expect(s.drafts.size).toBe(0)
  expect(s.nodes.has("n1")).toBe(true)
})
