import { useState } from "react"

/**
 * This user's input. Every change is sent (the server turns it into a draft
 * everyone sees); Enter commits, Esc discards.
 */
export function InputBox(props: {
  color: string
  onChange: (text: string) => void
  onCommit: () => void
  onDiscard: () => void
}) {
  const [text, setText] = useState("")
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div
        data-ui
        className="pointer-events-auto w-full max-w-xl rounded-2xl bg-[var(--panel)] shadow-lg"
        style={{ border: `2px solid ${props.color}` }}
      >
        <input
          id="board-input"
          aria-label="Describe what to add to the board"
          value={text}
          autoFocus
          placeholder="Describe a page, a component or a service…"
          className="w-full bg-transparent px-4 py-3 text-base outline-none placeholder:text-[var(--muted)]"
          onChange={(e) => {
            setText(e.target.value)
            props.onChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault()
              props.onCommit()
              setText("")
            } else if (e.key === "Escape") {
              e.preventDefault()
              props.onDiscard()
              setText("")
            }
          }}
        />
        <div className="flex gap-3 border-t border-[var(--panel-border)] px-4 py-1.5 text-[11px] text-[var(--muted)]">
          <span>
            <kbd className="font-sans font-semibold">Enter</kbd> commit
          </span>
          <span>
            <kbd className="font-sans font-semibold">Esc</kbd> discard
          </span>
        </div>
      </div>
    </div>
  )
}
