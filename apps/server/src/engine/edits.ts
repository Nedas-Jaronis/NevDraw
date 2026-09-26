import type { EntryPatch, NodeType } from "@rtw/shared"
import { classifyKeywords } from "../classify/keywords.ts"
import { explicitColor } from "./modifiers.ts"

const HANDLE = /@[a-z0-9][a-z0-9-]*/gi
/** Words that mark a sentence as changing something that exists. */
const EDIT_CUE = /\b(make|turn|change|set|colou?r|paint|recolou?r|rename|call|label|title|update|switch|convert|should be|must be|is now|now)\b/i
const titleCase = (s: string) => s.trim().replace(/\b([a-z])/g, (c) => c.toUpperCase())

/**
 * "make @x red", "change @x to blue", "rename @x to Checkout", "turn @x into a
 * stopwatch": a change to the one existing element named, or null when the
 * text isn't an edit (then it's a reference or a new element as usual).
 */
export function editOf(text: string, known: ReadonlySet<string>): EntryPatch | null {
  const handles = [...new Set([...text.matchAll(HANDLE)].map((m) => m[0].toLowerCase()).filter((h) => known.has(h)))]
  if (handles.length !== 1 || !EDIT_CUE.test(text)) return null
  const target = handles[0]!
  const h = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const rest = text.replace(HANDLE, " ").replace(/\s+/g, " ").trim()

  // Renames and retypes are anchored to the handle, so "a call to action at the bottom"
  // elsewhere in the sentence never renames anything.
  const renameRe = [
    new RegExp(`\\b(?:rename|relabel|retitle)\\s+${h}\\s+(?:to|as)\\s+["“]?(.+?)["”]?\\s*$`, "i"),
    new RegExp(`\\b(?:call|name|title|label)\\s+${h}\\s+(?:as\\s+)?["“]?(.+?)["”]?\\s*$`, "i"),
    new RegExp(`${h}\\s+(?:should be\\s+|is now\\s+|will be\\s+)?(?:renamed|called|named|titled|labell?ed)\\s+(?:to\\s+|as\\s+)?["“]?(.+?)["”]?\\s*$`, "i"),
  ]
  const renamed = renameRe.map((re) => re.exec(text)).find(Boolean)
  const label = renamed?.[1] ? titleCase(renamed[1].replace(/^(?:a|an|the)\s+/i, "")) : undefined

  let type: NodeType | undefined
  const retype = label
    ? null
    : new RegExp(`\\b(?:turn|convert|change|switch|transform|make)\\s+${h}\\s+(?:into|to)\\s+(?:a|an)\\s+(.+)$`, "i").exec(text)
  if (retype) {
    const t = classifyKeywords(retype[1]!).type
    if (t !== "box") type = t
  }

  const color = label ? undefined : (explicitColor(rest) ?? undefined)
  if (!label && !type && !color) return null
  return { target, ...(label ? { label } : {}), ...(type ? { type } : {}), ...(color ? { color } : {}) }
}
