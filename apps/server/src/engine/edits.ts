import type { EntryPatch, NodeType } from "@rtw/shared"
import type { HandleInfo } from "./assemble.ts"
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

/** Taking something apart: out of its container, or off an arrow. */
const DETACH =
  /\b(?:detach|un-?attach|disconnect|unlink|unhook|unwire|decouple|separate|remove\s+(?:the\s+)?(?:arrows?|links?|connections?|edges?)|delete\s+(?:the\s+)?(?:arrows?|links?|connections?|edges?)|(?:take|move|pull|get|drag)\b.*\bout\s+of|no\s+longer\s+(?:connected|linked|attached))\b/i
const OUT_OF = /\bout\s+of\b|\b(?:ungroup|unnest)\b/i

/**
 * "detach @a from @b", "unattach @a", "disconnect @a and @b", "take @a out of
 * @b", "remove the arrow between @a and @b": @a leaves @b if it's inside it,
 * otherwise the arrows between them go. With one handle: out of its container
 * if it has one, else all its arrows.
 */
export function detachOf(text: string, handles: HandleInfo): EntryPatch[] | null {
  if (!DETACH.test(text)) return null
  const named = [...new Set([...text.matchAll(HANDLE)].map((m) => m[0].toLowerCase()).filter((h) => handles.has(h)))]
  const [a, b] = named
  if (!a || named.length > 2) return null
  const parentOf = (h: string) => handles.get(h)?.parent ?? null
  const outOf = OUT_OF.test(text)
  if (b) {
    if (parentOf(a) === b) return [{ target: a, detach: true }]
    if (parentOf(b) === a) return [{ target: b, detach: true }]
    return outOf ? null : [{ target: a, unlink: b }]
  }
  if (parentOf(a)) return [{ target: a, detach: true }]
  return outOf ? null : [{ target: a, unlink: "*" }]
}

/** Words that mean "every element" rather than a type. */
const GENERIC = /^(instances?|elements?|components?|boxes?|nodes?|things?|items?|modals?|blocks?|parts?|pieces?|of|the|them|it|on|in|board|canvas|this|here|to|be|into|colou?r)$/i
const ALL = /\b(all|every|each|everything|entire|whole)\b/i
const THEM = /\b(them|these|those|both)\b/i
const VERB = /\b(make|makes|turn|change|set|colou?r|paint|recolou?r|update|switch|create)\b/gi
const SHADE = /\b(light|dark|deep|pale|soft|bright|neon|vivid|muted|dusty|baby|hot|royal)\b/gi

/**
 * "make all instances red", "create all servers red", "paint every database
 * blue", "make them green": the same color for many existing elements. A type
 * word narrows it ("servers" → services); "them" means the recent elements.
 */
export function bulkEditOf(text: string, handles: HandleInfo, recent: readonly string[]): EntryPatch[] | null {
  // "all servers inside @servers-stack": only what's inside that container.
  const scopeRe = /\b(?:in|inside|within|of|under|in\s+side)\s+(?:the\s+)?(@[a-z0-9][a-z0-9-]*)/gi
  const scopes = [...text.matchAll(scopeRe)].map((m) => m[1]!.toLowerCase())
  const rest = text.replace(scopeRe, " ")
  if (/@[a-z0-9]/i.test(rest) || scopes.length > 1 || (scopes[0] && !handles.has(scopes[0]))) return null
  const scope = scopes[0]
  const inside = (h: string) => {
    for (let p = handles.get(h)?.parent ?? null, hops = 0; p && hops < 64; p = handles.get(p)?.parent ?? null, hops++) if (p === scope) return true
    return false
  }
  text = rest
  const all = ALL.test(text) || (scope !== undefined && /\b[a-z]+s\b/i.test(text))
  const them = !all && THEM.test(text)
  if (!all && !them) return null
  const color = explicitColor(text)
  if (!color) return null

  // Besides the scope, verbs and color words, what's left names the type (if anything).
  const words = text
    .replace(VERB, " ")
    .replace(ALL, " ")
    .replace(THEM, " ")
    .replace(SHADE, " ")
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter((w) => w && !GENERIC.test(w) && !explicitColor(w))
  const types = new Set<NodeType>()
  for (const w of words) {
    const t = classifyKeywords(w.replace(/s$/, "")).type
    if (t === "box") return null // an unknown word: not a bulk color change
    types.add(t)
  }

  const targets = scope ? [...handles.keys()].filter(inside) : them ? recent.filter((h) => handles.has(h)) : [...handles.keys()]
  const picked = targets.filter((h) => types.size === 0 || types.has(handles.get(h)!.type!))
  // Scoped to a container: never falls through to recoloring the container itself.
  if (scope) return picked.map((target) => ({ target, color }))
  return picked.length ? picked.map((target) => ({ target, color })) : null
}
