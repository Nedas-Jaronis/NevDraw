import type { BoardNode } from "@rtw/shared"
import { motion } from "motion/react"

export const NODE_WIDTH = 240

/**
 * One board element. Drafts render dashed in the author's color; committed
 * nodes are solid with an author dot. The same id is kept across the
 * draft → committed transition so Motion animates it in place.
 */
export function NodeView({ node, draft, typing }: { node: BoardNode; draft: boolean; typing?: string | undefined }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, x: node.x, y: node.y }}
      animate={{ opacity: draft ? 0.85 : 1, scale: 1, x: node.x, y: node.y }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="absolute left-0 top-0"
      style={{ width: NODE_WIDTH }}
    >
      {typing && (
        <div className="pointer-events-none absolute -top-7 left-0 max-w-[320px] truncate text-xs" style={{ color: node.authorColor }}>
          {typing}
        </div>
      )}
      <div
        className="relative rounded-xl bg-[var(--panel)] p-3 shadow-sm"
        style={{
          border: `2px ${draft ? "dashed" : "solid"} ${draft ? node.authorColor : "var(--panel-border)"}`,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)] dark:bg-white/10">
            {node.type}
          </span>
          {!draft && <span className="ml-auto h-2 w-2 rounded-full" style={{ background: node.authorColor }} title="Author" />}
        </div>
        <div className="mt-2 font-medium leading-snug">{node.label}</div>
        <div className="mt-2 space-y-1.5" aria-hidden>
          <div className="h-1.5 w-4/5 rounded bg-black/10 dark:bg-white/10" />
          <div className="h-1.5 w-3/5 rounded bg-black/10 dark:bg-white/10" />
        </div>
      </div>
    </motion.div>
  )
}
