# Live Wireframes

Type what you're building, and everyone on the board watches it turn into wireframes and system architecture as you type. It brings [Shapeshift](https://github.com/anishfn/shapeshift) to a multiplayer, Excalidraw-style canvas. See [`thoughts/PRD.md`](thoughts/PRD.md).

## Run

Requires [Bun](https://bun.sh) 1.2+.

```bash
bun install
cp .env.example .env   # optional: add Jev / Gemini / gpt-oss keys
bun dev          # web on http://localhost:3000, Effect server on :3001 (/ws forwarded)
```

One port for demos (the Effect server serves the built app and the room socket):

```bash
bun run build && bun run start                    # http://localhost:3000
cloudflared tunnel --url http://localhost:3000    # share the printed https://*.trycloudflare.com link
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
