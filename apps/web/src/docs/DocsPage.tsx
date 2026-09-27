import { type ReactNode, useEffect, useState } from "react"
import { newRoomId } from "../identity.ts"
import { applyTheme, followSystem, loadTheme } from "../theme.ts"

/** The sections, in order: the table of contents and the page follow this list. */
const SECTIONS = [
  { id: "start", title: "Getting started" },
  { id: "how", title: "How typing becomes a board" },
  { id: "input", title: "Writing good input" },
  { id: "architecture", title: "Architecture diagrams" },
  { id: "changes", title: "Changing what's there" },
  { id: "together", title: "Working together" },
  { id: "export", title: "Export" },
  { id: "keys", title: "Keyboard shortcuts" },
  { id: "tips", title: "When it gets it wrong" },
] as const

/**
 * /docs: how to use Live Wireframes, and how to phrase input so the board
 * reads it the way you mean it.
 */
export function DocsPage() {
  const [active, setActive] = useState<string>(SECTIONS[0].id)

  useEffect(() => {
    const pref = loadTheme()
    applyTheme(pref)
    return followSystem(pref)
  }, [])

  // Highlight the section being read in the table of contents.
  useEffect(() => {
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = SECTIONS.find((s) => seen.get(s.id))
        if (first) setActive(first.id)
      },
      { rootMargin: "-10% 0px -70% 0px" },
    )
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [])

  return (
    <div className="min-h-full bg-[var(--board-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--hairline)] bg-[var(--board-bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <a href="/" className="text-[15px] font-semibold tracking-tight">
            Live Wireframes <span className="font-normal text-[var(--muted)]">Docs</span>
          </a>
          <button
            type="button"
            onClick={() => (history.length > 1 && document.referrer.includes(location.host) ? history.back() : location.assign(`/b/${newRoomId()}`))}
            className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--panel)] transition active:scale-[0.98]"
          >
            Open a board
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-12 px-6">
        <nav aria-label="On this page" className="sticky top-16 hidden h-fit w-52 shrink-0 py-10 md:block">
          <ul className="flex flex-col gap-0.5 border-l border-[var(--hairline)]">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={`-ml-px block border-l py-1 pl-4 text-[13px] transition ${
                    active === s.id
                      ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 max-w-2xl flex-1 py-10 text-[15px] leading-7 text-[var(--ink)]/85">
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-[var(--ink)]">Using Live Wireframes</h1>
          <p className="mt-3 text-[17px] leading-7 text-[var(--muted)]">
            Describe what you're building in plain English. The board draws it as you type, for everyone in the room, and Enter
            makes it real.
          </p>

          <Section id="start" title="Getting started">
            <Steps
              items={[
                <>Open a board and pick a name and a color. The link in your address bar is the board; anyone with it joins.</>,
                <>
                  Type into the box at the bottom, for example <Prompt>a landing page with a navbar, a hero and a footer</Prompt>.
                </>,
                <>
                  Watch the dashed draft appear. Press <Key>Enter</Key> to commit it, or <Key>Esc</Key> to throw it away.
                </>,
                <>Keep going: every entry adds to the same board, and can point at what's already there.</>,
              ]}
            />
          </Section>

          <Section id="how" title="How typing becomes a board">
            <p>Three things happen as you type:</p>
            <Dl
              items={[
                ["Instantly", "Your words turn into a dashed draft that everyone can see, so the room follows your thinking live."],
                [
                  "On a pause",
                  "An AI re-reads the whole sentence and fixes names, types, nesting and arrows. The draft updates in place.",
                ],
                ["On Enter", "It waits a moment for that reading, then commits. The dashed outline becomes solid."],
              ]}
            />
            <Note>
              Numbers and colors are computed exactly from your words: "increments of 15" becomes 15, 30, 45 and 60, and "tiffany
              blue" is always the same blue. The AI decides what things are; it never changes the values you gave.
            </Note>
          </Section>

          <Section id="input" title="Writing good input">
            <p>The board understands ordinary sentences. These habits make it read you exactly right.</p>

            <H3>Name the container first, then its parts</H3>
            <p>
              Say what holds things, then what's inside it. Use <em>with</em> or <em>containing</em> for what's inside, and{" "}
              <em>and</em> or commas to list parts side by side.
            </p>
            <Prompts
              items={[
                "a landing page with a navbar, a hero, three pricing cards and a footer",
                "a docs page with a sidebar and a content section",
                "a settings modal containing a dark mode toggle and a save button",
              ]}
            />

            <H3>Say how many, and what the values are</H3>
            <p>
              Counts make separate pieces ("three pricing cards", "5 servers"). Values fill things in: a colon starts a list, and
              ranges are worked out for you.
            </p>
            <Prompts
              items={[
                "a checklist: milk, eggs, bread",
                "a table of timers with increments of 15",
                "a poll: pizza, tacos, sushi",
                "a signup form with name, email and password",
              ]}
            />

            <H3>Give it a color</H3>
            <p>
              Any color name works, including specific ones. Words with a meaning imply one too: a "delete button" is red, a
              "success banner" green.
            </p>
            <Prompts items={["a red call to action button", "a tiffany blue hero", "a dark mode settings card"]} />

            <H3>Put things where they belong</H3>
            <p>Order matters on a page. Say where a new part goes, relative to what's there.</p>
            <Prompts
              items={[
                "add a testimonials section between @hero and @footer",
                "a banner at the top of @landing-page",
                "a newsletter form below @features",
              ]}
            />

            <H3>One idea per Enter</H3>
            <p>
              Build in steps rather than one huge sentence: first the page, then its sections, then the details. Each step is easy
              to read, easy to fix, and everyone can follow along.
            </p>

            <H3>Point at what exists with @</H3>
            <p>
              Every element has a tag like <Code>@signup-form</Code>. Type <Key>@</Key> to pick one, or just say "the signup
              form"; the board knows you mean the existing one. Hover an element to see its tag, and click the tag to rename it.
            </p>
          </Section>

          <Section id="architecture" title="Architecture diagrams">
            <p>Services, databases, queues and caches become system pieces, and verbs become arrows.</p>
            <Table
              head={["You write", "Arrow"]}
              rows={[
                ["calls, uses, sends to, connects to", "calls"],
                ["reads from, queries, fetches from", "reads"],
                ["writes to, stores in, saves to", "writes"],
                ["publishes to, emits to", "publishes"],
                ["consumes from, subscribes to, listens to", "subscribes"],
                ["navigates to, leads to", "navigates to"],
              ]}
            />
            <H3>Chains and fan-outs</H3>
            <p>
              Say the flow in order and use <em>which</em> or <em>then</em> to keep going. Counts make numbered pieces, and arrows to
              a group reach every member.
            </p>
            <Prompts
              items={[
                "a web app calls an api which reads from postgres",
                "a mobile app and a web app both call an api gateway",
                "5 servers through 2 load balancers, each load balancer takes 3 databases",
                "an orders service publishes to a kafka queue, an email worker consumes from it",
                "the checkout calls stripe, then it emails the user via sendgrid",
              ]}
            />
            <Note>
              "Each … takes 3" splits the pieces between them; without it, every load balancer connects to every database.
            </Note>
          </Section>

          <Section id="changes" title="Changing what's there">
            <p>Name an existing element with its tag and say what to change. These never create new elements.</p>
            <Table
              head={["To", "Say"]}
              rows={[
                ["Recolor", "make @hero tiffany blue"],
                ["Recolor many", "turn all servers inside @servers-stack blue"],
                ["Rename", "rename @hero to Welcome"],
                ["Change the type", "turn @timer into a stopwatch"],
                ["Group", "wrap @api @postgres @redis into a backend box"],
                ["Insert into a flow", "add a redis cache between @api and @postgres"],
                ["Take out", "detach @server-1 from @servers-stack"],
                ["Remove arrows", "disconnect @load-balancer and @servers-stack"],
                ["Add an image", "embed an image inside the hero"],
                ["Leave a note", "annotate @hero: swap in the real photo"],
              ]}
            />
            <H3>By hand</H3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 marker:text-[var(--muted)]">
              <li>Drag elements anywhere; they stay where you put them.</li>
              <li>Drag on empty space to box-select, then press Delete or drag them together.</li>
              <li>Drop a picture on any element, or use Upload / Link on images and heroes.</li>
              <li>The note icon on an element opens a note for your team; click it again to minimize.</li>
            </ul>
          </Section>

          <Section id="together" title="Working together">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-[var(--muted)]">
              <li>Everyone types in their own box. Drafts show in each person's color as they type.</li>
              <li>The menu (top left) has this board's link and a QR code for phones.</li>
              <li>
                To invite people outside your network, click your avatar (top right) and choose <em>Go remote</em>. You get a
                public link and QR code in about ten seconds.
              </li>
              <li>Your avatar menu also starts a new board and lets you change your name and color.</li>
            </ul>
          </Section>

          <Section id="export" title="Export">
            <p>
              Open the menu and choose <em>Export image</em>, or press <Key>⇧⌘E</Key>. Export the whole board or only what's
              selected, with or without the background, in light or dark, at 1×, 2× or 3× resolution, as PNG or PDF, or copy it
              to the clipboard.
            </p>
          </Section>

          <Section id="keys" title="Keyboard shortcuts">
            <Table
              head={["Key", "Does"]}
              rows={[
                ["Enter", "Commit your draft"],
                ["Esc", "Discard your draft, or clear the selection"],
                ["@", "Reference an existing element"],
                ["Delete", "Delete the selection"],
                ["⌘/Ctrl A", "Select everything"],
                ["Space + drag", "Pan the board"],
                ["Pinch, or Ctrl + scroll", "Zoom"],
                ["⇧⌘E", "Export image"],
              ]}
            />
          </Section>

          <Section id="tips" title="When it gets it wrong">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-[var(--muted)]">
              <li>Pause for a second before Enter: the draft often corrects itself once the AI has read the whole sentence.</li>
              <li>If a name is off, rename it (click its tag) rather than recreating it.</li>
              <li>If something landed in the wrong place, say where it goes, or drag it.</li>
              <li>Point at elements with @ when there are several with similar names.</li>
              <li>Split a long description into steps; each Enter is one idea.</li>
            </ul>
          </Section>

          <footer className="mt-16 border-t border-[var(--hairline)] pt-6 text-[13px] text-[var(--muted)]">
            Inspired by{" "}
            <a href="https://github.com/anishfn/shapeshift" target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Shapeshift
            </a>
            . Built for ShellHacks 2026.
          </footer>
        </main>
      </div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-20">
      <h2 className="mb-3 text-[22px] font-semibold tracking-tight text-[var(--ink)]">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 text-[16px] font-semibold tracking-tight text-[var(--ink)]">{children}</h3>
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((x, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink)]/[0.06] text-[12px] font-medium tabular-nums text-[var(--ink)]">
            {i + 1}
          </span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  )
}

function Dl({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map(([t, d]) => (
        <div key={t} className="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-4">
          <dt className="font-medium text-[var(--ink)]">{t}</dt>
          <dd>{d}</dd>
        </div>
      ))}
    </dl>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-[var(--ink)]/[0.04] px-4 py-3 text-[14px] leading-6">{children}</p>
}

function Table({ head, rows }: { head: [string, string]; rows: Array<[string, string]> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--hairline)]">
      <table className="w-full text-left text-[14px]">
        <thead className="bg-[var(--ink)]/[0.03] text-[12px] uppercase tracking-wider text-[var(--muted)]">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--hairline)]">
          {rows.map(([a, b]) => (
            <tr key={a + b}>
              <td className="px-4 py-2 align-top">{a}</td>
              <td className="px-4 py-2 align-top text-[var(--ink)]">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-[var(--hairline)] bg-[var(--panel)] px-1.5 py-0.5 font-sans text-[12px] text-[var(--ink)] shadow-[0_1px_0_var(--hairline)]">
      {children}
    </kbd>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-[var(--ink)]/[0.06] px-1.5 py-0.5 text-[13px] text-[var(--ink)]">{children}</code>
}

/** An inline example prompt. */
function Prompt({ children }: { children: string }) {
  return <span className="font-medium text-[var(--ink)]">"{children}"</span>
}

/** Example prompts, one per line; click to copy. */
function Prompts({ items }: { items: string[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <ul className="flex flex-col gap-1.5">
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
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--panel)] px-4 py-2.5 text-left text-[14px] text-[var(--ink)] transition hover:border-[var(--ink)]/20"
          >
            <span>{x}</span>
            <span className="shrink-0 text-[12px] text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
              {copied === x ? "Copied" : "Copy"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
