/**
 * Editing an element's list, precisely: a form's fields, a navbar's /
 * sidebar's / footer's links, a table's rows, a poll's options. "change email
 * to username" renames one entry and leaves every other one exactly as it was.
 */
import type { EntryPatch } from "@rtw/shared"
import type { HandleInfo } from "./assemble.ts"

const HANDLE = /@[a-z0-9][a-z0-9-]*/gi
const KIND = "(?:field|input|box|link|tab|option|item|row|entry|column|button)s?"
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(new RegExp(`\\s+${KIND}$`), "")
    .replace(/^(?:the|a|an|my|its)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
const titleCase = (s: string) => s.trim().replace(/^./, (c) => c.toUpperCase())
const clean = (s: string) =>
  s
    .replace(/[`"'“”‘’]/g, "")
    .replace(new RegExp(`\\s+${KIND}$`, "i"), "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .trim()

/**
 * The element whose list the text edits: the one @handle it names, else the
 * clicked target. Null when the text isn't a list edit of a known entry.
 */
export function itemEditOf(text: string, handles: HandleInfo, target: string | null): EntryPatch | null {
  const named = [...new Set([...text.matchAll(HANDLE)].map((m) => m[0].toLowerCase()).filter((h) => handles.has(h)))]
  const element = named.length === 1 ? named[0]! : named.length === 0 ? target : null
  const items = element ? handles.get(element)?.items : undefined
  if (!element || !items?.length) return null
  const t = text
    .replace(HANDLE, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:in|on|for|inside)\s+/i, "")
    .trim()
  const find = (phrase: string) => items.findIndex((x) => norm(x) === norm(phrase))

  // "change email to username", "rename the email field to Username", "replace Blog with Docs".
  const rename = /^(?:please\s+)?(?:change|rename|replace|swap|switch|turn|relabel|make)\s+(.+?)\s+(?:to|with|into|as|→|->)\s+(.+)$/i.exec(t)
  if (rename) {
    const i = find(rename[1]!)
    if (i >= 0) {
      const next = [...items]
      next[i] = titleCase(clean(rename[2]!.replace(/\s+(?:in|on|for|of|inside|within)$/i, "")))
      return { target: element, items: next }
    }
  }
  // "remove the message field", "delete Blog and Terms".
  const remove = /^(?:please\s+)?(?:remove|delete|drop|get rid of|take out|lose)\s+(.+)$/i.exec(t)
  if (remove) {
    const names = remove[1]!.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean)
    const idx = names.map(find)
    if (idx.length && idx.every((i) => i >= 0)) return { target: element, items: items.filter((_, i) => !idx.includes(i)) }
  }
  // "add a phone field", "add Docs and Blog links", "add a company field after email".
  const add = new RegExp(`^(?:please\\s+)?(?:add|include|insert|append)\\s+(?:an?\\s+|another\\s+)?(.+?)\\s+${KIND}(?:\\s+(after|before)\\s+(.+))?$`, "i").exec(t)
  if (add) {
    const fresh = add[1]!.split(/\s*(?:,|\band\b|&)\s*/).map((x) => titleCase(clean(x))).filter(Boolean)
    const next = [...items]
    const anchor = add[3] ? find(add[3]) : -1
    const at = anchor < 0 ? next.length : add[2]!.toLowerCase() === "after" ? anchor + 1 : anchor
    next.splice(at, 0, ...fresh)
    return { target: element, items: next.slice(0, 12) }
  }
  return null
}
