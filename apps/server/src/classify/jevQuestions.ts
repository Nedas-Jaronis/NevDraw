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
  nodeType: choice("Which wireframe or architecture element does `piece` describe", {
    page: "A whole screen or page of an app or website, such as a landing page, dashboard or settings page",
    section: "A region of a page that groups content, such as features, pricing, testimonials, footer or sidebar",
    navbar: "A navigation bar, header or menu across the top of a page",
    hero: "The large introductory banner at the top of a page with a headline and call to action",
    form: "A form that collects input, such as sign up, log in, checkout or contact",
    input: "A single input field, such as email, password or a search box",
    button: "A single button or call-to-action link",
    card: "A self-contained card or tile, such as a pricing card or profile card",
    list: "A list or feed of repeated items",
    table: "A table or grid of data with rows and columns",
    image: "An image, logo, photo, avatar, illustration or video",
    modal: "A dialog, modal, popup or drawer that appears over the page",
    text: "A block of text, heading, paragraph or caption",
    client: "The software a user runs: browser, web app, mobile app or frontend",
    service: "A backend server, API, microservice, worker or function",
    database: "A database that stores records, such as Postgres, MySQL or MongoDB",
    cache: "A cache or CDN, such as Redis",
    queue: "A message queue, event bus or stream, such as Kafka or SQS",
    storage: "File or object storage, such as S3 or a bucket",
    "external-api": "A third-party service called over the network, such as Stripe, Twilio or an AI API",
    box: "Something else, or too unclear to tell yet",
  }),

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
