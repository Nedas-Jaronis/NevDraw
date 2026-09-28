/**
 * The labelled-data format: plain text with spans marked inline, so a person
 * can read and fix examples in any editor.
 *
 *   a [landing page](INSTANCE) with [3](COUNT) [pricing cards](INSTANCE)
 *
 * `parse` turns a line into the text plus character-offset spans; `render`
 * does the reverse. Offsets are what training and scoring use, so tokenizers
 * never have to agree on word boundaries.
 */

export const TAGS = ["INSTANCE", "REF", "COUNT", "RELATION", "ACTION", "ATTR", "NAME"] as const
export type Tag = (typeof TAGS)[number]

export type Span = { start: number; end: number; tag: Tag }
export type Example = { text: string; spans: Span[] }

const MARK = /\[([^\[\]]+)\]\(([A-Z]+)\)/g

export function parse(line: string): Example {
  let text = ""
  const spans: Span[] = []
  let last = 0
  for (const m of line.matchAll(MARK)) {
    const tag = m[2] as Tag
    if (!TAGS.includes(tag)) throw new Error(`unknown tag ${m[2]} in: ${line}`)
    text += line.slice(last, m.index)
    const start = text.length
    text += m[1]!
    spans.push({ start, end: text.length, tag })
    last = m.index! + m[0].length
  }
  text += line.slice(last)
  if (/\]\([A-Z]/.test(text) || /\[[^\]]*\]\(/.test(text)) throw new Error(`unclosed markup in: ${line}`)
  return { text, spans }
}

export function render({ text, spans }: Example): string {
  let out = ""
  let last = 0
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(last, s.start) + `[${text.slice(s.start, s.end)}](${s.tag})`
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
