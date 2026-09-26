import type { BoardNode, EntryGraph, Point, User } from "@rtw/shared"
import { REGISTRY } from "@rtw/shared"

export const TOP_LEVEL_GAP = 40
export const DEFAULT_WIDTH = 240
export const CONTAINER_WIDTH = 320

/** Server-side memory of one user's draft: which board id each local key became. */
export type DraftMemory = {
  readonly keyToId: ReadonlyMap<string, string>
  readonly nodes: ReadonlyArray<BoardNode>
}

export const widthOf = (type: BoardNode["type"]) => (REGISTRY[type].container ? CONTAINER_WIDTH : DEFAULT_WIDTH)

/**
 * Pure: diff a fresh EntryGraph against the previous draft by key.
 * - an unchanged key keeps its board id and position (no flicker, no jump);
 * - a new key gets a fresh id; a new top-level node goes at the anchor, or
 *   to the right of this draft's other top-level nodes;
 * - keys missing from the new graph simply disappear (they fade out client-side).
 * `@handle` parents are resolved by #9; until then they become top-level.
 */
export function materialize(input: {
  graph: EntryGraph
  prev: DraftMemory | undefined
  anchor: Point
  user: User
  newId: () => string
}): DraftMemory {
  const { graph, prev, anchor, user } = input
  const prevById = new Map(prev?.nodes.map((n) => [n.id, n]))
  const keyToId = new Map<string, string>()
  for (const n of graph.nodes) keyToId.set(n.key, prev?.keyToId.get(n.key) ?? input.newId())

  const siblingOrder = new Map<string | null, number>()
  let nextX: number | null = null
  const nodes: BoardNode[] = []

  for (const n of graph.nodes) {
    const id = keyToId.get(n.key)!
    const parent = n.parent && keyToId.has(n.parent) ? keyToId.get(n.parent)! : null
    const order = siblingOrder.get(parent) ?? 0
    siblingOrder.set(parent, order + 1)

    const before = prevById.get(id)
    let x = 0
    let y = 0
    if (parent === null) {
      if (before && before.parent === null) {
        x = before.x
        y = before.y
      } else {
        x = nextX ?? Math.round(anchor.x - widthOf(n.type) / 2)
        y = Math.round(anchor.y - 120)
      }
      nextX = Math.max(nextX ?? Number.NEGATIVE_INFINITY, x + widthOf(n.type) + TOP_LEVEL_GAP)
    }

    nodes.push({
      id,
      type: n.type,
      label: n.label,
      parent,
      order,
      props: { layout: n.props.layout ?? REGISTRY[n.type].defaultLayout },
      x,
      y,
      pinned: before?.pinned ?? false,
      authorId: user.id,
      authorColor: user.color,
    })
  }
  return { keyToId, nodes }
}
