import type { EntryPatch, NodeType } from "@rtw/shared"
import type { HandleInfo } from "./assemble.ts"
import { classifyKeywords } from "../classify/keywords.ts"
import { collectionOf, explicitColor } from "./modifiers.ts"
import { resolveOnBoard } from "./target.ts"

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
/** "4 of them", "four contacts", "with 3 rows": how many, or 0. */
const countIn = (s: string) => {
  const m = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b(?=\s+(?:of\s+them|[a-z]+s\b|items?|rows?|entries))/i.exec(s)
  if (!m) return 0
  const w = m[1]!.toLowerCase()
  return NUMBER_WORDS[w] ?? Number.parseInt(w, 10)
}

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
  let renamedTo: string | undefined
  let of: NodeType | undefined
  let items: string[] | undefined
  const into = label
    ? null
    : new RegExp(`\\b(?:turn|convert|change|switch|transform|make)\\s+${h}\\s+(?:into|to)\\s+(?:(?:a|an)\\s+)?(.+)$`, "i").exec(text)
  // "make it 3 contacts", "make it a list of timers" (but "make it red" stays a color).
  const made = label || into ? null : new RegExp(`\\bmake\\s+${h}\\s+(?:(?:a|an)\\s+)?(.+)$`, "i").exec(text)
  // "make it a clock" retypes too; "make it red" / "make it a red clock" is a color.
  const madeKind = made && !explicitColor(made[1]!) && classifyKeywords(made[1]!).type !== "box"
  const retype = into ?? (made && (countIn(made[1]!) > 1 || collectionOf(made[1]!) || madeKind) ? made : null)
  if (retype) {
    // "a list of contacts, 4 of them", "a table of timers", "4 contacts": a collection, with its rows.
    const phrase = retype[1]!.trim()
    const n = countIn(phrase)
    const coll = collectionOf(phrase.replace(/,?\s*(?:with\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+of\s+them\s*$/i, ""))
    if (coll && (coll.type === "list" || coll.type === "table")) {
      type = coll.type
      of = coll.of
    } else if (n > 1) {
      type = "list"
      const t = classifyKeywords(phrase.replace(/^\s*\S+\s+/, "").replace(/s\b/, "")).type
      if (t !== "box") of = t
    } else {
      const t = classifyKeywords(phrase).type
      if (t !== "box") type = t
    }
    // Parts drawn by their name ("left sidebar", "footer") take that name.
    if (!label && /(side\s*bar|side\s*nav|footer|header)\b/i.test(phrase))
      renamedTo = titleCase(
        phrase
          .replace(/^(?:a|an|the)\s+/i, "")
          .replace(/(left|right)(side|nav)/i, "$1 $2")
          .replace(/sidebars$/i, "sidebar"),
      )
    if (type && (type === "list" || type === "table") && n > 1) {
      const noun = of ? of.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Item"
      items = Array.from({ length: Math.min(12, n) }, (_, i) => `${noun} ${i + 1}`)
    }
  }

  const color = label ? undefined : (explicitColor(rest) ?? undefined)
  if (!label && !type && !color) return null
  return {
    target,
    ...(label ? { label } : renamedTo ? { label: renamedTo } : {}),
    ...(type ? { type } : {}),
    ...(of ? { of } : {}),
    ...(items ? { items } : {}),
    ...(color ? { color } : {}),
  }
}

/**
 * "annotate @x: needs real copy", "add a note to @x saying …", "note on @x:
 * …", "@x note: …": the annotation for one existing element.
 */
export function noteOf(text: string, handles: HandleInfo): EntryPatch[] | null {
  const m =
    /^\s*(?:annotate|note(?:\s+on)?|add\s+(?:a|an)\s+(?:note|annotation|comment)\s+(?:to|on|for)|comment\s+on)\s+(@[a-z0-9][a-z0-9-]*)\s*(?::|-|,|\s+(?:saying|that says|with|:))?\s+(.+)$/is.exec(text) ??
    /^\s*(@[a-z0-9][a-z0-9-]*)\s+(?:note|annotation)\s*:\s*(.+)$/is.exec(text)
  if (!m) return null
  const target = m[1]!.toLowerCase()
  const note = m[2]!.trim().replace(/^["“](.*)["”]$/s, "$1")
  return handles.has(target) && note ? [{ target, note }] : null
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
  // One @tag and a plain name: "disconnect @modal from server 2" cuts only that arrow.
  const object = /\b(?:from|and|with|to|of)\s+(?:the\s+)?(.+?)\s*$/i.exec(text.replace(HANDLE, " ").replace(/\s+/g, " "))?.[1]
  if (object && !EVERYTHING.test(object)) {
    const other = resolveOnBoard(object, handles, a)
    // Named something that isn't there: cut nothing rather than everything.
    if (!other) return null
    if (parentOf(a) === other) return [{ target: a, detach: true }]
    if (parentOf(other) === a) return [{ target: other, detach: true }]
    return outOf ? null : [{ target: a, unlink: other }]
  }
  if (parentOf(a) && !object) return [{ target: a, detach: true }]
  return outOf ? null : [{ target: a, unlink: "*" }]
}

/** "from everything", "from all of them": every arrow, on purpose. */
const EVERYTHING = /^(?:everything|anything|all|all of (?:them|it|its \w+)|every(?:one|thing)|all (?:the )?\w+)$/i

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
  // "all the Independent Server": the elements on the board with that name (Independent server 1–5).
  const phrase = words.join(" ").replace(/s$/, "")
  const norm = (l: string) => l.toLowerCase().replace(/[^a-z\s]+/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "")
  const named = phrase
    ? [...handles.keys()].filter((h) => {
        const l = norm(handles.get(h)?.label ?? "")
        return l === phrase || l.startsWith(`${phrase} `) || l.endsWith(` ${phrase}`)
      })
    : []
  const types = new Set<NodeType>()
  for (const w of words) {
    const t = classifyKeywords(w.replace(/s$/, "")).type
    if (t === "box") {
      if (named.length) break
      return null // an unknown word: not a bulk color change
    }
    types.add(t)
  }
  if (named.length && (types.size === 0 || words.some((w) => classifyKeywords(w.replace(/s$/, "")).type === "box"))) {
    const scoped = scope ? named.filter(inside) : named
    return scoped.length ? scoped.map((target) => ({ target, color })) : null
  }

  const targets = scope ? [...handles.keys()].filter(inside) : them ? recent.filter((h) => handles.has(h)) : [...handles.keys()]
  const picked = targets.filter((h) => types.size === 0 || types.has(handles.get(h)!.type!))
  // Scoped to a container: never falls through to recoloring the container itself.
  if (scope) return picked.map((target) => ({ target, color }))
  return picked.length ? picked.map((target) => ({ target, color })) : null
}
