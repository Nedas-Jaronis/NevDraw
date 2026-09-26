# Live Wireframes

Type what you're building, and everyone on the board watches it turn into wireframes and system architecture as you type. It brings [Shapeshift](https://github.com/anishfn/shapeshift) to a multiplayer, Excalidraw-style canvas. See [`thoughts/PRD.md`](thoughts/PRD.md).

## Run

Requires [Bun](https://bun.sh) 1.2+.

```bash
bun install
cp .env.example .env   # optional: add Jev / gpt-oss keys
bun dev          # web on http://localhost:3000, Effect server on :3001 (/ws forwarded)
```

One port for demos (the Effect server serves the built app and the room socket):

```bash
bun run build && bun run start                    # http://localhost:3000
cloudflared tunnel --url http://localhost:3000    # share the printed https://*.trycloudflare.com link
```

## Using the board

| Do | How |
| --- | --- |
| Add things | Type in the box at the bottom; drafts appear live for everyone, **Enter** commits, **Esc** discards |
| Refer to an element | Type `@` for autocomplete (`add a form to @landing-page`, `make @x red`, `wrap @a @b into one box`) |
| Select | Click; **Shift+click** to add; **drag on empty canvas** for a selection box; **Ctrl/⌘+A** for all |
| Delete | **Delete / Backspace**, or the ✕ / the "N selected · Delete" pill |
| Move | Drag an element (drags the whole selection) |
| Pan / zoom | Scroll or trackpad; **Space+drag** or middle mouse to pan; **Ctrl/⌘+scroll** or pinch to zoom |
| Theme | The ◐ / ☀ / ☾ button: system (default), light, dark |

## Keys and tuning

All keys are optional and live in `.env` (see `.env.example`): `TYPESAFE_API_KEY` (Jev: instant drafts), `GPTOSS_API_KEY` (LLM cleanup pass: gpt-oss-120b, Cerebras by default). Without them the board runs on the built-in keyword classifier.

```bash
bun run probe     # measures real Jev / gpt-oss latency with your keys and prints tuning values
```

## Develop

```bash
bun test          # protocol tests boot the real server and connect WebSocket clients
bun run check     # typecheck + tests
```

| Package | What lives there |
| --- | --- |
| `packages/shared` | Effect Schemas for every wire message (the single source of truth for types) |
| `apps/server` | Effect 3 + `@effect/platform-bun`: rooms, the `/ws/:roomId` socket, static serving |
| `apps/web` | Vite + React + Tailwind v4: the board, presence, cursors |
