import { NODE_TYPES, type NodeType, REGISTRY } from "@rtw/shared"
import { choice, noul } from "@typesafe-ai/sdk"

/**
 * The per-piece Jev question set. Every piece of an entry gets the same
 * questions in one parallel call; code assembles the answers into a graph.
 *
 * Criteria rules (from Shapeshift): self-contained, non-overlapping, an escape
 * option on every choice, and never ask Jev to extract values or count.
 *
 * The state Jev sees per piece:
 *   { piece, previous, container, handles }
 * where `previous` is the piece before it, `container` the element it would
 * nest in, and `handles` the @names already on the board.
 */
export const pieceQuestions = {
  nodeType: choice(
    "Which wireframe or architecture element does `piece` describe",
    Object.fromEntries(NODE_TYPES.map((t) => [t, REGISTRY[t].describe])) as Record<NodeType, string>,
  ),

  isContainer: noul("`piece` names something that holds other elements inside it, such as a page, section, form, card or dialog"),

  childOfContainer: noul(
    "`piece` belongs inside `container` (it is part of it), rather than being a separate element next to it. Answer no when `container` is null",
  ),

  layout: choice("How does `piece` ask for its contents or items to be arranged", {
    stack: "Stacked vertically, one under another",
    row: "Side by side in a row or columns",
    grid: "In a grid of tiles",
    none: "No arrangement is mentioned",
  }),

  edgeKind: choice("What relationship does `piece` describe between two elements", {
    calls: "One element calls, requests or sends data to another, such as an API call or webhook",
    reads: "One element reads, fetches or queries data from another",
    writes: "One element writes, saves, stores or updates data in another",
    publishes: "One element publishes, emits or pushes events or messages to another",
    subscribes: "One element subscribes to, listens to or consumes events from another",
    "navigates-to": "A page or button leads the user to another page",
    none: "No relationship between two elements is described",
  }),

  targetsHandle: noul("`piece` refers to one of the existing elements named in `handles`"),
} as const

export type PieceQuestions = typeof pieceQuestions
export const PIECE_QUESTION_COUNT = Object.keys(pieceQuestions).length
