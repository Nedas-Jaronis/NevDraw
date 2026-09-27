import { ACCENT_NAMES, ACCENTS, NODE_TYPES, type NodeType, REGISTRY } from "@rtw/shared"
import { choice, noul } from "@typesafe-ai/sdk"
import { DRAWABLE } from "../engine/sketch.ts"

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

  isGroup: noul(
    "`piece` describes several separate copies of the same element as one group, such as a stack, cluster, pool, farm or fleet of servers, rather than one single element",
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

  accent: choice("Which color does `piece` imply for its element, when it doesn't name one", {
    ...(Object.fromEntries(ACCENT_NAMES.map((a) => [a, ACCENTS[a].describe])) as Record<(typeof ACCENT_NAMES)[number], string>),
    none: "No particular color is implied",
  }),
} as const

export type PieceQuestions = typeof pieceQuestions
export const PIECE_QUESTION_COUNT = Object.keys(pieceQuestions).length

/**
 * Drawing mode: which component a sketch shows, from the words code wrote
 * about its geometry. Options are the drawable registry types, each with its
 * template's description and how it's drawn; `exclude` asks for the next-best.
 */
export function sketchQuestions(exclude: readonly string[] = []) {
  const options = Object.fromEntries(
    Object.entries(DRAWABLE)
      .filter(([k]) => !exclude.includes(k))
      .map(([k, d]) => [k, `${REGISTRY[d.type].describe}. Drawn as ${d.drawn}`]),
  ) as Record<string, string>
  return {
    component: choice("Which interface element is `sketch` a drawing of", { ...options, none: "None of these fit the drawing" }),
  } as const
}
