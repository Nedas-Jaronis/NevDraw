import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { CloseButton } from "./SideMenu.tsx"

/** The "?" in the corner: where this came from, and how to talk to the board. */
export function HelpButton() {
  const [open, setOpen] = useState(false)
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
      <AnimatePresence>
        {open && (
          <motion.div
            data-ui
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
        )}
        {open && (
          <motion.aside
            data-ui
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%", transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            role="dialog"
            aria-label="About NevDraw"
            // The whole right side, like a macOS inspector: flush to the edge, full height.
            className="fixed inset-y-0 right-0 z-50 flex w-[min(400px,100vw)] flex-col border-l border-[var(--panel-border)] bg-[var(--panel)]/90 shadow-[-24px_0_64px_-32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--hairline)] px-6 pb-4 pt-6">
              <div>
                <h2 className="text-[19px] font-semibold tracking-tight">About</h2>
                <p className="mt-1 text-[12.5px] text-[var(--muted)]">Why NevDraw exists.</p>
              </div>
              <CloseButton onClick={() => setOpen(false)} />
            </header>
            <div className="sleek-scroll flex flex-1 flex-col gap-7 overflow-y-auto px-6 pb-8 pt-6 text-[13px] leading-relaxed text-[var(--ink)]/80">
              <Section title="The story">
                <p>
                  It started with{" "}
                  <a href="https://github.com/anishfn/shapeshift" target="_blank" rel="noreferrer" className="underline decoration-dotted">
                    Shapeshift
                  </a>
                  , where a sentence turns into a working widget as you type. We asked what happens when a whole team does that on
                  one board, at the same time.
                </p>
                <p className="mt-2">
                  Everyone gets their own input box. As you type, your idea appears as a dashed draft that everyone can watch take
                  shape. Press Enter and it becomes real. Pages, forms and heroes sit next to the servers, queues and databases behind
                  them, with arrows between them. No dragging boxes from a palette: you describe it, the board draws it.
                </p>
              </Section>
              <a href="/docs" className="text-[13px] font-medium text-[var(--ink)] underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-[var(--ink)]">
                Read the docs →
              </a>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <div data-ui className="absolute bottom-[104px] right-3 z-40 sm:bottom-3">
      <button
        type="button"
        aria-label={open ? "Close help" : "Help and about"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--panel)] text-sm font-medium text-[var(--muted)] shadow-sm transition hover:text-[var(--ink)] active:scale-95"
      >
        ?
      </button>
      </div>
    </>
  )
}

/** A docs-style section: a plain heading and its text. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[15px] font-semibold tracking-tight text-[var(--ink)]">{title}</h3>
      {children}
    </section>
  )
}
