/** Values shown inside widgets, computed from the label ("Jev decides, code computes"). */

const UNIT_SECONDS: Record<string, number> = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "25 min timer" → "25:00", "1 hour" → "1:00:00", "90 sec" → "01:30"; null when there's no duration. */
export function durationDisplay(label: string): string | null {
  let total = 0
  let found = false
  for (const m of label.toLowerCase().matchAll(/(\d+(?:\.\d+)?)[\s-]*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)) {
    total += Number(m[1]) * (UNIT_SECONDS[m[2]!] ?? 0)
    found = true
  }
  if (!found || total <= 0) return null
  total = Math.round(total)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** The first number in a label, formatted ("revenue 12400" → "12,400"), or null. */
export function statValue(label: string): string | null {
  const m = /(\$|€|£)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|k|m|b)?/i.exec(label)
  if (!m) return null
  const n = Number(m[2]!.replace(/,/g, ""))
  if (!Number.isFinite(n)) return null
  return `${m[1] ?? ""}${n.toLocaleString("en-US")}${m[3] ?? ""}`
}

/** Seconds in a label ("25 min timer" → 1500), or null. */
export function durationSeconds(label: string): number | null {
  let total = 0
  let found = false
  for (const m of label.toLowerCase().matchAll(/(\d+(?:\.\d+)?)[\s-]*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)) {
    total += Number(m[1]) * (UNIT_SECONDS[m[2]!] ?? 0)
    found = true
  }
  return found && total > 0 ? Math.round(total) : null
}

/** mm:ss or h:mm:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** "spent $450 on uber" → "$450"; "12.5 dollars" → "$12.50". */
export function amount(label: string): string | null {
  const m = /(\$|€|£)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(dollars|usd|bucks|euros?|€|£)/i.exec(label)
  if (!m) return null
  const sym = m[1] ?? (/(euro|€)/i.test(m[4] ?? "") ? "€" : /£/.test(m[4] ?? "") ? "£" : "$")
  const n = Number((m[2] ?? m[3])!.replace(/,/g, ""))
  return `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

/** "read 12 books, 4 done" / "4 of 12" / "60%" → a 0..1 fraction and its text. */
export function progressOf(label: string): { value: number; text: string } | null {
  const of = /(\d+)\s*(?:\/|of|out of)\s*(\d+)/i.exec(label)
  if (of && Number(of[2]) > 0) return { value: Math.min(1, Number(of[1]) / Number(of[2])), text: `${of[1]} of ${of[2]}` }
  const done = /(\d+)\D+?(\d+)\s*(?:done|completed|finished)/i.exec(label)
  if (done && Number(done[1]) > 0) return { value: Math.min(1, Number(done[2]) / Number(done[1])), text: `${done[2]} of ${done[1]}` }
  const pct = /(\d{1,3})\s*%/.exec(label)
  if (pct) return { value: Math.min(1, Number(pct[1]) / 100), text: `${pct[1]}%` }
  return null
}

/** Readable text color on top of an accent. */
export function onColor(hex: string | undefined): string {
  const m = hex && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return "var(--panel)"
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number.parseInt(x!, 16) / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#1c1917" : "#ffffff"
}

/** "flight to goa next weekend" → "Goa"; "sfo to jfk" → ["SFO", "JFK"]. */
export function route(label: string): { from: string | null; to: string | null } {
  const pair = /\b([a-z]{3})\s+(?:to|→|->)\s+([a-z]{3})\b/i.exec(label)
  if (pair) return { from: pair[1]!.toUpperCase(), to: pair[2]!.toUpperCase() }
  const to = /\bto\s+([a-z][a-z ]{1,20}?)(?:\s+(?:next|this|on|in|for|tomorrow|today)\b|$)/i.exec(label)
  return { from: null, to: to ? to[1]!.replace(/\b\w/g, (c) => c.toUpperCase()) : null }
}
