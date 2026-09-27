import { useEffect, useMemo, useRef, useState } from "react"
import {
  acceptSuggestion,
  activeMention,
  type HandleOption,
  insertMention,
  matchHandles,
  referencedHandles,
} from "./mentions.ts"

/**
 * This user's input. Every change is sent (the server turns it into a draft
 * everyone sees); Enter commits, Esc discards. Typing "@" offers the board's
 * elements; referenced ones show as chips that highlight their element.
 */
export function InputBox(props: {
  color: string
  handles: readonly HandleOption[]
  /** "link to @x?" chips for this input (Tab / → accepts the first). */
  suggestions: readonly { text: string; handle: string }[]
  onChange: (text: string) => void
  onCommit: () => void
  onDiscard: () => void
  onHighlight: (handle: string | null) => void
  /** The clicked element and its ancestors (outermost first); empty when nothing is targeted. */
  target: ReadonlyArray<{ id: string; label: string }>
  onTarget: (id: string | null) => void
  /** Which version of this person's draft is showing (step back and forth before Enter). */
  history?: { at: number; total: number; source: string }
  onStep: (delta: -1 | 1) => void
}) {
  const [text, setText] = useState("")
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const aimed = props.target.at(-1)
  // An edit belongs to the element it was typed for: clicking off (or onto another element)
  // resets it, so a half-written "change to a clock" never lingers or lands somewhere else.
  const lastTarget = useRef(aimed?.id)
  useEffect(() => {
    if (lastTarget.current === aimed?.id) return
    const was = lastTarget.current
    lastTarget.current = aimed?.id
    if (!text.trim()) return
    if (was !== undefined) {
      props.onDiscard()
      update("", 0)
      props.onHighlight(null)
    } else props.onChange(text) // typed first, then picked what it's for: read it against that element

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aimed?.id])

  const mention = activeMention(text, caret)
  const matches = useMemo(() => (mention ? matchHandles(mention.query, props.handles) : []), [mention?.query, props.handles])
  const known = useMemo(() => new Set(props.handles.map((h) => h.handle)), [props.handles])
  // A token that already names a handle exactly is complete: no need to offer it again.
  const open =
    mention !== null && matches.length > 0 && dismissed !== mention.start && !known.has(`@${mention.query}`)
  const refs = referencedHandles(text, known)
  const byHandle = useMemo(() => new Map(props.handles.map((h) => [h.handle, h])), [props.handles])

  const update = (next: string, nextCaret: number) => {
    setText(next)
    setCaret(nextCaret)
    setActive(0)
    props.onChange(next)
  }

  const accept = (sug: { text: string; handle: string }) => {
    const next = acceptSuggestion(text, sug)
    if (next === text) return
    update(next, next.length)
    props.onHighlight(null)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.length, next.length))
  }
  const chips = open ? [] : props.suggestions.filter((x) => !text.toLowerCase().includes(x.handle))

  const choose = (o: HandleOption) => {
    if (!mention) return
    const r = insertMention(text, caret, mention.start, o.handle)
    update(r.text, r.caret)
    props.onHighlight(null)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(r.caret, r.caret))
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div data-ui className="pointer-events-auto relative w-full max-w-xl">
        {chips.length > 0 && (
          <div className="absolute inset-x-0 bottom-full mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Link suggestions">
            {chips.map((c, i) => (
              <button
                key={c.handle}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  accept(c)
                }}
                onPointerEnter={() => props.onHighlight(c.handle)}
                onPointerLeave={() => props.onHighlight(null)}
                className="flex items-center gap-1.5 rounded-full border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-1 text-xs shadow-sm hover:border-[var(--ink)]/30"
              >
                <span className="text-[var(--muted)]">link to</span>
                <span className="font-medium">{c.handle}</span>
                {i === 0 && <kbd className="ml-1 rounded bg-black/5 px-1 font-sans text-[10px] text-[var(--muted)] dark:bg-white/10">Tab</kbd>}
              </button>
            ))}
          </div>
        )}
        {open && (
          <ul
            role="listbox"
            aria-label="Board elements"
            className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] py-1 shadow-lg"
          >
            {matches.map((o, i) => (
              <li
                key={o.handle}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => {
                  e.preventDefault()
                  choose(o)
                }}
                onPointerEnter={() => {
                  setActive(i)
                  props.onHighlight(o.handle)
                }}
                onPointerLeave={() => props.onHighlight(null)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? "bg-black/5 dark:bg-white/10" : ""}`}
              >
                <span className="font-medium">{o.handle}</span>
                <span className="truncate text-[var(--muted)]">{o.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--muted)]">{o.type}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-2xl bg-[var(--panel)] shadow-lg" style={{ border: `2px solid ${props.color}` }}>
          {aimed && (
            <div className="flex items-center gap-1 border-b border-[var(--panel-border)] px-4 py-1.5 text-[12px]">
              <span className="mr-1 text-[var(--muted)]">Editing</span>
              {props.target.map((t, i) => (
                <span key={t.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[var(--muted)]">›</span>}
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => props.onTarget(t.id)}
                    title={i < props.target.length - 1 ? `Edit ${t.label} instead` : undefined}
                    className={`max-w-40 truncate rounded-md px-1.5 py-0.5 transition ${
                      t.id === aimed.id ? "font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
                    }`}
                    style={t.id === aimed.id ? { background: `color-mix(in srgb, ${props.color} 14%, transparent)` } : undefined}
                  >
                    {t.label}
                  </button>
                </span>
              ))}
              <button
                type="button"
                aria-label="Stop editing this element"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => props.onTarget(null)}
                className="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
              >
                ✕
              </button>
            </div>
          )}
          <input
            ref={inputRef}
            id="board-input"
            aria-label="Describe what to add to the board"
            aria-autocomplete="list"
            aria-expanded={open}
            value={text}
            autoFocus
            autoComplete="off"
            placeholder={aimed ? `Edit ${aimed.label}: add, remove, change or move…` : "Describe a page, a component or a service…"}
            className="w-full bg-transparent px-4 py-3 text-base outline-none placeholder:text-[var(--muted)]"
            onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (open) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault()
                  const next = (active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length
                  setActive(next)
                  props.onHighlight(matches[next]!.handle)
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault()
                  choose(matches[active] ?? matches[0]!)
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setDismissed(mention.start)
                  props.onHighlight(null)
                  return
                }
              }
              const atEnd = (e.currentTarget.selectionStart ?? 0) === text.length
              if (chips.length > 0 && (e.key === "Tab" || (e.key === "ArrowRight" && atEnd))) {
                e.preventDefault()
                accept(chips[0]!)
                return
              }
              // ⌥← / ⌥→ step through the draft's versions.
              if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && props.history && props.history.total > 1) {
                e.preventDefault()
                props.onStep(e.key === "ArrowLeft" ? -1 : 1)
                return
              }
              if (e.key === "Enter" && text.trim()) {
                e.preventDefault()
                props.onCommit()
                update("", 0)
                props.onHighlight(null)
              } else if (e.key === "Escape") {
                e.preventDefault()
                // Nothing typed: Esc stops editing the clicked element.
                if (!text.trim() && aimed) props.onTarget(null)
                props.onDiscard()
                update("", 0)
                props.onHighlight(null)
              }
            }}
          />
          <div className="flex min-h-7 items-center gap-3 border-t border-[var(--panel-border)] px-4 py-1.5 text-[11px] text-[var(--muted)]">
            {props.history && props.history.total > 1 && text.trim() && (
              <div className="order-last ml-auto flex items-center gap-1" aria-label="Draft versions">
                <button
                  type="button"
                  aria-label="Previous version (⌥←)"
                  title="Previous version (⌥←)"
                  disabled={props.history.at <= 1}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => props.onStep(-1)}
                  className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-[var(--ink)]/5 hover:text-[var(--ink)] disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="tabular-nums text-[var(--ink)]">
                  {props.history.at}/{props.history.total}
                </span>
                <span>· {props.history.source}</span>
                <button
                  type="button"
                  aria-label="Next version (⌥→)"
                  title="Next version (⌥→)"
                  disabled={props.history.at >= props.history.total}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => props.onStep(1)}
                  className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-[var(--ink)]/5 hover:text-[var(--ink)] disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
            {refs.length > 0 ? (
              refs.map((h) => (
                <span
                  key={h}
                  onPointerEnter={() => props.onHighlight(h)}
                  onPointerLeave={() => props.onHighlight(null)}
                  className="cursor-default rounded-full bg-black/5 px-2 py-0.5 text-[var(--ink)] dark:bg-white/10"
                  title={byHandle.get(h)?.label}
                >
                  {h}
                </span>
              ))
            ) : (
              <>
                <span>
                  <kbd className="font-sans font-semibold">Enter</kbd> commit
                </span>
                <span>
                  <kbd className="font-sans font-semibold">Esc</kbd> discard
                </span>
                <span>
                  <kbd className="font-sans font-semibold">@</kbd> reference
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
