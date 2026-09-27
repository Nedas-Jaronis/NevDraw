import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { applyTheme, followSystem, loadTheme, type ThemePref } from "../theme.ts"

/** The floating sheet both sidebars share: calm, frosted, rounded, inset from the edges. */
export const SHEET =
  "fixed bottom-3 top-3 z-50 flex w-[min(300px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)]/85 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl"

/**
 * The one button at the top left, like Excalidraw's menu: it opens a sidebar
 * with the board's link and QR code, Export image, and the theme.
 */
export function SideMenu(props: { roomId: string; status: string; onExport: () => void }) {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemePref>(loadTheme)
  useEffect(() => {
    applyTheme(theme)
    return followSystem(theme)
  }, [theme])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <div data-ui className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] text-[var(--muted)] shadow-sm transition hover:text-[var(--ink)] active:scale-95"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {props.status !== "open" && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            {props.status === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              data-ui
              className="pointer-events-auto fixed inset-0 z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              data-ui
              aria-label="Menu"
              // Same motion as the help sidebar: slides fully in from its edge (it floats 12px in, hence 110%).
              initial={{ x: "-110%" }}
              animate={{ x: 0 }}
              exit={{ x: "-110%", transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              className={`${SHEET} pointer-events-auto left-3`}
            >
              <div className="flex items-start justify-between px-5 pb-3 pt-5">
                <div>
                  <div className="text-[15px] font-semibold tracking-tight">NevDraw</div>
                  <div className="mt-0.5 text-xs text-[var(--muted)]">{props.roomId}</div>
                </div>
                <CloseButton onClick={() => setOpen(false)} />
              </div>
              <div className="sleek-scroll flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
                <ShareLink />
                <Group title="Board">
                  <Item
                    icon={<path d="M8 2.5v7M5 6.5l3 3 3-3M3 11.5v1.5h10v-1.5" />}
                    label="Export image"
                    hint="⇧⌘E"
                    onClick={() => {
                      setOpen(false)
                      props.onExport()
                    }}
                  />
                </Group>
                <Group title="Appearance">
                  <div className="grid grid-cols-3 rounded-xl bg-[var(--ink)]/[0.05] p-1">
                    {(["system", "light", "dark"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={theme === t}
                        onClick={() => setTheme(t)}
                        className={`rounded-lg py-1.5 text-xs capitalize transition ${
                          theme === t ? "bg-[var(--panel)] font-medium text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </Group>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

/** This board's link: QR for phones, and copy. */
function ShareLink() {
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(location.href, { margin: 1, width: 360 }).then(setQr))
  }, [])
  return (
    <Group title="Share">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-[var(--ink)]/[0.04] p-4">
        {qr ? (
          <img src={qr} alt="QR code for this board" className="h-36 w-36 rounded-xl bg-white p-2" />
        ) : (
          <div className="h-36 w-36 rounded-xl bg-[var(--ink)]/[0.06]" />
        )}
        <span className="text-center text-[11px] text-[var(--muted)]">Scan to join on a phone</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(location.href)
              .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              })
              .catch(() => {})
          }}
          className="w-full rounded-xl bg-[var(--ink)] py-2 text-xs font-medium text-[var(--panel)] transition active:scale-[0.98]"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </Group>
  )
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">{title}</h3>
      {children}
    </section>
  )
}

function Item(props: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] transition hover:bg-[var(--ink)]/[0.05]"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {props.icon}
      </svg>
      <span className="flex-1">{props.label}</span>
      {props.hint && <span className="text-[11px] text-[var(--muted)]">{props.hint}</span>}
    </button>
  )
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-[var(--ink)]/[0.06] hover:text-[var(--ink)]"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}
