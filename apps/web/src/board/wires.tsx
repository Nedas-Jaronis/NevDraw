import type { BoardNode } from "@rtw/shared"
import { Title } from "./NodeView.tsx"
import { durationDisplay, statValue } from "./values.ts"

const bar = "rounded-full bg-[var(--ink)]/10"
const solid = "bg-[var(--ink)]/80"
const field = "rounded-md border border-[var(--ink)]/15 bg-[var(--panel)]"

/**
 * Quiet, low-fidelity sketches for leaf elements: just enough shape to read
 * as the real UI component, with values (durations, numbers) computed from
 * the label.
 */
export function Wire({ node, showAuthor, compact }: { node: BoardNode; showAuthor: boolean; compact?: boolean }) {
  const body = sketch(node)
  return (
    <div>
      <Title node={node} showAuthor={showAuthor} compact={compact} />
      {body && <div className="mt-2">{body}</div>}
    </div>
  )
}

function Pill({ children, filled }: { children: string; filled?: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
        filled ? "bg-[var(--ink)]/85 text-[var(--panel)]" : "border border-[var(--ink)]/20 text-[var(--muted)]"
      }`}
    >
      {children}
    </span>
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
          <div className={`mt-1 h-4 w-16 rounded-full ${solid}`} />
        </div>
      )
    case "button":
      return <div className={`h-6 w-24 rounded-full ${solid}`} />
    case "input":
      return <div className={`h-6 ${field}`} />
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

    // ── Widgets ────────────────────────────────────────────────────────────
    case "timer": {
      const time = durationDisplay(node.label) ?? "05:00"
      return (
        <div className="flex flex-col items-center gap-2 py-1">
          <div className="font-mono text-3xl font-light tabular-nums tracking-tight">{time}</div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--ink)]/10">
            <div className="h-full w-full rounded-full bg-[var(--ink)]/40" />
          </div>
          <div className="flex gap-1.5">
            <Pill>Reset</Pill>
            <Pill filled>Start</Pill>
          </div>
        </div>
      )
    }
    case "stopwatch":
      return (
        <div className="flex flex-col items-center gap-2 py-1">
          <div className="font-mono text-3xl font-light tabular-nums tracking-tight">
            00:00<span className="text-lg text-[var(--muted)]">.00</span>
          </div>
          <div className="flex gap-1.5">
            <Pill>Lap</Pill>
            <Pill filled>Start</Pill>
          </div>
        </div>
      )
    case "chart": {
      const l = node.label.toLowerCase()
      if (/\bpie|donut|doughnut\b/.test(l))
        return (
          <svg viewBox="0 0 42 42" className="mx-auto h-16 w-16" aria-hidden>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="6" />
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="6" strokeDasharray="62 38" transform="rotate(-90 21 21)" />
          </svg>
        )
      if (/\bbar|column|histogram\b/.test(l))
        return (
          <div className="flex h-16 items-end gap-1.5 border-b border-[var(--ink)]/15 px-1">
            {[40, 70, 55, 90, 65, 80].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-[var(--ink)]/25" style={{ height: `${h}%` }} />
            ))}
          </div>
        )
      return (
        <svg viewBox="0 0 100 40" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
          <path d="M0 40 L100 40" stroke="currentColor" strokeOpacity="0.15" vectorEffect="non-scaling-stroke" />
          <path d="M0 32 L15 26 L30 29 L45 18 L60 21 L75 10 L100 6" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      )
    }
    case "calendar":
      return (
        <div>
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[8px] text-[var(--muted)]">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: 28 }, (_, i) => (
              <div key={i} className={`h-3.5 rounded-sm ${i === 17 ? "bg-[var(--ink)]/70" : "bg-[var(--ink)]/[0.06]"}`} />
            ))}
          </div>
        </div>
      )
    case "map":
      return (
        <svg viewBox="0 0 100 50" className="h-16 w-full rounded-md bg-[var(--ink)]/[0.05]" preserveAspectRatio="none" aria-hidden>
          <path d="M-5 38 C 25 30, 40 44, 60 26 S 90 12, 105 18" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="5" vectorEffect="non-scaling-stroke" />
          <path d="M30 -5 L42 55 M70 -5 L62 55" stroke="currentColor" strokeOpacity="0.1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <circle cx="58" cy="24" r="3.5" fill="currentColor" fillOpacity="0.7" />
        </svg>
      )
    case "video":
      return (
        <div>
          <div className="flex aspect-video items-center justify-center rounded-md bg-[var(--ink)]/[0.08]">
            <svg viewBox="0 0 10 10" className="h-5 w-5" aria-hidden>
              <path d="M3 2 L8 5 L3 8 Z" fill="currentColor" fillOpacity="0.6" />
            </svg>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-[var(--ink)]/10">
            <div className="h-full w-1/3 rounded-full bg-[var(--ink)]/50" />
          </div>
        </div>
      )
    case "chat":
      return (
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-3/5 rounded-xl rounded-bl-sm bg-[var(--ink)]/10" />
          <div className="ml-auto h-4 w-1/2 rounded-xl rounded-br-sm bg-[var(--ink)]/60" />
          <div className="h-4 w-2/5 rounded-xl rounded-bl-sm bg-[var(--ink)]/10" />
        </div>
      )
    case "tabs":
      return (
        <div className="flex gap-3 border-b border-[var(--ink)]/10 pb-1.5 text-[10px]">
          <span className="relative font-medium">
            Overview
            <span className="absolute -bottom-[7px] left-0 right-0 h-0.5 rounded-full bg-[var(--ink)]/70" />
          </span>
          <span className="text-[var(--muted)]">Activity</span>
          <span className="text-[var(--muted)]">Settings</span>
        </div>
      )
    case "select":
      return (
        <div className={`flex h-7 items-center justify-between px-2 ${field}`}>
          <div className={`h-1.5 w-1/3 ${bar}`} />
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 opacity-50" aria-hidden>
            <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      )
    case "toggle":
      return (
        <div className="flex items-center justify-between">
          <div className={`h-1.5 w-1/2 ${bar}`} />
          <div className="flex h-4 w-7 items-center justify-end rounded-full bg-[var(--ink)]/70 p-0.5">
            <div className="h-3 w-3 rounded-full bg-[var(--panel)]" />
          </div>
        </div>
      )
    case "slider":
      return (
        <div className="relative flex h-4 items-center">
          <div className="h-1 w-full rounded-full bg-[var(--ink)]/10" />
          <div className="absolute h-1 w-3/5 rounded-full bg-[var(--ink)]/60" />
          <div className="absolute left-[60%] h-3.5 w-3.5 -translate-x-1/2 rounded-full border border-[var(--ink)]/20 bg-[var(--panel)] shadow-sm" />
        </div>
      )
    case "progress":
      return (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ink)]/10">
          <div className="h-full w-3/5 rounded-full bg-[var(--ink)]/60" />
        </div>
      )
    case "avatar":
      return (
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-[var(--ink)]/15" />
          <div className="flex flex-1 flex-col gap-1">
            <div className={`h-1.5 w-1/2 ${bar}`} />
            <div className={`h-1.5 w-1/3 ${bar}`} />
          </div>
        </div>
      )
    case "search":
      return (
        <div className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 ${field}`}>
          <svg viewBox="0 0 12 12" className="h-3 w-3 opacity-50" aria-hidden>
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.6 7.6 L11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <div className={`h-1.5 w-1/3 ${bar}`} />
        </div>
      )
    case "stat":
      return (
        <div>
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{statValue(node.label) ?? "1,284"}</div>
          <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">▲ 12% this week</div>
        </div>
      )

    // Architecture nodes are just their name.
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
