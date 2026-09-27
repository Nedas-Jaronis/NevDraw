import { useState } from "react"
import { Board } from "./board/Board.tsx"
import { DocsPage } from "./docs/DocsPage.tsx"
import { type Identity, loadIdentity, newRoomId, PALETTE, randomColor, saveIdentity } from "./identity.ts"

function roomFromPath(): string | null {
  const m = location.pathname.match(/^\/b\/([A-Za-z0-9_-]{1,64})\/?$/)
  return m?.[1] ?? null
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity)
  const roomId = roomFromPath()

  if (/^\/docs\/?$/.test(location.pathname)) return <DocsPage />
  if (!roomId) return <Home />
  if (!identity)
    return (
      <NameDialog
        onDone={(id) => {
          saveIdentity(id)
          setIdentity(id)
        }}
      />
    )
  return <Board roomId={roomId} identity={identity} />
}

function Home() {
  return (
    <main className="board-grid flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">NevDraw</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Type what you're building. Everyone on the board watches it turn into wireframes and architecture as you type.
        </p>
        <button
          type="button"
          className="mt-5 w-full rounded-lg bg-[var(--ink)] px-4 py-2.5 font-medium text-[var(--board-bg)]"
          onClick={() => location.assign(`/b/${newRoomId()}`)}
        >
          New board
        </button>
        <a href="/docs" className="mt-3 block text-center text-sm text-[var(--muted)] underline-offset-4 hover:text-[var(--ink)] hover:underline">
          How to use it
        </a>
      </div>
    </main>
  )
}

function NameDialog({ onDone }: { onDone: (id: Identity) => void }) {
  const [name, setName] = useState("")
  const [color, setColor] = useState(randomColor)
  return (
    <main className="board-grid flex min-h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim().slice(0, 40)
          if (n) onDone({ name: n, color })
        }}
      >
        <h1 className="text-lg font-semibold">Join the board</h1>
        <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="mt-1 w-full rounded-lg border border-[var(--panel-border)] bg-transparent px-3 py-2 outline-none focus:ring-2"
          style={{ ["--tw-ring-color" as string]: color }}
        />
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              onClick={() => setColor(c)}
              className="h-7 w-7 rounded-full ring-offset-2 ring-offset-[var(--panel)]"
              style={{ background: c, boxShadow: c === color ? `0 0 0 2px var(--panel), 0 0 0 4px ${c}` : undefined }}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={!name.trim()}
          className="mt-5 w-full rounded-lg px-4 py-2.5 font-medium text-white disabled:opacity-40"
          style={{ background: color }}
        >
          Join
        </button>
      </form>
    </main>
  )
}
