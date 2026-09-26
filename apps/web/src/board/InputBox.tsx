import { useMemo, useRef, useState } from "react"
import { activeMention, type HandleOption, insertMention, matchHandles, referencedHandles } from "./mentions.ts"

/**
 * This user's input. Every change is sent (the server turns it into a draft
 * everyone sees); Enter commits, Esc discards. Typing "@" offers the board's
 * elements; referenced ones show as chips that highlight their element.
 */
export function InputBox(props: {
  color: string
  handles: readonly HandleOption[]
  onChange: (text: string) => void
  onCommit: () => void
  onDiscard: () => void
  onHighlight: (handle: string | null) => void
}) {
  const [text, setText] = useState("")
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const mention = activeMention(text, caret)
  const matches = useMemo(() => (mention ? matchHandles(mention.query, props.handles) : []), [mention?.query, props.handles])
  const open = mention !== null && matches.length > 0 && dismissed !== mention.start
  const known = useMemo(() => new Set(props.handles.map((h) => h.handle)), [props.handles])
  const refs = referencedHandles(text, known)
  const byHandle = useMemo(() => new Map(props.handles.map((h) => [h.handle, h])), [props.handles])

  const update = (next: string, nextCaret: number) => {
    setText(next)
    setCaret(nextCaret)
    setActive(0)
    props.onChange(next)
  }

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
          <input
            ref={inputRef}
            id="board-input"
            aria-label="Describe what to add to the board"
            aria-autocomplete="list"
            aria-expanded={open}
            value={text}
            autoFocus
            autoComplete="off"
            placeholder="Describe a page, a component or a service…"
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
              if (e.key === "Enter" && text.trim()) {
                e.preventDefault()
                props.onCommit()
                update("", 0)
                props.onHighlight(null)
              } else if (e.key === "Escape") {
                e.preventDefault()
                props.onDiscard()
                update("", 0)
                props.onHighlight(null)
              }
            }}
          />
          <div className="flex min-h-7 items-center gap-3 border-t border-[var(--panel-border)] px-4 py-1.5 text-[11px] text-[var(--muted)]">
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
