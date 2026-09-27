import type { BoardEdge, BoardNode, Draft } from "@rtw/shared"
import type { RoomState } from "../room/state.ts"

export type Item = {
  node: BoardNode
  draft: boolean
  typing?: string
  /** A pending "remove": shown faded and struck through until Enter. */
  removing?: boolean
}

export type EdgeItem = { edge: BoardEdge; draft: boolean }

export type Tree = {
  roots: Item[]
  children: ReadonlyMap<string, Item[]>
  /** Arrows whose endpoints are both on the board (committed wins over draft by id). */
  edges: EdgeItem[]
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
  // Pending changes to existing elements (recolor, rename, move into a box), by element id.
  const pending = new Map<string, { patch: Draft["patches"][number]; color: string }>()
  for (const d of state.drafts.values()) {
    const who = state.users.get(d.userId)
    for (const p of d.patches) pending.set(p.id, { patch: p, color: who?.color ?? "#888" })
  }
  for (const node of state.nodes.values()) {
    // Committed elements a draft is pushing aside show at their pushed spot.
    const d = state.displaced.get(node.id)
    const base = d ? { ...node, x: d.x, y: d.y } : node
    const change = pending.get(node.id)
    if (!change) {
      items.set(node.id, { node: base, draft: false })
      continue
    }
    // Preview the change dashed, in the editor's color, until they press Enter.
    const p = change.patch
    if (p.remove) {
      items.set(node.id, { node: { ...base, authorColor: change.color }, draft: true, removing: true })
      continue
    }
    items.set(node.id, {
      node: {
        ...base,
        ...(p.label ? { label: p.label } : {}),
        ...(p.type ? { type: p.type } : {}),
        props: { ...base.props, ...(p.color ? { color: p.color } : {}), ...(p.items ? { items: p.items } : {}) },
        ...(p.parent ? { parent: p.parent, order: 1000 + base.order } : p.order !== undefined ? { order: p.order } : {}),
        authorColor: change.color,
      },
      draft: true,
    })
  }

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

  const edges = new Map<string, EdgeItem>()
  for (const d of state.drafts.values()) for (const edge of d.edges) edges.set(edge.id, { edge, draft: true })
  for (const edge of state.edges.values()) edges.set(edge.id, { edge, draft: false })
  const visible = [...edges.values()].filter((e) => items.has(e.edge.from) && items.has(e.edge.to))
  return { roots, children, edges: visible }
}
