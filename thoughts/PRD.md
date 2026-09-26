# PRD: Live Wireframe Board

A multiplayer whiteboard where each teammate types plain language and the board turns it into wireframes and system-architecture diagrams live, as they type. It brings [Shapeshift](https://github.com/anishfn/shapeshift)'s "an input that becomes what you mean" idea to a shared, Excalidraw-style canvas.

Built for ShellHacks 2026. Submission deadline: **2026-09-27, 11:00 EDT**.

---

## Problem Statement

Early product planning happens in two disconnected places. Some people write ideas down in docs, chats and notes ("landing page with a hero, pricing, a signup form…", "the API writes to Postgres and publishes to a queue…"). Someone else later redraws those ideas by hand in Figma, Excalidraw or a diagram tool. Translating text into boxes and arrows is slow and tedious, and the result is always out of date. Only one person can realistically "own" the diagram, and teammates can't see an idea take shape while it's still being described.

Student teams at hackathons feel this the most. They need a shared picture of what they're building (pages, components, services, databases and how they connect) in the first hour. Drawing it manually takes time away from building, and in the meantime everyone has a slightly different mental model.

## Solution

A shared board that anyone on the team joins by opening a link. Each person has their own **input box**. As they type, the board **instantly** turns their words into structured elements:

- **Wireframes:** "landing page with navbar, hero, pricing table and signup form" becomes a page frame with those sections stacked inside it, drawn as small, real-looking UI components.
- **Architecture:** "signup posts to @api which writes to postgres and publishes to a queue" becomes service, database and queue nodes connected by labeled arrows (`calls`, `writes`, `publishes`).
- Wireframes and architecture live on **one board**, and they can be connected. For example, a form can point at the service that handles it.

While someone types, their elements appear as **drafts**: dashed, in the typist's color, and visible to everyone in real time. Teammates watch ideas take shape. Pressing **Enter** commits the draft to the board. Every element gets a stable, readable **@handle** (such as `@landing-page` or `@postgres`), so later entries can refer to existing elements the way Claude Code lets you `@` a file. The agent also suggests links ("link to `@postgres`?") that the typist can accept with one key.

Speed comes from **Jev** (TypeSafe AI), which classifies every piece of the text on each keystroke in about 100–300ms. A code pipeline then assembles the draft deterministically ("Jev decides, code computes"). A **general LLM** (Gemini, or gpt-oss-120b) cleans up the result in the background when typing pauses and on Enter. It fixes phrasing and relationships Jev can't resolve, and it never blocks the instant draft.

## User Stories

### Joining and presence

1. As a team member, I want to create a new board with one click, so that my team has a place to start planning.
2. As a team member, I want to share a board with a single link, so that teammates can join without accounts or setup.
3. As a new visitor, I want to pick a display name the first time I join, so that teammates know who is contributing.
4. As a collaborator, I want to be assigned a distinct color automatically, so that my cursor, input and drafts are recognizable.
5. As a returning visitor, I want my name and color remembered on this device, so that I don't re-enter them each time.
6. As a collaborator, I want to see my teammates' live cursors on the board, so that I know where they're looking and working.
7. As a collaborator, I want to see who is currently in the room, so that I know who is participating.
8. As a collaborator, I want to see "X is typing…" with their raw text next to their draft, so that I understand why their draft looks the way it does.
9. As a collaborator on an unreliable connection, I want the app to reconnect automatically and resync the board, so that a network hiccup doesn't lose my session.
10. As a presenter, I want to open the same board on several devices at once, so that I can demonstrate real-time collaboration.

### Typing to drafts

11. As a collaborator, I want my own input box on the board, so that I can describe ideas without interfering with teammates.
12. As a collaborator, I want elements to appear within a frame of each keystroke, so that the board feels like it understands me instantly.
13. As a collaborator, I want my in-progress elements shown as dashed drafts in my color, so that everyone can tell they aren't committed yet.
14. As a teammate, I want to see other people's drafts form live, so that I can follow and react to ideas as they're being described.
15. As a collaborator, I want the parts of my draft I've already typed to stay stable while I type further, so that the board doesn't flicker or reshuffle unrelated boxes.
16. As a collaborator, I want an element's type to change only when the classifier is clearly more confident in the new type, so that boxes don't jump between types on every keystroke.
17. As a collaborator, I want a low-confidence element shown as a faint preview until it firms up, so that I can see a guess without it looking final.
18. As a collaborator, I want to press Enter to commit my draft, so that it becomes a permanent part of the board.
19. As a collaborator, I want to press Esc to discard my draft, so that I can abandon an idea cleanly.
20. As a collaborator, I want a discarded or deleted draft to fade out and the board to settle back, so that abandoned ideas leave no trace.
21. As a collaborator, I want a background "cleanup" pass to refine my draft when I pause, so that phrasing Jev can't fully resolve (pronouns, complex sentences) still ends up correct.
22. As a collaborator, I want the cleanup refinement to animate into place rather than snap, so that the change is easy to follow.
23. As a collaborator, I want Enter to commit the refined version when it's ready, so that the board stores the best interpretation of what I typed.
24. As a collaborator, I want the board to keep working if the Jev or LLM service is unavailable, so that a live demo never goes blank.

### Wireframes

25. As a product planner, I want "landing page" to create a page frame, so that I can build screens up from text.
26. As a product planner, I want "with navbar, hero, pricing and signup form" to place those sections inside the page, so that nesting follows my sentence.
27. As a product planner, I want children inside a page to stack in reading order like a real web page, so that the wireframe looks like an actual layout.
28. As a product planner, I want to say "in a row" or "grid of cards", so that I can control how children are arranged.
29. As a product planner, I want wireframe elements drawn as small, realistic UI components (buttons, inputs, cards, tables), so that the wireframe is readable and looks good.
30. As a product planner, I want a page link such as "login navigates to dashboard" drawn as a navigation arrow, so that I can map user flows.
31. As a product planner, I want anything that doesn't match a known component to still appear as a labeled box, so that nothing I type is silently dropped.

### Architecture

32. As an engineer, I want "server", "database", "cache", "queue", "storage", "client" and "external API" recognized as architecture nodes, so that I can sketch a system from text.
33. As an engineer, I want verbs such as "calls", "reads from", "writes to", "publishes to" and "subscribes to" drawn as typed, labeled arrows, so that the diagram shows how data flows.
34. As an engineer, I want architecture nodes placed in their own area separate from wireframe pages, so that the board stays readable.
35. As an engineer, I want a new node placed near whatever it connects to, so that related components cluster naturally.
36. As an engineer, I want to connect a wireframe element (such as a signup form) to an architecture node (such as `@api`), so that the UI and backend are linked in one picture.

### @handles and references

37. As a collaborator, I want every committed element to get a readable @handle based on its label, so that I can refer to it later.
38. As a collaborator, I want handles to be unique (a numeric suffix is added when a name is taken), so that a reference is never ambiguous.
39. As a collaborator, I want an element's handle to stay the same even if its label changes, so that existing references never break.
40. As a collaborator, I want typing `@` to open an autocomplete of board elements, so that I can reference things without remembering exact names.
41. As a collaborator, I want hovering a handle to highlight its element on the canvas, so that I can see what I'm referring to.
42. As a collaborator, I want "server writes to @postgres" to connect to the existing Postgres node instead of creating a duplicate, so that the board stays consistent.
43. As a collaborator, I want "add a signup form to @landing-page" to place a dashed draft child inside that existing page, so that I can extend teammates' work.
44. As a collaborator, I want the agent to suggest a link chip ("link to `@postgres`?") when my plain text seems to mean an existing element, so that I avoid duplicates without having to type `@`.
45. As a collaborator, I want to accept a suggestion with Tab or an arrow key and have it turn into a real `@` reference in my text, so that the binding is explicit and visible.
46. As a collaborator, I want an ignored suggestion to produce a new element on Enter, so that I stay in control.
47. As a collaborator, I want references to elements that don't exist to be ignored, so that the AI can never attach things to made-up targets.
48. As a collaborator, I want my entries to only add to the board (never rename, move or delete teammates' committed elements), so that nobody's typing can overwrite someone else's work.

### Canvas

49. As a collaborator, I want to pan the board by dragging empty space or scrolling, so that I can navigate a large board.
50. As a collaborator, I want to zoom with the trackpad, mouse wheel or pinch, so that I can see the overview or the detail.
51. As a collaborator, I want to select and drag any element, so that I can arrange the board myself.
52. As a collaborator, I want an element I dragged to stay pinned where I put it, so that automatic layout never undoes my arrangement.
53. As a collaborator, I want growing drafts to push unpinned top-level elements aside instead of overlapping them, so that the board stays legible while people type.
54. As a collaborator, I want arrows to follow their endpoints when elements move, so that connections stay correct.
55. As a collaborator, I want to delete an element by hand, so that I can clean up mistakes.
56. As a collaborator, I want the board to have a hand-drawn, sketchy look, so that it feels like a whiteboard and not a finished design.
57. As a collaborator, I want each committed element to show a small dot in its author's color, so that I know who contributed what.
58. As a mobile user, I want the board to work with touch (pan, pinch, drag), so that I can join from my phone.

### Saving

59. As a team member, I want committed elements saved on the server, so that the board survives refreshes and server restarts.
60. As a team member, I want drafts to never be saved, so that half-typed ideas don't clutter the saved board.
61. As a late joiner, I want to receive the full current board, including other people's live drafts, when I join, so that I'm immediately up to date.

### Operator / demo

62. As the operator, I want to run the whole app as one process on one port, so that a single Cloudflare quick tunnel exposes it.
63. As the operator, I want to switch the cleanup LLM between Gemini and gpt-oss-120b with one setting, so that I can pick whichever is faster or better.
64. As the operator, I want the cleanup pass to fall back to the other LLM if one fails, so that a provider outage doesn't break the demo.
65. As the operator, I want a small probe command that measures real Jev and LLM latency, so that I can tune debounce and timeouts against real numbers.
66. As the operator, I want a debug view showing each piece's Jev answers and confidences, so that I can diagnose misclassifications during development.
67. As the operator, I want a QR code of the board link, so that judges can join from their phones instantly.

---

## Implementation Decisions

### Overall shape

- **A monorepo using Bun workspaces**, with three units:
  - **shared**: Effect `Schema` definitions for the entry graph, board elements, edges, board edits and every wire message, plus the **element registry** (the fixed set of element and edge types). The shared schemas are the single source of truth for types on the client, the server and the LLM.
  - **server**: the Effect backend, which owns all room state and runs the agent pipeline.
  - **web**: a React single-page app built with Vite (Tailwind v4, shadcn/ui, Motion), with the custom canvas and element renderers.
- **One process, one port.** The Effect server serves the built web app's static files and the WebSocket endpoint. In development, the Vite dev server forwards the WebSocket path to the Bun server. It's exposed publicly with `cloudflared tunnel --url http://localhost:<port>` (a quick tunnel). The client must **reconnect automatically** (retrying with increasing delays, then resyncing the full board), because quick-tunnel URLs are temporary and connections can blip.
- **Effect 3.x stable** (npm `latest`, 3.22.x) with `@effect/platform`, `@effect/platform-bun`, `@effect/ai`, `@effect/ai-google`, `@effect/ai-openai` and `@effect/sql-sqlite-bun`. Do **not** use the Effect 4 release candidate: it lacks the Google provider and its APIs differ. For reading the library source, `npx opensrc` fetches the v4 default branch, so use a clone of the `effect@3.22.2` tag instead.

### Source of truth and the agent model

- **Text is the input; the server owns the board.** Each user has one input box. The server holds each room's authoritative state in two layers:
  - **The committed layer:** saved elements and edges.
  - **The draft layer:** one temporary draft graph per user. It's never saved, and it's replaced every time the text changes.
- **The agent only adds to the board.** An entry can create elements, add children to existing elements (drawn dashed until committed), and draw edges to existing elements. It can never rename, move or delete committed elements. Those are manual canvas actions only.
- **Declarative entry graphs.** Every classification pass (Jev or LLM) produces the **complete** graph for the entry's current text, never step-by-step edits. The server diffs the new graph against that user's previous draft by local key: unchanged keys keep their identity and position, new keys animate in, missing keys fade out. Stale responses are dropped using the latest-request-wins rule. The `EntryGraph` shape (settled during design):

  ```ts
  EntryGraph = {
    nodes: [{ key, type, label, parent: <local key> | <@handle> | null, props: { layout?: "row" | "stack" | "grid", ... } }],
    edges: [{ from: <key | @handle>, to: <key | @handle>, kind: EdgeKind, label? }],
    suggestions: [{ text, handle }]   // rendered as "link to @x?" chips
  }
  ```

- **Handle validation happens on the server.** Any `@handle` in a graph that doesn't exist on the committed board is removed before the draft is broadcast. This applies to both Jev-assembled and LLM-produced graphs.
- **Commit.** Enter commits the most recent graph. If a cleanup LLM result for the exact current text is in progress or cached, commit uses it (waiting briefly with a short timeout). Otherwise it commits the Jev-assembled graph. Each newly committed node gets a permanent handle.

### The Jev draft engine (the core, runs on every keystroke)

- **Jev produces the entire draft**: element types, nesting, edges and layout hints. Instant, Jev-driven drafts are the defining feature and are not optional.
- **Pipeline for each keystroke:**
  1. **Deterministic splitter.** Breaks the entry into pieces at sentences, commas, list words ("with", "and", "including") and relationship verbs, and extracts `@handle` tokens.
  2. **One parallel Jev `systemOne` call per piece.** Each call's `state` is a small JSON object: the piece text, the previous piece, the current container, and the board's handle list. Every piece gets the same fixed, rich set of questions. At minimum:
     - `nodeType` (choice over the registry)
     - `edgeKind` (choice, including `none`)
     - `isContainer` (noul)
     - `childOfContainer` (noul)
     - `layout` (choice)
     - `targetsHandle` (noul)
     - plus extra detail questions (variant, emphasis, data direction) as needed

     Cost is not a constraint; latency and stability are.
  3. **Cache per piece, keyed on the whole state object.** Only the piece being edited is re-classified, so earlier pieces never flicker and each keystroke costs about one call.
  4. **Code assembles the `EntryGraph`** from the answers per piece. The parent is the most recent open container, or the referenced handle. Edges come from `edgeKind` plus the neighboring pieces or handles.
  5. **Anti-flicker logic per piece**, ported from Shapeshift's decision state machine: input → ghost (faint) → committed type, with a challenger type needing two consecutive wins or very high confidence to replace the current one, and separate on/off thresholds for yes/no signals.
- **The Jev client** is an Effect service (`Classifier`) wrapping `@typesafe-ai/sdk` on the server only. It makes one fast attempt (no retries), uses a short timeout (about 2.5s, tuned by the probe), supports cancellation, and has an LRU cache. A **keyword classifier** layer with the same output shape fills in any piece that hasn't had a Jev answer yet, so something appears within one frame, and it's the backup when Jev fails.
- Jev's `systemOne` accepts one `state` per request and any number of named questions. The SDK has no endpoint for classifying several texts in one call, so parallel calls per piece are the chosen design.

### LLM cleanup pass (background)

- Runs after a longer typing pause (about 1.5s, tunable) and on Enter. It receives the full entry text plus a compact **board summary** (id, handle, type, label and parent of each committed element) and returns an `EntryGraph` using the same shared Schema, as structured output.
- Behind Effect's `LanguageModel` abstraction, with two provider layers: **Gemini** via `@effect/ai-google` (the default; Gemini enforces the Schema itself) and **gpt-oss-120b** via `@effect/ai-openai` pointed at an OpenAI-compatible endpoint. One environment variable picks the main provider, and the other is the automatic fallback.
- Its output replaces the Jev-assembled draft through the same key-based diff, so the refinement animates. It fixes what the splitter or Jev got wrong (pronouns, compound sentences, relationships between pieces) and proposes `suggestions`.

### Element registry

- A fixed set of types. Each registry entry defines its renderer, whether it's a container, its default layout, and its keyword-classifier hints. Adding a type means adding one registry entry, as with Shapeshift's card registry.
- **Wireframe types:** `page`, `section`, `navbar`, `hero`, `form`, `input`, `button`, `card`, `list`, `table`, `image`, `modal`, `text`.
- **Architecture types:** `client`, `service`, `database`, `cache`, `queue`, `storage`, `external-api`.
- **Catch-all:** `box` (a labeled box) for anything unmatched.
- **Edge kinds:** `calls`, `reads`, `writes`, `publishes`, `subscribes`, `navigates-to`.
- Renderers are small shadcn/ui-based components, with community components from 21st.dev for gaps (pricing, feature grid, testimonials, footer) as polish time allows. Target about 12 polished renderers. The rest use the catch-all look.

### @handles

- Handles are a readable slug of the label, with a numeric suffix when a name is taken, backed by a hidden stable id. **A handle never changes after it's created**, even if the label is renamed.
- **Only an explicit `@` token creates a binding.** Implicit matches become suggestion chips, which the typist accepts with Tab or an arrow key. Accepting rewrites the text to contain the `@` token. An ignored suggestion results in a new element on Enter.
- The client provides `@` autocomplete over the board, and hover highlighting from a handle to its element.

### Canvas (custom-built, DOM-rendered)

- No Excalidraw, tldraw or React Flow. The canvas is **built from scratch using the DOM**: a "world" layer transformed with CSS translate and scale for pan and zoom, elements as absolutely positioned React components, and an **SVG arrow layer** on top. The browser provides click-testing, text and focus.
- Supports mouse, trackpad and touch: pan, zoom, pinch, select, drag and delete.
- A hand-drawn look comes from a sketch font and a rough SVG filter on borders. Motion layout animations handle draft appearance, reflow, refinement and commit transitions.

### Layout

- **The LLM never outputs coordinates.**
- **Inside containers:** children are laid out by normal CSS flow (stack, row or grid from `props.layout`), not by layout code. Drafts inside committed containers cause live reflow, and that reshaping while people type is intended.
- **Top-level elements** are placed when first drafted into one of two areas: a **UI lane** (pages, left to right) and an **architecture lane** below it. A new architecture node goes in the nearest free spot to the average position of the elements it connects to.
- **Push-aside:** growing drafts nudge unpinned top-level elements to avoid overlap. **Any element a user drags becomes pinned** and is never moved automatically. Discarded drafts let the board settle back.
- **Arrows** are recalculated every frame between element edges (smooth curves or right-angled lines).

### Sync protocol and room server

- **A custom server that owns the state. No CRDT or Yjs.** Conflicts are rare because the agent only adds to the board and manual edits use last-write-wins per field.
- **Client → server:** join (with name and color), the input text (sent on every change, which the server throttles), commit, discard, accept suggestion, manual edits (move, delete), cursor position.
- **Server → client:** the full snapshot on join, draft graph updates per user, committed changes, presence (join and leave, cursors, "is typing" with raw text), suggestion chips (only to the typist).
- Rooms are identified by an id in the URL. No authentication. Name and color are stored in `localStorage`.

### Saving

- A `BoardStore` Effect service, implemented with **bun:sqlite** (via `@effect/sql-sqlite-bun`). It writes the committed layer on every commit and manual edit, and loads it when a room is first opened. Drafts and presence are memory-only. MongoDB Atlas is a possible later swap if time allows; it's a matter of providing a different implementation behind the same service.

### Configuration

- Server-only environment variables: TypeSafe API key and pinned Jev model version, Gemini API key, gpt-oss endpoint and key, the main LLM provider, the listening port, and debounce/timeout tuning. Keys never reach the browser.

---

## Testing Decisions

- **A good test checks behavior visible from outside**, meaning what clients receive, or what a pure function returns for given inputs. It doesn't check internal state, private helpers or rendering details. Tests use deterministic Effect test layers and never call the real Jev or LLM services.
- **Seams, from highest to lowest:**
  1. **The room server over the WebSocket protocol (the main seam).** Start the Effect server inside the test, with test layers: the keyword classifier in place of Jev, a canned `LanguageModel`, and an in-memory `BoardStore`. Connect two or three WebSocket clients to a room and check what each receives:
     - one client's typing produces a draft that every client sees
     - Enter commits the draft and assigns handles
     - Esc discards it
     - a late joiner gets the snapshot plus live drafts
     - committed state survives a reconnect
     - an invented `@handle` in an LLM result is removed
     - an entry can't change another user's committed elements
     - stale results are dropped
  2. **The draft engine as a pure function:** `(entry text, board summary, answers per piece) → EntryGraph`. Inputs are fixture Jev answers. Covers splitting, nesting, edge creation from verbs, `@` binding and the catch-all.
  3. **Board state as a pure reducer:** applying edits, and diffing a new `EntryGraph` against the previous draft. Checks that ids and positions stay the same for unchanged keys, that pinned elements never move, that handles are unique and never change, and that nothing the user has pinned is pushed aside.
  4. **Anti-flicker state machine per piece:** type transitions, challenger wins, and the on/off thresholds.
- **Prior art:** Shapeshift's test suite. Its parser tests are the model for the draft engine tests, its decision and signal tests are ported almost directly for the anti-flicker logic, and its client tests are the model for the classifier service's cache and fallback behavior. Runner: `bun test`.
- **Not automated:** canvas interaction and rendering, which are verified by hand on the demo devices; and live Jev and LLM quality and latency, which are checked with a separate probe script (`bun run probe`), not the test suite.

---

## Out of Scope

- User accounts, authentication, permissions, private boards.
- Changing the board by typing (renaming, moving or deleting via text). The agent only adds; changes are manual.
- Resizing elements, undo/redo, version history.
- Drawing tools (freehand pen, shapes drawn by hand). Elements come only from typed input.
- CRDT-based or offline-first editing.
- Exporting (PNG/SVG, Mermaid, code generation from the wireframe).
- More than about 12 polished element renderers, or a full catalog of 21st.dev components.
- MongoDB Atlas or any remote database (optional later swap only).
- A persistent public hostname. The demo uses a temporary Cloudflare quick tunnel.
- The Effect 4 release candidate.

---

## Further Notes

- **Build order** (each step produces something demoable):
  1. **Skeleton:** workspaces, the Effect server serving the SPA plus WebSockets, rooms, cursors, reconnect, the tunnel. Also a **Jev latency test per piece**.
  2. **Canvas:** pan, zoom, drag, pinning, arrows, the sketch look, lanes, push-aside.
  3. **The Jev draft engine:** splitter, questions per piece, classifier service, anti-flicker logic, assembly, diffing, shared drafts, commit, SQLite.
  4. **LLM cleanup pass:** both providers, fallback, handle validation.
  5. **@handles:** autocomplete, suggestion chips, hover highlighting.
  6. **Polish and demo:** renderers, transitions, a 3-device demo script, Devpost write-up, video.
- **Prize fit:** Best Overall (creativity, execution, design); **MLH Best Use of Gemini** (the cleanup pass); **INIT National** (helping student builders collaborate); **Microsoft** (AI built into the experience, and not a chatbot).
- **Demo risks:** the quick-tunnel URL changes on every restart, so start it early, keep it running, and show a QR code. Jev or LLM outages are covered by the keyword classifier and the LLM fallback.
- **Inspiration:** Shapeshift (MIT license). Its decision state machine, signal thresholds, debounced latest-request-wins classification, LRU caching, keyword fallback and registry pattern are ported and extended here, from one text box to one input box per user on a shared board, and from one card to a whole graph.
