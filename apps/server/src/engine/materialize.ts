import type { BoardEdge, BoardNode, EntryGraph, NodePatch, Point, User } from "@rtw/shared"
import { REGISTRY } from "@rtw/shared"
import { layeredPositions } from "./layered.ts"

export const TOP_LEVEL_GAP = 96
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
  readonly patches: ReadonlyArray<NodePatch>
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
    patches: graph.patches
      .filter((p) => known.has(p.target))
      .map((p) => (p.unlink === undefined || p.unlink === "*" || known.has(p.unlink) ? p : { ...p, unlink: undefined }))
      .map((p) => ({
        ...p,
        after: p.after === undefined || p.after.startsWith("$") || known.has(p.after) ? p.after : undefined,
        before: p.before === undefined || p.before.startsWith("$") || known.has(p.before) ? p.before : undefined,
      }))
      .map((p) => (p.parent === undefined || ok(p.parent) ? p : { ...p, parent: undefined })),
  }
}

/** Media that may sit inside any element. */
const EMBEDDABLE = new Set<string>(["image", "video", "chart", "map", "avatar"])

/**
 * Connecting isn't nesting: an element never goes inside something it has an
 * arrow to, nor inside an element that can't hold children (the LLM
 * sometimes answers "parent: @servers-stack" for "connect a cache to
 * @servers-stack", which would swallow the new element).
 */
export function sensibleParents(graph: EntryGraph, board: BoardView): EntryGraph {
  const local = new Map(graph.nodes.map((n) => [n.key, n.type]))
  const typeOf = (k: string) => local.get(k) ?? board.byHandle.get(k)?.type
  const linked = (a: string, b: string) => graph.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.parent === null) return n
      const pt = typeOf(n.parent)
      const holds = pt !== undefined && (REGISTRY[pt].container || EMBEDDABLE.has(n.type))
      return holds && !linked(n.key, n.parent) ? n : { ...n, parent: null }
    }),
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
  const graph = sensibleParents(validateHandles(input.graph, new Set(board.byHandle.keys())), board)
  const prevById = new Map(prev?.nodes.map((n) => [n.id, n]))
  const keyToId = new Map<string, string>()
  for (const [h, n] of board.byHandle) keyToId.set(h, n.id)
  const idFor = (key: string) => prev?.keyToId.get(key) ?? input.newId()
  for (const n of graph.nodes) keyToId.set(n.key, idFor(n.key))
  for (const e of graph.edges) keyToId.set(edgeKey(e), idFor(edgeKey(e)))

  const incoming = new Map<string, string>()
  for (const e of graph.edges) if (!incoming.has(e.to)) incoming.set(e.to, e.from)

  // Connected elements of this entry are laid out as a flowchart. Elements that already
  // have a spot keep it; the flowchart is anchored to them so new ones slot into the same grid.
  const typeOf = new Map(graph.nodes.map((n) => [n.key, n.type]))
  const flow = layeredPositions(graph, (k) => widthOf(typeOf.get(k) ?? "box"))
  let flowOffset: { x: number; y: number } | null = null
  for (const [k, p] of flow) {
    const before = prevById.get(keyToId.get(k)!)
    if (before && before.parent === null) {
      flowOffset = { x: before.x - p.x, y: before.y - p.y }
      break
    }
  }
  if (!flowOffset && flow.size) {
    const right = Math.max(...[...flow].map(([k, p]) => p.x + widthOf(typeOf.get(k) ?? "box")))
    flowOffset = { x: Math.round(anchor.x - right / 2), y: Math.round(anchor.y - 120) }
  }

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

  /** Committed children of a container, in order. */
  const childrenOf = (parentId: string) =>
    [...board.byId.values()].filter((c) => c.parent === parentId).sort((a, b) => a.order - b.order)
  /** "after @a" / "before @b" / "between" / top / bottom → an order between the neighbours. */
  const positioned = (n: EntryGraph["nodes"][number], parent: string | null): { parent: string | null; order: number } | null => {
    if (!n.after && !n.before) return null
    const sib = (ref: string | undefined) => (ref && !ref.startsWith("$") ? lookup(ref) : undefined)
    const a = sib(n.after)
    const b = sib(n.before)
    const p = parent ?? a?.parent ?? b?.parent ?? null
    if (!p) return null
    const kids = childrenOf(p)
    if (n.before === "$top") return { parent: p, order: (kids[0]?.order ?? 1) - 1 }
    if (n.after === "$bottom") return { parent: p, order: (kids.at(-1)?.order ?? -1) + 1 }
    if (a && b && a.parent === p && b.parent === p) return { parent: p, order: (a.order + b.order) / 2 }
    if (a && a.parent === p) {
      const next = kids.find((k) => k.order > a.order)
      return { parent: p, order: next ? (a.order + next.order) / 2 : a.order + 1 }
    }
    if (b && b.parent === p) {
      const prev = [...kids].reverse().find((k) => k.order < b.order)
      return { parent: p, order: prev ? (prev.order + b.order) / 2 : b.order - 1 }
    }
    return null
  }

  for (const n of graph.nodes) {
    const id = keyToId.get(n.key)!
    const declared = n.parent && keyToId.has(n.parent) ? keyToId.get(n.parent)! : null
    const place = positioned(n, declared)
    const parent = place ? place.parent : declared
    const nextOrder = siblingOrder.get(parent) ?? (parent ? (committedChildren.get(parent) ?? 0) : 0)
    const order = place ? place.order : nextOrder
    siblingOrder.set(parent, Math.max(nextOrder, Math.floor(order) + 1))

    const before = prevById.get(id)
    let x = 0
    let y = 0
    if (parent === null) {
      const source = incoming.has(n.key) ? rootOf(lookup(incoming.get(n.key)!)) : undefined
      // Every target of a source takes a fan slot, including ones that already have a position.
      const fan = source ? (fanOut.get(source.id) ?? 0) : 0
      if (source) fanOut.set(source.id, fan + 1)
      const inFlow = flow.get(n.key)
      if (before && before.parent === null) {
        x = before.x
        y = before.y
      } else if (inFlow && flowOffset) {
        x = inFlow.x + flowOffset.x
        y = inFlow.y + flowOffset.y
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
      props: { ...n.props, layout: n.props.layout ?? REGISTRY[n.type].defaultLayout },
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
  // Changes to existing elements. A move must not put an element inside itself or its own children.
  const parentOf = (id: string): string | null => placedById.get(id)?.parent ?? board.byId.get(id)?.parent ?? null
  const isInside = (id: string, ancestor: string) => {
    for (let cur: string | null = id, hops = 0; cur && hops < 64; cur = parentOf(cur), hops++) if (cur === ancestor) return true
    return false
  }
  /** "move X above Y", "to the top": X's new order among its (committed) siblings. */
  const orderFor = (node: BoardNode, after?: string, before?: string): number | undefined => {
    if (!after && !before) return undefined
    const sibs = [...board.byId.values()].filter((n) => n.parent === node.parent && n.id !== node.id).sort((a, b) => a.order - b.order)
    if (!sibs.length) return undefined
    const all = [...board.byId.values()].filter((n) => n.parent === node.parent).sort((a, b) => a.order - b.order)
    const at = all.findIndex((n) => n.id === node.id)
    const between = (i: number) => {
      // Slot i among the siblings (0 = before the first).
      const lo = sibs[i - 1]?.order
      const hi = sibs[i]?.order
      return lo === undefined ? hi! - 1 : hi === undefined ? lo + 1 : (lo + hi) / 2
    }
    if (before === "$top") return between(0)
    if (after === "$bottom") return between(sibs.length)
    if (before === "$prev") return at > 0 ? between(Math.max(0, sibs.findIndex((n) => n.id === all[at - 1]!.id))) : undefined
    if (after === "$next") return at < all.length - 1 ? between(sibs.findIndex((n) => n.id === all[at + 1]!.id) + 1) : undefined
    const other = board.byHandle.get((after ?? before)!)
    const i = other ? sibs.findIndex((n) => n.id === other.id) : -1
    if (i < 0) return undefined
    return after ? between(i + 1) : between(i)
  }
  const patches: NodePatch[] = []
  for (const p of graph.patches) {
    const target = board.byHandle.get(p.target)
    if (!target) continue
    if (p.remove) {
      patches.push({ id: target.id, remove: true })
      continue
    }
    const order = orderFor(target, p.after, p.before)
    const parent = p.parent !== undefined ? keyToId.get(p.parent) : undefined
    const validParent = parent !== undefined && parent !== target.id && !isInside(parent, target.id) ? parent : undefined
    const patch: NodePatch = {
      id: target.id,
      ...(p.label ? { label: p.label } : {}),
      ...(p.type ? { type: p.type } : {}),
      ...(p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? { color: p.color.toLowerCase() } : {}),
      ...(validParent ? { parent: validParent } : {}),
      ...(p.detach && target.parent !== null ? { detach: true } : {}),
      ...(p.note?.trim() ? { note: p.note.trim() } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(p.items ? { items: p.items.slice(0, 12).map((x) => x.slice(0, 60)) } : {}),
      ...(p.unlink === "*" ? { unlink: "*" } : p.unlink && board.byHandle.get(p.unlink) ? { unlink: board.byHandle.get(p.unlink)!.id } : {}),
    }
    if (Object.keys(patch).length > 1) patches.push(patch)
  }
  return { keyToId, nodes, edges, patches }
}
