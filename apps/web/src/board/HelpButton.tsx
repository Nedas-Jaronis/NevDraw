import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"

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
    <div data-ui className="absolute bottom-[104px] right-3 z-40 sm:bottom-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-label="About Live Wireframes"
            className="absolute bottom-11 right-0 flex max-h-[min(70vh,560px)] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
              <span className="text-sm font-semibold">Live Wireframes</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded-md px-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed">
              <Section title="The story">
                <p>
                  It started with{" "}
                  <a href="https://github.com/anishfn/shapeshift" target="_blank" rel="noreferrer" className="underline decoration-dotted">
                    Shapeshift
                  </a>
                  , where a sentence turns into a working widget as you type. We asked what happens when a whole team does that on
                  one board, at the same time.
                </p>
                <p className="mt-1.5">
                  Everyone gets their own input box. As you type, your idea appears as a dashed draft that everyone can watch take
                  shape. Press Enter and it becomes real. Pages, forms and heroes sit next to the servers, queues and databases behind
                  them, with arrows between them. No dragging boxes from a palette: you describe it, the board draws it.
                </p>
              </Section>

              <Section title="How your typing works">
                <ul className="flex flex-col gap-1">
                  <Li>Your words turn into a dashed draft instantly, for everyone to see.</Li>
                  <Li>When you pause, an AI re-reads the whole sentence and fixes names, types, nesting and arrows.</Li>
                  <Li>
                    <Key>Enter</Key> commits it; <Key>Esc</Key> throws the draft away.
                  </Li>
                  <Li>
                    Every element gets a tag like <Code>@signup-form</Code>. Type <Code>@</Code> to point at one. Hover an
                    element to see its tag, and click the tag to rename it.
                  </Li>
                </ul>
              </Section>

              <Section title="Try saying">
                <Examples
                  items={[
                    "a landing page with a navbar, a hero, three pricing cards and a footer",
                    "a docs page with a sidebar and a content section",
                    "a signup form with name, email and password",
                    "5 servers through 2 load balancers, each load balancer takes 3 databases",
                    "the checkout calls stripe, then it emails the user via sendgrid",
                    "a table of timers with increments of 15",
                  ]}
                />
              </Section>

              <Section title="Changing what's there">
                <Examples
                  items={[
                    "make @hero tiffany blue",
                    "turn all servers inside @servers-stack blue",
                    "add a redis cache between @api and @postgres",
                    "wrap @api @postgres into a backend box",
                    "detach @server-1 from @servers-stack",
                    "embed an image inside the hero",
                    "annotate @hero: swap in the real photo",
                  ]}
                />
              </Section>

              <Section title="Arrows read like English">
                <p>
                  <em>calls, uses, sends to</em> → calls · <em>reads from, queries</em> → reads · <em>writes to, stores in</em> →
                  writes · <em>publishes to</em> · <em>consumes from, subscribes to</em> · <em>navigates to, leads to</em>. Counts
                  make separate numbered pieces; say <em>each … takes 3</em> to split them.
                </p>
              </Section>

              <Section title="Hands-on">
                <ul className="flex flex-col gap-1">
                  <Li>Drag elements; they stay where you put them. Drag on empty space to box-select.</Li>
                  <Li>
                    <Key>Delete</Key> removes the selection, <Key>⌘/Ctrl A</Key> selects all, hold <Key>Space</Key> to pan,
                    pinch or <Key>Ctrl</Key>+scroll to zoom.
                  </Li>
                  <Li>Drop a picture on any element, or use Upload / Link on images and heroes.</Li>
                  <Li>The note icon on an element opens a note for your team. Click it again to minimize.</Li>
                  <Li>Share (top left) shows a QR code so phones can join the same board, and exports it as PNG or PDF.</Li>
                </ul>
              </Section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h3>
      {children}
    </section>
  )
}

function Li({ children }: { children: ReactNode }) {
  return <li className="relative pl-3 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-[var(--muted)]">{children}</li>
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-[var(--hairline)] px-1 font-sans text-[10px]">{children}</kbd>
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[var(--ink)]/5 px-1 text-[11px]">{children}</code>
}

/** Example prompts; click one to copy it. */
function Examples({ items }: { items: string[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <ul className="flex flex-col gap-1">
      {items.map((x) => (
        <li key={x}>
          <button
            type="button"
            title="Copy"
            onClick={() => {
              void navigator.clipboard?.writeText(x).catch(() => {})
              setCopied(x)
              setTimeout(() => setCopied((c) => (c === x ? null : c)), 1200)
            }}
            className="w-full rounded-md bg-[var(--ink)]/[0.04] px-2 py-1 text-left text-[11px] transition hover:bg-[var(--ink)]/[0.08]"
          >
            {copied === x ? "Copied ✓" : x}
          </button>
        </li>
      ))}
    </ul>
  )
}
