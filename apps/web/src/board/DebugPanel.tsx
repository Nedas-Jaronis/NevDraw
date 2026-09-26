import type { PieceDebug } from "@rtw/shared"

/** ?debug=1: how each piece of your draft was classified, and by what. */
export function DebugPanel({ pieces }: { pieces: readonly PieceDebug[] }) {
  return (
    <div
      data-ui
      className="absolute bottom-3 right-3 z-40 hidden w-80 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-3 font-mono text-[11px] shadow-sm sm:block"
    >
      <div className="mb-2 text-[var(--muted)]">pieces · type · confidence · source</div>
      {pieces.length === 0 && <div className="text-[var(--muted)]">Start typing…</div>}
      {pieces.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="min-w-0 flex-1 truncate">{p.text}</span>
          <span>{p.type}</span>
          <span className="w-8 text-right tabular-nums text-[var(--muted)]">{p.confidence.toFixed(2)}</span>
          <span
            className={`w-8 rounded px-1 text-center ${p.source === "jev" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-black/5 text-[var(--muted)] dark:bg-white/10"}`}
          >
            {p.source === "jev" ? "jev" : "kw"}
          </span>
        </div>
      ))}
    </div>
  )
}
