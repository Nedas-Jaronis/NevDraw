/**
 * The labelled-data format: plain text with spans marked inline, so a person
 * can read and fix examples in any editor.
 *
 *   a [landing page](INSTANCE) with [3](COUNT mod:pricing cards) [pricing cards](INSTANCE in:landing page)
 *
 * After the tag come the span's links, `label:target`, where target is the text
 * of another span in the same line (the nearest one with that text; `text~2` picks
 * the second occurrence). `parse` turns a line into the text plus character-offset
 * spans; `render` does the reverse. Offsets are what training and scoring use, so
 * tokenizers never have to agree on word boundaries.
 */

export const TAGS = ["INSTANCE", "REF", "COUNT", "RELATION", "ACTION", "ATTR", "NAME"] as const
export type Tag = (typeof TAGS)[number]

/**
 * How one span relates to another (the head):
 *   mod   describes, counts or names it       red → button, 3 → cards, Checkout → it
 *   in    sits inside it                      navbar → landing page, hero → @landing-page
 *   src   is where a relation starts          api → writes to; @a → connect
 *   dst   is where a relation or edit goes    postgres → writes to; @navbar → above; clock → change
 *   obj   is what an edit acts on             @card → remove
 *   same  is the same thing, said again       it → checkout service, the footer → footer
 */
export const LINKS = ["mod", "in", "src", "dst", "obj", "same"] as const
export type Link = (typeof LINKS)[number]

export type Arc = { label: Link; head: number }
export type Span = { start: number; end: number; tag: Tag; arcs?: Arc[] }
export type Example = { text: string; spans: Span[] }

const MARK = /\[([^\[\]]+)\]\(([A-Z]+)((?:\s+[a-z]+:[^()]+?)*)\)/g
const ARC = new RegExp(`(${LINKS.join("|")}|[a-z]+):(.+?)(?=\\s+[a-z]+:|$)`, "g")

export function parse(line: string): Example {
  let text = ""
  const spans: Span[] = []
  const pending: { from: number; label: string; target: string }[] = []
  let last = 0
  for (const m of line.matchAll(MARK)) {
    const tag = m[2] as Tag
    if (!TAGS.includes(tag)) throw new Error(`unknown tag ${m[2]} in: ${line}`)
    text += line.slice(last, m.index)
    const start = text.length
    text += m[1]!
    for (const a of (m[3] ?? "").trim().matchAll(ARC)) pending.push({ from: spans.length, label: a[1]!, target: a[2]!.trim() })
    spans.push({ start, end: text.length, tag })
    last = m.index! + m[0].length
  }
  text += line.slice(last)
  if (/\]\([A-Z]/.test(text) || /\[[^\]]*\]\(/.test(text)) throw new Error(`unclosed markup in: ${line}`)
  const said = spans.map((s) => text.slice(s.start, s.end))
  for (const p of pending) {
    if (!LINKS.includes(p.label as Link)) throw new Error(`unknown link ${p.label} in: ${line}`)
    const head = resolve(said, p.from, p.target)
    if (head < 0) throw new Error(`no span "${p.target}" for ${p.label} of "${said[p.from]}" in: ${line}`)
    ;(spans[p.from]!.arcs ??= []).push({ label: p.label as Link, head })
  }
  return { text, spans }
}

/** The span a link target names: `text~N` is the Nth span with that text, plain `text` the nearest other one. */
function resolve(said: string[], from: number, target: string): number {
  const m = /^(.*)~(\d+)$/.exec(target)
  if (m) {
    const hits = said.flatMap((s, i) => (s === m[1] ? [i] : []))
    return hits[Number(m[2]) - 1] ?? -1
  }
  let best = -1
  said.forEach((s, i) => {
    if (i !== from && s === target && (best < 0 || Math.abs(i - from) < Math.abs(best - from))) best = i
  })
  return best
}

export function render({ text, spans }: Example): string {
  const said = spans.map((s) => text.slice(s.start, s.end))
  const name = (from: number, head: number) => {
    if (resolve(said, from, said[head]!) === head) return said[head]!
    return `${said[head]}~${said.slice(0, head + 1).filter((s) => s === said[head]).length}`
  }
  const order = spans.map((_, i) => i).sort((a, b) => spans[a]!.start - spans[b]!.start)
  let out = ""
  let last = 0
  for (const i of order) {
    const s = spans[i]!
    const arcs = (s.arcs ?? []).map((a) => ` ${a.label}:${name(i, a.head)}`).join("")
    out += text.slice(last, s.start) + `[${said[i]}](${s.tag}${arcs})`
    last = s.end
  }
  return out + text.slice(last)
}

/** Lines of a .txt data file: blank lines and `#` comments are skipped. */
export function parseFile(content: string): Example[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map(parse)
}
