import type { BoardNode } from "@rtw/shared"
import type { RoomState } from "../room/state.ts"

export type Item = { node: BoardNode; draft: boolean; typing?: string }

export type Tree = {
  roots: Item[]
  children: ReadonlyMap<string, Item[]>
}

/**
 * Committed nodes plus everyone's drafts, as a tree. A committed node wins
 * over a draft with the same id (they briefly coexist on commit), so the
 * element stays mounted and animates from dashed to solid. Children are
 * ordered for CSS flow; a node whose parent is missing becomes a root.
 */
export function buildTree(state: RoomState): Tree {
  const items = new Map<string, Item>()
  for (const d of state.drafts.values()) {
    const who = state.users.get(d.userId)
    const typing = d.userId !== state.selfId && who ? `${who.name} is typing: ${d.text}` : undefined
    let labeled = false
    for (const node of d.nodes) {
      const first = !labeled && node.parent === null
      if (first) labeled = true
      items.set(node.id, first && typing ? { node, draft: true, typing } : { node, draft: true })
    }
  }
  for (const node of state.nodes.values()) items.set(node.id, { node, draft: false })

  const roots: Item[] = []
  const children = new Map<string, Item[]>()
  for (const item of items.values()) {
    const p = item.node.parent
    if (p && items.has(p)) {
      const list = children.get(p) ?? []
      list.push(item)
      children.set(p, list)
    } else roots.push(item)
  }
  for (const list of children.values()) list.sort((a, b) => a.node.order - b.node.order)
  return { roots, children }
}
