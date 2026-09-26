import type { BoardNode } from "@rtw/shared"
import { Title } from "./NodeView.tsx"

const bar = "rounded-full bg-[var(--ink)]/10"

/**
 * Quiet, low-fidelity sketches for leaf elements: just enough shape to read
 * as the thing it is. #12 swaps in richer renderers.
 */
export function Wire({ node, showAuthor }: { node: BoardNode; showAuthor: boolean }) {
  return (
    <div>
      <Title node={node} showAuthor={showAuthor} />
      <div className="mt-2">{sketch(node)}</div>
    </div>
  )
}

function sketch(node: BoardNode) {
  switch (node.type) {
    case "navbar":
      return (
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-[var(--ink)]/15" />
          <div className="ml-auto flex gap-1.5">
            <div className={`h-1.5 w-6 ${bar}`} />
            <div className={`h-1.5 w-6 ${bar}`} />
            <div className={`h-1.5 w-6 ${bar}`} />
          </div>
        </div>
      )
    case "hero":
      return (
        <div className="flex flex-col items-center gap-1.5 py-2">
          <div className={`h-2.5 w-3/4 ${bar}`} />
          <div className={`h-1.5 w-1/2 ${bar}`} />
          <div className="mt-1 h-4 w-16 rounded-full bg-[var(--ink)]/80" />
        </div>
      )
    case "button":
      return <div className="h-6 w-24 rounded-full bg-[var(--ink)]/80" />
    case "input":
      return <div className="h-6 rounded-md border border-[var(--ink)]/15 bg-[var(--panel)]" />
    case "image":
      return (
        <svg viewBox="0 0 100 50" className="h-14 w-full rounded-md bg-[var(--ink)]/5" preserveAspectRatio="none" aria-hidden>
          <path d="M0 0 L100 50 M100 0 L0 50" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
      )
    case "table":
      return (
        <div className="overflow-hidden rounded-md border border-[var(--ink)]/10">
          {[0, 1, 2].map((r) => (
            <div key={r} className={`grid grid-cols-3 gap-2 px-2 py-1.5 ${r === 0 ? "bg-[var(--ink)]/5" : "border-t border-[var(--ink)]/10"}`}>
              <div className={`h-1.5 ${bar}`} />
              <div className={`h-1.5 ${bar}`} />
              <div className={`h-1.5 ${bar}`} />
            </div>
          ))}
        </div>
      )
    case "list":
      return (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]/20" />
              <div className={`h-1.5 flex-1 ${bar}`} />
            </div>
          ))}
        </div>
      )
    case "text":
      return (
        <div className="flex flex-col gap-1.5">
          <div className={`h-1.5 w-full ${bar}`} />
          <div className={`h-1.5 w-4/5 ${bar}`} />
        </div>
      )
    case "client":
    case "service":
    case "database":
    case "cache":
    case "queue":
    case "storage":
    case "external-api":
      return null
    default:
      return (
        <div className="flex flex-col gap-1.5">
          <div className={`h-1.5 w-4/5 ${bar}`} />
          <div className={`h-1.5 w-3/5 ${bar}`} />
        </div>
      )
  }
}
