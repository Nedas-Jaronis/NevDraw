import type { User } from "@rtw/shared"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { newRoomId, PALETTE, saveIdentity } from "../identity.ts"

type Session = { publicUrl: string | null; host: boolean; canGoRemote: boolean }

/** Same two letters as before: "Ada" → "AD". */
const initials = (name: string) => name.slice(0, 2).toUpperCase()

/**
 * The avatars at the top right. Yours opens a menu, like Excalidraw's live
 * collaboration: start a new board, go remote (a public link and QR for this
 * board, opened by the host's server), see who's here, change your name.
 */
export function ProfileMenu(props: { users: User[]; selfId: string | null; roomId: string }) {
  const [open, setOpen] = useState(false)
  const me = props.users.find((u) => u.id === props.selfId)
  const others = props.users.filter((u) => u.id !== props.selfId)
  const ref = useRef<HTMLDivElement>(null)
  /** The public link and what this viewer may do, fetched when the menu opens. */
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!open) return
    void fetch("/api/session")
      .then((r) => r.json() as Promise<Session>)
      .then(setSession)
      .catch(() => setSession({ publicUrl: null, host: false, canGoRemote: false }))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} data-ui className="pointer-events-auto relative">
      <div className="flex -space-x-2" aria-label="People in this room">
        {others.map((u) => (
          <Avatar key={u.id} user={u} title={u.name} />
        ))}
        {me && (
          <button type="button" aria-label="Your profile and session" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-full transition active:scale-95">
            <Avatar user={me} title={`${me.name} (you)`} ring />
          </button>
        )}
      </div>
      <AnimatePresence>
        {open && me && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-10 z-50 w-[min(300px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-xl"
          >
            <Me user={me} />
            <div className="h-px bg-[var(--hairline)]" />
            <LiveSession roomId={props.roomId} session={session} setSession={setSession} />
            <div className="h-px bg-[var(--hairline)]" />
            <NewBoard publicUrl={session?.publicUrl ?? null} />
            {props.users.length > 1 && (
              <>
                <div className="h-px bg-[var(--hairline)]" />
                <div className="px-4 py-3">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">On this board</div>
                  <ul className="flex flex-col gap-1.5">
                    {props.users.map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-xs">
                        <span className="h-2 w-2 rounded-full" style={{ background: u.color }} />
                        {u.name}
                        {u.id === props.selfId && <span className="text-[var(--muted)]">(you)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Avatar({ user, title, ring }: { user: User; title: string; ring?: boolean }) {
  return (
    <div
      title={user.typing ? `${title}, typing…` : title}
      className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--panel)] text-xs font-semibold text-white ${ring ? "shadow-sm" : ""}`}
      style={{ background: user.color }}
    >
      {initials(user.name)}
      {user.typing && (
        <span aria-label="typing" className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: user.color }} />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[var(--panel)]" style={{ background: user.color }} />
        </span>
      )}
    </div>
  )
}

/** Your name and color; saving re-joins with them. */
function Me({ user }: { user: User }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [color, setColor] = useState(user.color)
  if (!editing)
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar user={user} title={user.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="text-[11px] text-[var(--muted)]">You</div>
        </div>
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
          Edit
        </button>
      </div>
    )
  return (
    <form
      className="flex flex-col gap-2 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim().slice(0, 40)
        if (!n) return
        saveIdentity({ name: n, color })
        location.reload()
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={40}
        aria-label="Your name"
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border border-[var(--panel-border)] bg-transparent px-2 py-1 text-sm outline-none"
      />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === color}
            aria-label={c}
            onClick={() => setColor(c)}
            className="h-5 w-5 rounded-full"
            style={{ background: c, boxShadow: c === color ? `0 0 0 2px var(--panel), 0 0 0 3.5px ${c}` : undefined }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-3 text-xs">
        <button type="button" onClick={() => setEditing(false)} className="text-[var(--muted)] hover:text-[var(--ink)]">
          Cancel
        </button>
        <button type="submit" className="font-medium" style={{ color }}>
          Save
        </button>
      </div>
    </form>
  )
}

/** The public link for this board: already live, "Go remote" for the host, or how to get one. */
function LiveSession({
  roomId,
  session,
  setSession,
}: {
  roomId: string
  session: Session | null
  setSession: (f: (s: Session | null) => Session | null) => void
}) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Someone who came in through the public link is already remote: their address is the link.
  const onPublicOrigin = location.hostname.endsWith(".trycloudflare.com")
  const base = session?.publicUrl ?? (onPublicOrigin ? location.origin : null)
  const link = base ? `${base}/b/${roomId}` : null

  useEffect(() => {
    if (!link) return
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr))
  }, [link])

  const goRemote = async () => {
    setOpening(true)
    setError(null)
    try {
      const r = await fetch("/api/session/remote", { method: "POST" })
      const body = (await r.json()) as { publicUrl?: string; error?: string }
      if (body.publicUrl) setSession((s) => ({ ...(s ?? { host: true, canGoRemote: true }), publicUrl: body.publicUrl! }))
      else setError(body.error ?? "Couldn't open a public link.")
    } catch {
      setError("Couldn't reach the server.")
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        Live session
        {link && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="public" />}
      </div>
      {link ? (
        <div className="flex flex-col items-center gap-2">
          {qr && <img src={qr} alt="QR code for the public link" className="h-36 w-36 rounded-lg bg-white p-1.5" />}
          <div className="w-full break-all rounded-md bg-[var(--ink)]/[0.04] px-2 py-1 text-[11px] text-[var(--muted)]">{link}</div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(link)
                .then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                })
                .catch(() => {})
            }}
            className="w-full rounded-lg bg-[var(--ink)] py-1.5 text-xs font-medium text-[var(--panel)] active:scale-[0.98]"
          >
            {copied ? "Copied" : "Copy public link"}
          </button>
          <p className="text-center text-[10px] text-[var(--muted)]">Anyone with the link joins this board live, from any network.</p>
        </div>
      ) : session === null ? (
        <p className="text-xs text-[var(--muted)]">Checking…</p>
      ) : session.canGoRemote ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--muted)]">Right now only this network can reach the board. Go remote for a public link anyone can join.</p>
          <button
            type="button"
            disabled={opening}
            onClick={goRemote}
            className="w-full rounded-lg bg-[var(--ink)] py-1.5 text-xs font-medium text-[var(--panel)] disabled:opacity-60 active:scale-[0.98]"
          >
            {opening ? "Opening a public link… (~10 s)" : "Go remote"}
          </button>
          {error && <p className="text-[11px] text-red-500">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {session.host ? "Install cloudflared on this machine to share a public link." : "Only the host can open a public link. Ask them to Go remote."}
        </p>
      )}
    </div>
  )
}

/** A fresh board; once the session is public, a fresh public board. */
function NewBoard({ publicUrl }: { publicUrl: string | null }) {
  const id = () => newRoomId()
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <button type="button" onClick={() => location.assign(`/b/${id()}`)} className="rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--ink)]/5">
        New board
        <span className="block text-[10px] text-[var(--muted)]">Start a fresh session on an empty board</span>
      </button>
      {publicUrl && !location.hostname.endsWith(".trycloudflare.com") && (
        <button
          type="button"
          onClick={() => location.assign(`${publicUrl}/b/${id()}`)}
          className="rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--ink)]/5"
        >
          New remote board
          <span className="block text-[10px] text-[var(--muted)]">Open a fresh board on the public link</span>
        </button>
      )}
    </div>
  )
}
