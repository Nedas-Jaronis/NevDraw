import { type BoardNode, type NodeType, parseColor, REGISTRY } from "@rtw/shared"
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"
import { ImageSlot } from "./images.tsx"
import { Title } from "./NodeView.tsx"
import { amount, clock, durationSeconds, onColor, progressOf, route, statValue } from "./values.ts"

/**
 * The component library: small, working versions of real UI components,
 * after Shapeshift's cards (github.com/anishfn/shapeshift). Each is tinted
 * by the element's accent (`--a`, from the prompt) and the interactive ones
 * work: timers run, checklists check, polls vote, tabs and toggles switch.
 * Interactive controls carry `data-ui` so clicking them never drags the element.
 */
export function Wire({ node, showAuthor, compact, draft }: { node: BoardNode; showAuthor: boolean; compact?: boolean; draft?: boolean }) {
  const body = <Sketch node={node} editable={!draft} />
  const accent = node.props.color
  return (
    <div style={{ "--a": accent ?? "var(--accent-default)", "--on-a": onColor(accent) } as CSSProperties}>
      <Title node={node} showAuthor={showAuthor} compact={compact} />
      {body && <div className="mt-2">{body}</div>}
    </div>
  )
}

// ── shared bits ─────────────────────────────────────────────────────────────

const bar = "rounded-full bg-[var(--ink)]/10"
const field = "rounded-lg border border-[var(--ink)]/15 bg-[var(--panel)]"

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-full bg-[var(--ink)]/[0.06] px-2 text-[10px] font-medium">{children}</span>
}

function Btn({ children, filled, onClick, label }: { children: ReactNode; filled?: boolean; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      data-ui
      aria-label={label}
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition active:scale-95 ${
        filled ? "bg-[var(--a)] text-[var(--on-a)]" : "border border-[var(--ink)]/20 text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  )
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ink)]/10">
      <div className="h-full rounded-full bg-[var(--a)] transition-[width] duration-300" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

const placeholderItems = (n = 3) => Array.from({ length: n }, (_, i) => `Item ${i + 1}`)

// ── functional timer (Shapeshift's TimerRing, scaled down) ──────────────────

function useClock(total: number | null) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(0)
  const base = useRef(0)
  useEffect(() => {
    if (!running) return
    started.current = performance.now()
    base.current = elapsed
    const id = setInterval(() => {
      const e = base.current + (performance.now() - started.current) / 1000
      setElapsed(total ? Math.min(total, e) : e)
      if (total && e >= total) setRunning(false)
    }, 200)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only (re)start on toggle
  }, [running])
  return {
    running,
    elapsed,
    toggle: () => setRunning((r) => !r),
    reset: () => {
      setRunning(false)
      setElapsed(0)
    },
  }
}

function Ring({ progress, size, children }: { progress: number; size: number; children?: ReactNode }) {
  const stroke = size > 40 ? 3 : 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--a)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
          style={{ transition: "stroke-dashoffset 200ms linear" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

function Timer({ seconds, stopwatch, size = "big" }: { seconds: number | null; stopwatch?: boolean; size?: "big" | "row" }) {
  const total = stopwatch ? null : (seconds ?? 300)
  const t = useClock(total)
  const shown = total ? total - t.elapsed : t.elapsed
  const progress = total ? 1 - t.elapsed / total : (t.elapsed % 60) / 60
  if (size === "row")
    return (
      <div className="flex items-center gap-2">
        <Ring progress={total ? progress : t.running ? progress : 0} size={26} />
        <span className="font-mono text-sm tabular-nums">{clock(shown)}</span>
        <div className="ml-auto flex gap-1">
          <Btn filled onClick={t.toggle} label={t.running ? "Pause" : "Start"}>
            {t.running ? "Pause" : "Start"}
          </Btn>
        </div>
      </div>
    )
  return (
    <div className="flex items-center gap-3">
      <Ring progress={total ? progress : t.running ? progress : 0} size={76}>
        <span className="font-mono text-[15px] font-medium tabular-nums">{clock(shown)}</span>
      </Ring>
      <div className="flex flex-col gap-1.5">
        <Btn filled onClick={t.toggle}>
          {t.running ? "Pause" : t.elapsed > 0 ? "Resume" : "Start"}
        </Btn>
        <Btn onClick={t.reset}>{stopwatch ? "Lap" : "Reset"}</Btn>
      </div>
    </div>
  )
}

// ── collections: rows rendered as their item widget ─────────────────────────

function ItemRow({ of, item, index }: { of: NodeType | undefined; item: string; index: number }) {
  const [done, setDone] = useState(false)
  switch (of) {
    case "timer":
    case "countdown":
    case "reminder":
      return <Timer seconds={durationSeconds(item) ?? (index + 1) * 300} size="row" />
    case "stopwatch":
      return <Timer seconds={null} stopwatch size="row" />
    case "checklist":
    case "input":
      return (
        <label data-ui className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="accent-[var(--a)]" />
          <span className={done ? "text-[var(--muted)] line-through" : ""}>{item}</span>
        </label>
      )
    case "button":
      return (
        <div className="flex items-center justify-between text-xs">
          <span>{item}</span>
          <Btn filled>Open</Btn>
        </div>
      )
    case "avatar":
    case "contact":
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--a)] text-[9px] font-semibold text-[var(--on-a)]">{item.slice(0, 1)}</span>
          {item}
        </div>
      )
    case "stat":
    case "expense":
      return (
        <div className="flex items-center justify-between text-xs">
          <span>{item.replace(/[$€£]?\d[\d,.]*/, "").trim() || `Row ${index + 1}`}</span>
          <span className="font-medium tabular-nums">{amount(item) ?? statValue(item) ?? `$${(index + 1) * 120}`}</span>
        </div>
      )
    default: {
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--a)]" />
          <span className="truncate">{item}</span>
          {of && of !== "box" && <span className="ml-auto text-[9px] uppercase tracking-wider text-[var(--muted)]">{of}</span>}
        </div>
      )
    }
  }
}

function Collection({ node, table }: { node: BoardNode; table: boolean }) {
  const items = node.props.items?.length ? node.props.items : placeholderItems()
  const of = node.props.of
  if (!table)
    return (
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <ItemRow key={`${i}-${it}`} of={of} item={it} index={i} />
        ))}
      </div>
    )
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--ink)]/10">
      <div className="flex items-center justify-between bg-[var(--a)]/10 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        <span>{of ? REGISTRY[of] && of.replace("-", " ") : "Name"}</span>
        <span>{of === "timer" ? "Duration" : "Value"}</span>
      </div>
      {items.map((it, i) => (
        <div key={`${i}-${it}`} className="border-t border-[var(--ink)]/10 px-2.5 py-1.5">
          <ItemRow of={of} item={it} index={i} />
        </div>
      ))}
    </div>
  )
}

// ── the widgets ─────────────────────────────────────────────────────────────

function Checklist({ items }: { items: readonly string[] }) {
  const [done, setDone] = useState<Record<number, boolean>>({})
  return (
    <ul className="flex flex-col">
      {items.map((it, i) => (
        <li key={`${i}-${it}`} className="flex items-center gap-2 border-b border-[var(--ink)]/10 py-1.5 last:border-b-0">
          <label data-ui className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={Boolean(done[i])}
              onChange={(e) => setDone((d) => ({ ...d, [i]: e.target.checked }))}
              className="h-3.5 w-3.5 accent-[var(--a)]"
            />
            <span className={done[i] ? "text-[var(--muted)] line-through" : ""}>{it}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

function Poll({ options }: { options: readonly string[] }) {
  const [votes, setVotes] = useState<number[]>(() => options.map(() => 0))
  const total = votes.reduce((a, b) => a + b, 0)
  return (
    <div className="flex flex-col gap-2">
      {options.map((o, i) => {
        const pct = total ? Math.round(((votes[i] ?? 0) / total) * 100) : 0
        return (
          <button
            key={`${i}-${o}`}
            type="button"
            data-ui
            onClick={() => setVotes((v) => v.map((x, j) => (j === i ? x + 1 : x)))}
            className="flex flex-col gap-1 text-left"
          >
            <div className="flex w-full items-center justify-between text-xs">
              <span>{o}</span>
              <span className="text-[10px] tabular-nums text-[var(--muted)]">{pct}%</span>
            </div>
            <Bar value={pct / 100} />
          </button>
        )
      })}
    </div>
  )
}

function Tabs({ tabs }: { tabs: readonly string[] }) {
  const [on, setOn] = useState(0)
  return (
    <div className="flex gap-3 border-b border-[var(--ink)]/10 text-[11px]">
      {tabs.map((t, i) => (
        <button
          key={`${i}-${t}`}
          type="button"
          data-ui
          onClick={() => setOn(i)}
          className={`-mb-px border-b-2 pb-1.5 ${i === on ? "border-[var(--a)] font-medium" : "border-transparent text-[var(--muted)]"}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label }: { label: string }) {
  const [on, setOn] = useState(true)
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="truncate">{label}</span>
      <button
        type="button"
        data-ui
        role="switch"
        aria-checked={on}
        onClick={() => setOn((v) => !v)}
        className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${on ? "justify-end bg-[var(--a)]" : "justify-start bg-[var(--ink)]/20"}`}
      >
        <span className="h-3 w-3 rounded-full bg-[var(--panel)] shadow-sm" />
      </button>
    </div>
  )
}

function Habit() {
  const [days, setDays] = useState([true, true, false, true, false, false, false])
  return (
    <div className="flex justify-between">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
        <button
          key={i}
          type="button"
          data-ui
          onClick={() => setDays((xs) => xs.map((x, j) => (j === i ? !x : x)))}
          className="flex flex-col items-center gap-1 text-[9px] text-[var(--muted)]"
        >
          <span className={`h-5 w-5 rounded-full border ${days[i] ? "border-[var(--a)] bg-[var(--a)]" : "border-[var(--ink)]/20"}`} />
          {d}
        </button>
      ))}
    </div>
  )
}

function LiveClock({ zone }: { zone?: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  let time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  try {
    if (zone) time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })
  } catch {
    // unknown zone: local time
  }
  return <span className="tabular-nums">{time}</span>
}

const ZONES: Record<string, string> = {
  tokyo: "Asia/Tokyo", london: "Europe/London", paris: "Europe/Paris", "new york": "America/New_York", nyc: "America/New_York",
  pst: "America/Los_Angeles", "san francisco": "America/Los_Angeles", la: "America/Los_Angeles", ist: "Asia/Kolkata",
  india: "Asia/Kolkata", sydney: "Australia/Sydney", berlin: "Europe/Berlin", miami: "America/New_York", utc: "UTC",
}

function Sketch({ node, editable }: { node: BoardNode; editable: boolean }) {
  const label = node.label
  const items = node.props.items
  switch (node.type) {
    case "navbar":
      return (
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 rounded-md bg-[var(--a)]" />
          <div className="ml-auto flex gap-2 text-[10px] text-[var(--muted)]">
            {(items?.length ? items : ["Home", "Pricing", "About"]).slice(0, 4).map((x, i) => (
              <span key={`${i}-${x}`}>{x}</span>
            ))}
          </div>
          <Btn filled>Sign in</Btn>
        </div>
      )
    case "hero":
      // Put your own picture behind the headline: Upload / Link, or drop a file on it.
      return (
        <ImageSlot id={node.id} src={node.props.src} editable={editable} className="bg-[var(--a)]/[0.08]">
          <div className={`flex flex-col items-center gap-1.5 py-4 ${node.props.src ? "bg-black/35 text-white" : ""}`}>
            <div className={`h-2.5 w-3/4 rounded-full ${node.props.src ? "bg-white/70" : "bg-[var(--ink)]/10"}`} />
            <div className={`h-1.5 w-1/2 rounded-full ${node.props.src ? "bg-white/50" : "bg-[var(--ink)]/10"}`} />
            <div className="mt-1">
              <Btn filled>Get started</Btn>
            </div>
          </div>
        </ImageSlot>
      )
    case "button":
      return (
        <button type="button" data-ui className="rounded-lg bg-[var(--a)] px-3 py-1.5 text-xs font-medium text-[var(--on-a)] transition active:scale-95">
          {label.replace(/\b(button|btn|cta)\b/gi, "").replace(/\b(a|an|the)\b/gi, "").trim() || "Continue"}
        </button>
      )
    case "input":
      return <input data-ui placeholder={label} className={`h-7 w-full px-2 text-xs outline-none focus:border-[var(--a)] ${field}`} />
    case "search":
      return (
        <div className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 ${field}`}>
          <svg viewBox="0 0 12 12" className="h-3 w-3 opacity-50" aria-hidden>
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.6 7.6 L11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input data-ui placeholder="Search…" className="w-full bg-transparent text-xs outline-none" />
        </div>
      )
    case "image":
      return (
        <ImageSlot id={node.id} src={node.props.src} editable={editable} className="h-24 bg-[var(--a)]/10">
          {!node.props.src && (
            <svg viewBox="0 0 100 50" className="h-24 w-full" preserveAspectRatio="none" aria-hidden>
              <path d="M0 50 L30 22 L50 38 L70 18 L100 50 Z" fill="var(--a)" fillOpacity="0.25" />
              <circle cx="78" cy="12" r="5" fill="var(--a)" fillOpacity="0.35" />
            </svg>
          )}
        </ImageSlot>
      )
    case "table":
      return <Collection node={node} table />
    case "list":
      return <Collection node={node} table={false} />
    case "text":
      return (
        <div className="flex flex-col gap-1.5">
          <div className={`h-1.5 w-full ${bar}`} />
          <div className={`h-1.5 w-4/5 ${bar}`} />
        </div>
      )
    case "timer":
      return <Timer seconds={durationSeconds(label)} />
    case "stopwatch":
      return <Timer seconds={null} stopwatch />
    case "chart": {
      const l = label.toLowerCase()
      if (/\b(pie|donut|doughnut)\b/.test(l))
        return (
          <svg viewBox="0 0 42 42" className="mx-auto h-16 w-16" aria-hidden>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="6" />
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--a)" strokeWidth="6" strokeDasharray="62 38" transform="rotate(-90 21 21)" />
          </svg>
        )
      if (/\b(bar|column|histogram)\b/.test(l))
        return (
          <div className="flex h-16 items-end gap-1.5 border-b border-[var(--ink)]/15 px-1">
            {[40, 70, 55, 90, 65, 80].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-[var(--a)]" style={{ height: `${h}%`, opacity: 0.35 + i * 0.1 }} />
            ))}
          </div>
        )
      return (
        <svg viewBox="0 0 100 40" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
          <path d="M0 32 L15 26 L30 29 L45 18 L60 21 L75 10 L100 6 L100 40 L0 40 Z" fill="var(--a)" fillOpacity="0.1" />
          <path d="M0 32 L15 26 L30 29 L45 18 L60 21 L75 10 L100 6" fill="none" stroke="var(--a)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
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
              <div key={i} className={`grid h-4 place-items-center rounded-sm text-[7px] ${i === 17 ? "bg-[var(--a)] text-[var(--on-a)]" : "bg-[var(--ink)]/[0.05] text-[var(--muted)]"}`}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      )
    case "map":
      return (
        <svg viewBox="0 0 100 50" className="h-16 w-full rounded-md bg-[var(--ink)]/[0.05]" preserveAspectRatio="none" aria-hidden>
          <path d="M-5 38 C 25 30, 40 44, 60 26 S 90 12, 105 18" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="5" vectorEffect="non-scaling-stroke" />
          <path d="M30 -5 L42 55 M70 -5 L62 55" stroke="currentColor" strokeOpacity="0.1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <circle cx="58" cy="24" r="4" fill="var(--a)" />
        </svg>
      )
    case "video":
      return (
        <div>
          <div className="flex aspect-video items-center justify-center rounded-md bg-[var(--ink)]/[0.08]">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--a)]">
              <svg viewBox="0 0 10 10" className="h-3 w-3" aria-hidden>
                <path d="M3 2 L8 5 L3 8 Z" fill="var(--on-a)" />
              </svg>
            </span>
          </div>
          <div className="mt-1.5">
            <Bar value={0.33} />
          </div>
        </div>
      )
    case "chat":
      return (
        <div className="flex flex-col gap-1.5 text-[10px]">
          <div className="w-fit max-w-[75%] rounded-xl rounded-bl-sm bg-[var(--ink)]/[0.07] px-2 py-1">Hey! Is this ready?</div>
          <div className="ml-auto w-fit max-w-[75%] rounded-xl rounded-br-sm bg-[var(--a)] px-2 py-1 text-[var(--on-a)]">Shipping it now 🚀</div>
          <input data-ui placeholder="Message…" className={`mt-0.5 h-6 w-full px-2 text-[10px] outline-none ${field}`} />
        </div>
      )
    case "tabs":
      return <Tabs tabs={items?.length ? items : ["Overview", "Activity", "Settings"]} />
    case "select":
      return (
        <select data-ui className={`h-7 w-full px-2 text-xs outline-none ${field}`} defaultValue="">
          <option value="" disabled>
            {label}
          </option>
          {(items?.length ? items : ["Option A", "Option B", "Option C"]).map((o, i) => (
            <option key={`${i}-${o}`}>{o}</option>
          ))}
        </select>
      )
    case "toggle":
      return <Toggle label={label} />
    case "slider":
      return <input data-ui type="range" defaultValue={60} className="w-full accent-[var(--a)]" aria-label={label} />
    case "progress": {
      const p = progressOf(label) ?? { value: 0.6, text: "60%" }
      return (
        <div className="flex flex-col gap-1">
          <Bar value={p.value} />
          <span className="text-[10px] text-[var(--muted)]">{p.text}</span>
        </div>
      )
    }
    case "avatar":
      return (
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--a)] text-xs font-semibold text-[var(--on-a)]">
            {label.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <div className={`h-1.5 w-1/2 ${bar}`} />
            <div className={`h-1.5 w-1/3 ${bar}`} />
          </div>
        </div>
      )
    case "stat":
      return (
        <div>
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{amount(label) ?? statValue(label) ?? "1,284"}</div>
          <div className="mt-0.5 text-[10px] font-medium text-[var(--a)]">▲ 12% this week</div>
        </div>
      )
    case "event": {
      const r = route(label)
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Chip>📅 Friday</Chip>
            <Chip>🕗 8 PM</Chip>
            {r.to && <Chip>📍 {r.to}</Chip>}
          </div>
          <div className="flex -space-x-1.5">
            {["A", "B", "C"].map((x) => (
              <span key={x} className="grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--panel)] bg-[var(--a)] text-[8px] font-semibold text-[var(--on-a)]">
                {x}
              </span>
            ))}
          </div>
        </div>
      )
    }
    case "checklist":
      return <Checklist items={items?.length ? items : placeholderItems()} />
    case "poll":
      return <Poll options={items?.length ? items : ["Option A", "Option B"]} />
    case "countdown": {
      const n = statValue(label)
      return (
        <div className="flex items-end gap-2">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-[var(--a)]">{n ?? "42"}</span>
          <span className="pb-1 text-xs text-[var(--muted)]">days to go</span>
        </div>
      )
    }
    case "color": {
      const hex = node.props.color ?? parseColor(label).hex ?? "#4c6ef5"
      return (
        <div className="flex items-center gap-2">
          <span className="h-10 w-10 rounded-lg border border-[var(--ink)]/10" style={{ background: hex }} />
          <div className="flex flex-col">
            <span className="font-mono text-xs uppercase">{hex}</span>
            <span className="text-[10px] text-[var(--muted)]">tap to copy</span>
          </div>
        </div>
      )
    }
    case "contact":
      return (
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--a)] text-xs font-semibold text-[var(--on-a)]">
            {label.slice(0, 1).toUpperCase()}
          </span>
          <div className="flex flex-col gap-0.5 text-[10px] text-[var(--muted)]">
            <span>📞 (555) 012-3456</span>
            <span>✉️ hello@example.com</span>
          </div>
        </div>
      )
    case "link":
      return (
        <div className={`flex items-center gap-2 p-1.5 ${field}`}>
          <span className="h-7 w-7 rounded-md bg-[var(--a)]/20" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className={`h-1.5 w-24 ${bar}`} />
            <span className="truncate text-[9px] text-[var(--muted)]">example.com</span>
          </div>
        </div>
      )
    case "habit":
      return <Habit />
    case "goal": {
      const p = progressOf(label) ?? { value: 1 / 3, text: "4 of 12" }
      return (
        <div className="flex items-center gap-3">
          <Ring progress={p.value} size={40}>
            <span className="text-[9px] font-semibold tabular-nums">{Math.round(p.value * 100)}%</span>
          </Ring>
          <span className="text-xs text-[var(--muted)]">{p.text}</span>
        </div>
      )
    }
    case "reminder":
      return (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--a)]/15 px-2.5 py-1 text-[11px]">
          🔔 <span className="truncate">{label.replace(/\b(reminder|remind me( to)?)\b/gi, "").trim() || "Reminder"}</span>
          <span className="text-[var(--muted)]">· Tomorrow</span>
        </div>
      )
    case "expense":
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--a)]/15">💳</span>
          <span className="flex-1 truncate text-[var(--muted)]">Today</span>
          <span className="font-semibold tabular-nums">{amount(label) ?? "$24.00"}</span>
        </div>
      )
    case "travel": {
      const r = route(label)
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">{r.from ?? "Home"}</span>
          <span className="flex-1 border-t border-dashed border-[var(--a)]" />
          <span>✈️</span>
          <span className="flex-1 border-t border-dashed border-[var(--a)]" />
          <span className="font-semibold">{r.to ?? "Trip"}</span>
        </div>
      )
    }
    case "clock": {
      const l = label.toLowerCase()
      const zone = Object.entries(ZONES).find(([k]) => new RegExp(`\\b${k}\\b`).test(l))
      return (
        <div className="flex items-end justify-between">
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-[var(--a)]">
            <LiveClock {...(zone ? { zone: zone[1] } : {})} />
          </div>
          <span className="pb-1 text-[10px] text-[var(--muted)]">{zone ? zone[0].toUpperCase() : "Local"}</span>
        </div>
      )
    }
    case "calculator":
      return (
        <div className="grid grid-cols-4 gap-1">
          {["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "="].map((k) => (
            <span key={k} className={`grid h-5 place-items-center rounded text-[10px] ${/[÷×=]/.test(k) ? "bg-[var(--a)] text-[var(--on-a)]" : "bg-[var(--ink)]/[0.06]"}`}>
              {k}
            </span>
          ))}
        </div>
      )
    case "note":
      return (
        <div className="rounded-md bg-[var(--a)]/15 p-2" style={node.props.color ? undefined : { background: "#fff3bf", color: "#5c4b00" }}>
          <div className="flex flex-col gap-1.5">
            <div className="h-1 w-full rounded-full bg-current opacity-20" />
            <div className="h-1 w-4/5 rounded-full bg-current opacity-20" />
          </div>
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

/** What a form is for, from its name: the fields, button and footer a real one would have. */
const FORM_KINDS: Array<{ test: RegExp; title: string; sub: string; fields: string[]; submit: string; footer?: string }> = [
  { test: /sign\s*up|register|create account|join/i, title: "Create your account", sub: "Start in less than a minute.", fields: ["Full name", "Email", "Password"], submit: "Sign up", footer: "Already have an account? Log in" },
  { test: /log\s*in|sign\s*in|auth/i, title: "Welcome back", sub: "Log in to continue.", fields: ["Email", "Password"], submit: "Log in", footer: "Forgot password?" },
  { test: /contact|message|support|feedback/i, title: "Get in touch", sub: "We usually reply within a day.", fields: ["Name", "Email", "Message"], submit: "Send" },
  { test: /checkout|payment|billing|card/i, title: "Payment", sub: "All transactions are secure.", fields: ["Card number", "Expiry", "CVC"], submit: "Pay now" },
  { test: /newsletter|subscribe|waitlist/i, title: "Stay in the loop", sub: "No spam, unsubscribe anytime.", fields: ["Email"], submit: "Subscribe" },
  { test: /confirm|delete|remove/i, title: "Are you sure?", sub: "This can't be undone.", fields: [], submit: "Confirm" },
]

/**
 * An empty form or modal renders as a finished dialog card: heading, labelled
 * fields and a primary button. Its items (from the prompt) are the fields.
 */
export function FormCard({ node }: { node: BoardNode }) {
  const kind = FORM_KINDS.find((k) => k.test.test(node.label))
  const fields = node.props.items?.length ? node.props.items : (kind?.fields ?? ["Name", "Email"])
  const title = kind?.title ?? node.label
  return (
    <div className="relative mx-auto w-full max-w-[260px] rounded-2xl border border-[var(--hairline)] bg-[var(--panel)] p-4 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.35)]">
      {node.type === "modal" && <span className="absolute right-3 top-2.5 text-xs text-[var(--muted)]" aria-hidden>✕</span>}
      <div className="text-center text-sm font-semibold">{title}</div>
      {kind?.sub && <div className="mt-0.5 text-center text-[10px] text-[var(--muted)]">{kind.sub}</div>}
      <div className="mt-3 flex flex-col gap-2">
        {fields.slice(0, 6).map((f, i) => (
          <label key={`${i}-${f}`} data-ui className="flex flex-col gap-1 text-[10px] text-[var(--muted)]">
            {f}
            {/message|comment|note/i.test(f) ? (
              <textarea data-ui rows={2} className={`w-full resize-none px-2 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--a)] ${field}`} />
            ) : (
              <input
                data-ui
                type={/password/i.test(f) ? "password" : /email/i.test(f) ? "email" : "text"}
                className={`h-7 w-full px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--a)] ${field}`}
              />
            )}
          </label>
        ))}
      </div>
      <button type="button" data-ui className="mt-3 w-full rounded-lg bg-[var(--a)] py-1.5 text-xs font-medium text-[var(--on-a)] transition active:scale-[0.98]">
        {kind?.submit ?? "Submit"}
      </button>
      {kind?.footer && <div className="mt-2 text-center text-[10px] text-[var(--muted)]">{kind.footer}</div>}
    </div>
  )
}

/** "Sidebar", "side nav", "left menu": the column beside a page's content. */
export const SIDEBAR = /\b(side\s*bar|side\s*nav|side\s*menu|nav(?:igation)?\s*(?:panel|rail|drawer)|left\s*(?:menu|nav|panel)|drawer)\b/i
const FOOTER = /\bfooter\b/i

/**
 * An empty section drawn as what its name says (a sidebar's nav, a footer's
 * links, content's text, features, pricing, FAQ), not a blank box. Its items
 * (from the prompt) fill it in.
 */
export function EmptySection({ node }: { node: BoardNode }) {
  const items = node.props.items
  const label = node.label
  if (SIDEBAR.test(label))
    return (
      <div className="flex flex-col gap-0.5">
        {(items?.length ? items : ["Overview", "Getting started", "Guides", "API reference", "Settings"]).slice(0, 8).map((x, i) => (
          <div
            key={`${i}-${x}`}
            className={`truncate rounded-md px-2 py-1 text-[11px] ${i === 0 ? "bg-[var(--a)]/15 font-medium text-[var(--ink)]" : "text-[var(--muted)]"}`}
          >
            {x}
          </div>
        ))}
      </div>
    )
  if (FOOTER.test(label))
    return (
      <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
        {(items?.length ? items : ["About", "Blog", "Privacy", "Terms"]).slice(0, 6).map((x, i) => (
          <span key={`${i}-${x}`}>{x}</span>
        ))}
        <span className="ml-auto">© 2026</span>
      </div>
    )
  if (/\b(features?|benefits|services)\b/i.test(label))
    return (
      <div className="grid grid-cols-3 gap-2">
        {(items?.length ? items : ["Fast", "Secure", "Simple"]).slice(0, 6).map((x, i) => (
          <div key={`${i}-${x}`} className="flex flex-col gap-1 rounded-lg bg-[var(--ink)]/[0.04] p-2">
            <div className="h-4 w-4 rounded-md bg-[var(--a)]/30" />
            <div className="truncate text-[10px] font-medium">{x}</div>
            <div className={`h-1 w-4/5 ${bar}`} />
          </div>
        ))}
      </div>
    )
  if (/\bpricing|plans?|tiers?\b/i.test(label))
    return (
      <div className="grid grid-cols-3 gap-2">
        {(items?.length ? items : ["Free", "Pro", "Team"]).slice(0, 4).map((x, i) => (
          <div key={`${i}-${x}`} className={`flex flex-col items-center gap-1 rounded-lg p-2 ${i === 1 ? "bg-[var(--a)]/15" : "bg-[var(--ink)]/[0.04]"}`}>
            <div className="text-[10px] font-medium">{x}</div>
            <div className="text-xs font-semibold">${[0, 12, 29, 99][i]}</div>
            <div className={`h-1 w-3/4 ${bar}`} />
          </div>
        ))}
      </div>
    )
  if (/\b(faq|questions)\b/i.test(label))
    return (
      <div className="flex flex-col divide-y divide-[var(--hairline)]">
        {(items?.length ? items : ["How does it work?", "Can I cancel anytime?", "Is there a free plan?"]).slice(0, 6).map((x, i) => (
          <div key={`${i}-${x}`} className="flex items-center justify-between py-1 text-[11px]">
            <span className="truncate">{x}</span>
            <span className="text-[var(--muted)]">+</span>
          </div>
        ))}
      </div>
    )
  if (/\b(content|main|body|article|docs?|text|about|blog)\b/i.test(label))
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`h-2.5 w-2/5 ${bar}`} />
        <div className={`h-1.5 w-full ${bar}`} />
        <div className={`h-1.5 w-11/12 ${bar}`} />
        <div className={`h-1.5 w-4/5 ${bar}`} />
        <div className={`mt-1 h-1.5 w-full ${bar}`} />
        <div className={`h-1.5 w-3/5 ${bar}`} />
      </div>
    )
  return <div className="h-16 rounded-lg border border-dashed border-[var(--hairline)]" />
}

/**
 * A page with a sidebar lays out like one: header on top, the sidebar beside
 * the main column, the footer across the bottom. Null when there's no sidebar.
 */
export function sidebarLayout<T extends { node: BoardNode }>(kids: readonly T[]) {
  const side = kids.find((k) => SIDEBAR.test(k.node.label))
  if (!side || kids.length < 2) return null
  const at = kids.indexOf(side)
  const top = kids.filter((k, i) => i < at && (k.node.type === "navbar" || /\b(header|top\s*bar|nav\s*bar)\b/i.test(k.node.label)))
  const bottom = kids.filter((k) => k !== side && FOOTER.test(k.node.label))
  const main = kids.filter((k) => k !== side && !top.includes(k) && !bottom.includes(k))
  return { top, side, main, bottom }
}
