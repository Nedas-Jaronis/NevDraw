import type { BoardEdge, BoardNode, EntryGraph, Point, User } from "@rtw/shared"
import { REGISTRY } from "@rtw/shared"

export const TOP_LEVEL_GAP = 40
/** Horizontal room for an arrow between a source and its target. */
export const ARROW_GAP = 140
/** Vertical spacing when one source fans out to several targets. */
export const FAN_GAP = 130
export const DEFAULT_WIDTH = 240
export const CONTAINER_WIDTH = 320

/** Server-side memory of one user's draft: which board id each local key became. */
export type DraftMemory = {
  readonly keyToId: ReadonlyMap<string, string>
  readonly nodes: ReadonlyArray<BoardNode>
  readonly edges: ReadonlyArray<BoardEdge>
}

export const widthOf = (type: BoardNode["type"]) => (REGISTRY[type].container ? CONTAINER_WIDTH : DEFAULT_WIDTH)

const edgeKey = (e: { from: string; to: string; kind: string }) => `${e.from}>${e.to}:${e.kind}`

/**
 * Pure: diff a fresh EntryGraph against the previous draft by key.
 * - an unchanged key keeps its board id and position (no flicker, no jump);
 * - a new key gets a fresh id; a new top-level node goes beside the element
 *   whose arrow points at it (fanning out), else at the anchor, else to the
 *   right of this draft's other top-level nodes;
 * - keys missing from the new graph disappear (they fade out client-side).
 * `@handle` parents and endpoints are resolved by #9; until then they're dropped.
 */
/** The committed board, as far as materialize needs it. */
export type BoardView = {
  readonly byHandle: ReadonlyMap<string, BoardNode>
  readonly byId: ReadonlyMap<string, BoardNode>
}

export const emptyBoard: BoardView = { byHandle: new Map(), byId: new Map() }

const isHandle = (k: string) => k.startsWith("@")

/**
 * The server never trusts a reference: parents and arrow ends that name an
 * @handle not on the committed board are dropped (the node becomes top-level,
 * the arrow disappears), as are suggestions for unknown handles.
 */
export function validateHandles(graph: EntryGraph, known: ReadonlySet<string>): EntryGraph {
  const ok = (k: string | null) => k === null || !isHandle(k) || known.has(k)
  return {
    nodes: graph.nodes.map((n) => (ok(n.parent) ? n : { ...n, parent: null })),
    edges: graph.edges.filter((e) => ok(e.from) && ok(e.to)),
    suggestions: graph.suggestions.filter((s) => known.has(s.handle)),
  }
}

export function materialize(input: {
  graph: EntryGraph
  prev: DraftMemory | undefined
  anchor: Point
  user: User
  newId: () => string
  board?: BoardView
}): DraftMemory {
  const { prev, anchor, user } = input
  const board = input.board ?? emptyBoard
  const graph = validateHandles(input.graph, new Set(board.byHandle.keys()))
  const prevById = new Map(prev?.nodes.map((n) => [n.id, n]))
  const keyToId = new Map<string, string>()
  for (const [h, n] of board.byHandle) keyToId.set(h, n.id)
  const idFor = (key: string) => prev?.keyToId.get(key) ?? input.newId()
  for (const n of graph.nodes) keyToId.set(n.key, idFor(n.key))
  for (const e of graph.edges) keyToId.set(edgeKey(e), idFor(edgeKey(e)))

  const incoming = new Map<string, string>()
  for (const e of graph.edges) if (!incoming.has(e.to)) incoming.set(e.to, e.from)

  const siblingOrder = new Map<string | null, number>()
  const placed = new Map<string, BoardNode>()
  const placedById = new Map<string, BoardNode>()
  /** Nested elements have no coordinates of their own: use their top-level ancestor. */
  const rootOf = (n: BoardNode | undefined) => {
    while (n && n.parent !== null) n = placedById.get(n.parent) ?? board.byId.get(n.parent)
    return n
  }
  const lookup = (key: string) => placed.get(key) ?? board.byHandle.get(key)
  /** Draft children of a committed container go after its existing children. */
  const committedChildren = new Map<string, number>()
  for (const n of board.byId.values()) {
    if (n.parent !== null) committedChildren.set(n.parent, Math.max(committedChildren.get(n.parent) ?? 0, n.order + 1))
  }
  const fanOut = new Map<string, number>()
  let nextX: number | null = null
  const nodes: BoardNode[] = []

  for (const n of graph.nodes) {
    const id = keyToId.get(n.key)!
    const parent = n.parent && keyToId.has(n.parent) ? keyToId.get(n.parent)! : null
    const order = siblingOrder.get(parent) ?? (parent ? (committedChildren.get(parent) ?? 0) : 0)
    siblingOrder.set(parent, order + 1)

    const before = prevById.get(id)
    let x = 0
    let y = 0
    if (parent === null) {
      const source = incoming.has(n.key) ? rootOf(lookup(incoming.get(n.key)!)) : undefined
      // Every target of a source takes a fan slot, including ones that already have a position.
      const fan = source ? (fanOut.get(source.id) ?? 0) : 0
      if (source) fanOut.set(source.id, fan + 1)
      if (before && before.parent === null) {
        x = before.x
        y = before.y
      } else if (source) {
        x = source.x + widthOf(source.type) + ARROW_GAP
        y = source.y + fan * FAN_GAP
      } else {
        x = nextX ?? Math.round(anchor.x - widthOf(n.type) / 2)
        y = Math.round(anchor.y - 120)
      }
      nextX = Math.max(nextX ?? Number.NEGATIVE_INFINITY, x + widthOf(n.type) + TOP_LEVEL_GAP)
    }

    const node: BoardNode = {
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
    }
    placed.set(n.key, node)
    placedById.set(id, node)
    nodes.push(node)
  }

  const edges: BoardEdge[] = []
  for (const e of graph.edges) {
    const from = keyToId.get(e.from)
    const to = keyToId.get(e.to)
    if (!from || !to || !lookup(e.from) || !lookup(e.to)) continue
    edges.push({
      id: keyToId.get(edgeKey(e))!,
      from,
      to,
      kind: e.kind,
      ...(e.label ? { label: e.label } : {}),
      authorId: user.id,
      authorColor: user.color,
    })
  }
  return { keyToId, nodes, edges }
}
