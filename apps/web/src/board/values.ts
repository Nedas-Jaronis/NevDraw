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
  for (const m of label.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)) {
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
