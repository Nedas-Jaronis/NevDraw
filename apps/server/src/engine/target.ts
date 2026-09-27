/**
 * Targeted editing: the person clicked an element (the target) and what they
 * type edits it. Removing, moving and changing its parts are commands read
 * here; anything else they describe is added inside it.
 */
import { type EntryGraph, type EntryPatch, REGISTRY } from "@rtw/shared"
import type { HandleInfo } from "./assemble.ts"
import { editOf } from "./edits.ts"
import { explicitColor } from "./modifiers.ts"

const HANDLE = /@[a-z0-9][a-z0-9-]*/i
/** Media sits inside any element ("add an image" to a hero). */
const MEDIA = new Set<string>(["image", "video", "chart", "map", "avatar"])
/** Empty it: "take everything out of it", "clear it", "make it blank again", "remove all its parts". */
const CLEAR =
  /^(?:please\s+)?(?:(?:take|pull|get)\s+(?:everything|it all|all (?:of )?(?:it|the \w+))\s+out(?:\s+of\s+.+)?|(?:remove|delete|clear|wipe|drop)\s+(?:out\s+)?(?:everything|it all|all (?:of )?(?:it|its \w+|the \w+))(?:\s+(?:in|inside|from|out of)\s+.+)?|(?:clear|empty|wipe|reset)(?:\s+(?:it|this|out))?(?:\s+out)?|make\s+(?:it|this)\s+(?:blank|empty|clean)(?:\s+again)?|start\s+(?:it\s+)?over)(?:\s+again)?$/i
const REMOVE = /^(?:please\s+)?(?:remove|delete|drop|get rid of|take out|take away|lose|kill|erase|ditch|no more|without)\s+(.+)$/i
const MOVE =
  /^(?:please\s+)?(?:move|put|place|shift|drag)\s+(.+?)\s+(above|before|over|below|after|under|beneath|to the top(?: of it)?|to the bottom(?: of it)?|at the top(?: of it)?|at the bottom(?: of it)?|first|last|up|down)(?:\s+(.+))?$/i
/**
 * An arrow from the target: "link / connect / point it to X", "calls X", "writes to X"… The
 * subject is the target; the rest names what it points at.
 */
const CONNECT =
  /^(?:please\s+)?(?:(?:it|this|this one)\s+(?:should\s+)?)?(?:(link|connect|point|wire|hook|attach|route|send|go)(?:s|es)?(?:\s+(?:it|this))?(?:\s+up)?\s+(?:towards?|to|into|with|at)|(calls?|uses?|hits?|talks? to|posts? to|sends? to|writes? to|saves? to|stores? in|reads? from|fetches from|queries|publishes to|emits to|subscribes to|consumes from|listens to|navigates to|leads to|opens))\s+(.+)$/i
/** "another server", "the other server": an existing element, not a new one. */
const DETERMINER = /^(?:the\s+)?(?:another|other|existing|that|this|the|a|an|our|my)\s+/i

/** Verbs that change the thing itself: "make it red", "rename to Checkout". */
const EDIT_VERB = /^(?:please\s+)?(make|turn|change|colou?r|paint|recolou?r|rename|relabel|retitle|call|label|title|set|switch|convert)\b\s*/i
const PRONOUN = /\b(it|this one|this|that one|that|the element|the selection|the selected one)\b/i
/** Clauses: "add a subtitle and remove the button", "make it red, then move the cta up". */
const CLAUSE = /\s*(?:[,;]|\band then\b|\bthen\b|\band\b)\s*(?=(?:please\s+)?(?:remove|delete|drop|get rid of|take out|take away|lose|erase|ditch|move|put|place|shift|make|turn|change|colou?r|paint|recolou?r|rename|relabel|add|include|insert|create)\b)/i

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(?:the|a|an|that|this|those|these|its|my|our)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

/** Everything inside the target, nearest first (children before grandchildren). */
export function subtreeOf(target: string, handles: HandleInfo): string[] {
  const out: string[] = []
  let frontier = [target]
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const next: string[] = []
    for (const [h, info] of handles) if (info.parent && frontier.includes(info.parent)) next.push(h)
    out.push(...next)
    frontier = next
  }
  return out
}

/**
 * The element a phrase names, looked up inside the target first ("the
 * button", "get started", "the second card" is out of scope): by label, then
 * by handle, then by type word; "it" is the target itself.
 */
export function resolveIn(phrase: string, target: string, handles: HandleInfo): string | null {
  const p = phrase.trim()
  const direct = HANDLE.exec(p)?.[0]?.toLowerCase()
  if (direct && handles.has(direct)) return direct
  if (PRONOUN.test(p) && words(p).split(" ").length <= 2) return target
  const want = words(p)
  if (!want) return null
  const scope = subtreeOf(target, handles)
  const label = (h: string) => words(handles.get(h)?.label ?? "")
  const handleWords = (h: string) => h.slice(1).replace(/-/g, " ")
  return (
    scope.find((h) => label(h) === want) ??
    scope.find((h) => handleWords(h) === want) ??
    scope.find((h) => label(h).includes(want) || want.includes(label(h))) ??
    scope.find((h) => (handles.get(h)?.type ?? "").replace("-", " ") === want.replace(/s$/, "")) ??
    (words(handles.get(target)?.label ?? "") === want ? target : null)
  )
}

export type Targeted = {
  /** Changes read directly from the text (remove / move / edit). */
  patches: EntryPatch[]
  /** Whatever is left to describe new parts, for the normal reading. */
  rest: string
  /** Everything in the text was a command on existing elements (no new parts to invent). */
  command: boolean
}

/**
 * An element anywhere on the board a phrase names ("another server", "the
 * payments api"): by label, then handle words, then kind. Null when nothing,
 * or more than one thing, matches.
 */
export function resolveOnBoard(phrase: string, handles: HandleInfo, exclude: string): string | null {
  const direct = HANDLE.exec(phrase)?.[0]?.toLowerCase()
  if (direct && handles.has(direct)) return direct
  const want = words(phrase.replace(DETERMINER, ""))
  if (!want) return null
  const all = [...handles.keys()].filter((h) => h !== exclude)
  const unique = (hits: string[]) => (hits.length === 1 ? hits[0]! : null)
  const label = (h: string) => words(handles.get(h)?.label ?? "")
  const kind = (h: string) => (handles.get(h)?.type ?? "").replace("-", " ")
  const singular = want.replace(/s$/, "")
  // "server 1" = "Server1" = @server1.
  const squash = (s: string) => s.replace(/\s+/g, "")
  return (
    unique(all.filter((h) => label(h) === want)) ??
    unique(all.filter((h) => squash(label(h)) === squash(want) || squash(h.slice(1).replace(/-/g, " ")) === squash(want))) ??
    unique(all.filter((h) => h.slice(1).replace(/-/g, " ") === want)) ??
    unique(all.filter((h) => label(h).replace(/s$/, "") === singular || kind(h) === singular || (singular === "server" && kind(h) === "service")))
  )
}

/** Split the text into commands on existing parts and a description of new ones. */
/** "“On the inside…”" → On the inside… (quotes and trailing punctuation off, first letter up). */
const unquote = (s: string) =>
  s
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`.!]+$/g, "")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())

/**
 * Renaming the target (or a part of it): "change the title from "X" to "Y"",
 * "rename it to Y", "call it Y", "set the heading to Y", "change the name of
 * the inner modal to Y", "edit the name to Y".
 */
export function renameOf(text: string, target: string, handles: HandleInfo): EntryPatch | null {
  const t = text.trim()
  const field = "(?:name|title|label|heading|header|text|caption)"
  const PRON = /^(?:it|this|that|this one)$/i
  let whoPhrase: string | undefined
  let raw: string | undefined
  // "change / edit / set the title (of X) (from "A") to "B"".
  const byField = new RegExp(`^(?:please\\s+)?(?:change|edit|set|update|rename|make|switch)\\s+(?:the\\s+|its\\s+)?${field}(?:\\s+of\\s+(.+?))?\\s+(?:to|into|as|from|=)\\s+(.+)$`, "i").exec(t)
  // "rename / call the username input (to) Handle", "call it Login", "rename to Sign in".
  const byVerb =
    /^(?:please\s+)?(?:rename|retitle|relabel|call|name|title|label)\s+(.+?)\s+(?:to|as)\s+(.+)$/i.exec(t) ??
    /^(?:please\s+)?(?:call|name|title|rename|retitle)\s+(it|this|that|this one)\s+(.+)$/i.exec(t) ??
    // "rename to Sign in": the empty first group means the target itself.
    /^(?:please\s+)?(?:rename|retitle|relabel)\s+()(?:to|as)\s+(.+)$/i.exec(t)
  if (byField) {
    whoPhrase = byField[1]
    raw = byField[2]
  } else if (byVerb) {
    whoPhrase = byVerb[1]
    raw = byVerb[2]
  }
  if (!raw) return null
  // The new title is the last quoted text, or whatever follows the final "to" ("from "A" to "B"").
  const quoted = [...raw.matchAll(/["“'‘]([^"”'’]+)["”'’]/g)].map((q) => q[1]!)
  const newTitle = quoted.length ? quoted.at(-1)! : (/(?:^|\s)to\s+(.+)$/i.exec(raw)?.[1] ?? raw)
  const who = whoPhrase && !PRON.test(whoPhrase.trim()) ? resolveIn(whoPhrase, target, handles) : target
  if (!who) return null
  const label = unquote(newTitle)
  if (!label || label.length > 60) return null
  return { target: who, label }
}

export function readTargeted(text: string, target: string, handles: HandleInfo): Targeted {
  // A title change is the whole instruction (the new title may contain "and", "have", …).
  const renamed = renameOf(text, target, handles)
  if (renamed) return { patches: [renamed], rest: "", command: true }
  const patches: EntryPatch[] = []
  const rest: string[] = []
  let invents = false
  const add = (p: EntryPatch) => {
    const existing = patches.find((q) => q.target === p.target)
    if (existing) Object.assign(existing, p)
    else patches.push(p)
  }
  for (const raw of text.split(CLAUSE)) {
    const clause = raw.trim().replace(/[.!]+$/, "")
    if (!clause) continue

    if (CLEAR.test(clause)) {
      // Every part directly inside it (their own parts go with them).
      for (const [h, info] of handles) if (info.parent === target) add({ target: h, remove: true })
      continue
    }

    const rm = REMOVE.exec(clause)
    if (rm) {
      // "remove the button and the subtitle": each named part.
      const names = rm[1]!.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean)
      const found = names.map((n) => resolveIn(n, target, handles))
      if (found.every((h) => h !== null)) {
        for (const h of found) add({ target: h!, remove: true })
        continue
      }
    }

    const mv = MOVE.exec(clause)
    if (mv) {
      const what = resolveIn(mv[1]!, target, handles)
      const where = mv[2]!.toLowerCase()
      const other = mv[3] ? resolveIn(mv[3], target, handles) : null
      if (what && what !== target) {
        if (/top|first/.test(where)) add({ target: what, before: "$top" })
        else if (/bottom|last/.test(where)) add({ target: what, after: "$bottom" })
        else if (/up/.test(where) && !other) add({ target: what, before: "$prev" })
        else if (/down/.test(where) && !other) add({ target: what, after: "$next" })
        else if (other && /above|before|over/.test(where)) add({ target: what, before: other })
        else if (other) add({ target: what, after: other })
        if (patches.some((p) => p.target === what)) continue
      }
    }

    const link = CONNECT.exec(clause)
    if (link && !HANDLE.test(clause.slice(0, clause.length - link[3]!.length))) {
      // The arrow starts at the target; it points at what's on the board, or at something new.
      const verb = link[1] ? "connects to" : link[2]!.replace(/^(\w+?)(?:es|s)?(\b.*)$/i, (_, v: string, tail: string) => `${v}s${tail}`)
      const existing = resolveOnBoard(link[3]!, handles, target)
      if (!existing) invents = true
      rest.push(`${target} ${verb} ${existing ?? link[3]!.replace(DETERMINER, "a ")}`)
      continue
    }

    const edit = EDIT_VERB.exec(clause)
    if (edit && !HANDLE.test(clause)) {
      // "make it red", "make red", "rename the button to Start": point the edit at its element.
      const pronoun = PRONOUN.exec(clause)
      if (pronoun) {
        rest.push(clause.replace(PRONOUN, target))
        continue
      }
      const after = clause.slice(edit[0].length)
      const named = /^(.+?)\s+(?:to|into|as|red|blue|green|yellow|orange|purple|pink|black|white|gr[ae]y)\b/i.exec(after)
      const part = named ? resolveIn(named[1]!, target, handles) : null
      if (part) rest.push(`${edit[1]} ${part} ${after.slice(named![1]!.length).trim()}`)
      else rest.push(`${edit[1]} ${target} ${after}`)
      continue
    }
    rest.push(clause)
    invents = true
  }
  return { patches, rest: rest.join(". "), command: !invents }
}

/**
 * New parts go inside the target (or next to it, when it can't hold them):
 * top-level nodes of the reading become its children, in the order written.
 */
export function placeInTarget(graph: EntryGraph, target: string, handles: HandleInfo): EntryGraph {
  const info = handles.get(target)
  if (!info) return graph
  const holds = info.container
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      // Connected things sit next to it, not inside it ("link to a pricing page").
      const connected = graph.edges.some((e) => e.from === n.key || e.to === n.key)
      // A page is its own screen: it never goes inside another element.
      if (n.parent !== null || REGISTRY[n.type].lane === "architecture" || connected || n.type === "page") return n
      if (holds || MEDIA.has(n.type)) return { ...n, parent: target }
      // A leaf can't hold parts: put them right after it, in its container.
      return info.parent ? { ...n, parent: info.parent, ...(n.after || n.before ? {} : { after: target }) } : n
    }),
  }
}

/** Every element a (plural) phrase covers: "servers", "all the server" → Server, Server2. */
export function resolveAllOnBoard(phrase: string, handles: HandleInfo, exclude: string | null): string[] {
  const want = words(phrase.replace(DETERMINER, "")).replace(/s$/, "")
  if (!want) return []
  return [...handles.keys()].filter((h) => {
    if (h === exclude) return false
    const label = words(handles.get(h)?.label ?? "").replace(/\d+$/, "").trim()
    const kind = (handles.get(h)?.type ?? "").replace("-", " ")
    return label === want || label.replace(/s$/, "") === want || kind === want || (want === "server" && kind === "service" && /server/.test(label))
  })
}

const UNLINK_CUE =
  /^(?:please\s+)?(?:un-?link|disconnect|decouple|unhook|unwire|detach)\b|\b(?:remove|delete|drop|cut|get rid of)\b.*\b(?:links?|arrows?|connections?|edges?|lines?)\b/i
const LINKISH = "(?:links?|arrows?|connections?|edges?|lines?)"

/**
 * Removing arrows by name, no @ needed: "unlink the contact form from the
 * server", "disconnect the form and the server", "remove the arrows between
 * A and B", "unlink all the contact form to server links" (every server).
 * The clicked target stands in when only one side is named.
 */
export function unlinkByName(text: string, handles: HandleInfo, target: string | null): EntryPatch[] | null {
  if (!UNLINK_CUE.test(text)) return null
  const all = /\ball\b|\bevery\b/i.test(text)
  const body = text
    .replace(/^(?:please\s+)?(?:un-?link|disconnect|decouple|unhook|unwire|detach|remove|delete|drop|cut|get rid of)\s+/i, "")
    .replace(/^(?:all|every)\s+(?:of\s+)?/i, "")
    .replace(new RegExp(`^(?:the\\s+)?${LINKISH}\\s+(?:between|from)\\s+`, "i"), "")
    .replace(new RegExp(`\\s+${LINKISH}$`, "i"), "")
    .trim()
  // "disconnect from server 2" (with a target): the target is the first side.
  const lead = /^(?:from|with|to)\s+(.+)$/i.exec(body)
  const pair = lead ? null : /^(.+?)\s+(?:to|from|and|&|->|→|with)\s+(.+)$/i.exec(body)
  const aPhrase = lead ? "it" : pair ? pair[1]! : body
  const bPhrase = lead ? lead[1]! : pair ? pair[2]! : null
  const a = PRONOUN.test(aPhrase) && target ? target : (resolveOnBoard(aPhrase, handles, "") ?? (bPhrase ? null : target))
  if (!a) return null
  if (!bPhrase || /^(?:everything|anything|all(?: of them)?)$/i.test(bPhrase.trim())) return [{ target: a, unlink: "*" }]
  const bs = all ? resolveAllOnBoard(bPhrase, handles, a) : [resolveOnBoard(bPhrase, handles, a)].filter((h): h is string => !!h)
  if (!bs.length) return null
  return bs.map((b) => ({ target: a, unlink: b }))
}

/**
 * "remove server1", "delete @hero", "remove server1 and server3", "remove all
 * servers": existing elements by name, anywhere on the board. Null when a name
 * matches nothing (then nothing is removed, and nothing new is made from it).
 */
export function removeByName(text: string, handles: HandleInfo): EntryPatch[] | null {
  const m = /^(?:please\s+)?(?:remove|delete|erase|get rid of|take away|trash|ditch|drop)\s+(.+)$/i.exec(text.trim())
  if (!m) return null
  const phrase = m[1]!.replace(/\s+(?:from|off)\s+(?:the\s+)?(?:board|canvas|diagram|page)$/i, "").trim()
  if (/\b(?:links?|arrows?|connections?|edges?|lines?|fields?|inputs?|options?|rows?|items?)\b/i.test(phrase)) return null
  const all = /^(?:all|every|each)\s+(?:of\s+)?(?:the\s+)?(.+)$/i.exec(phrase)
  if (all) {
    const hits = resolveAllOnBoard(all[1]!, handles, null)
    return hits.length ? hits.map((h) => ({ target: h, remove: true })) : null
  }
  const names = phrase.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean)
  const found = names.map((n) => resolveOnBoard(n, handles, ""))
  return found.length && found.every(Boolean) ? found.map((h) => ({ target: h!, remove: true })) : null
}

/**
 * "make cta a left sidebar and footer a right sidebar", "turn the hero into a
 * carousel": existing elements (inside the target first, else anywhere) change
 * kind in place. Null unless every clause names something that exists.
 */
export function retypeByName(text: string, handles: HandleInfo, target: string | null): EntryPatch[] | null {
  const clauses = text.split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean)
  const known = new Set(handles.keys())
  const patches: EntryPatch[] = []
  let verb: string | null = null
  for (const c of clauses) {
    const m = /^(?:(?:please\s+)?(make|turn|change|convert|switch|transform)\s+)?(.+?)\s+(?:(?:into|to)\s+)?(?:a|an)\s+(.+)$/i.exec(c.trim())
    if (!m) return null
    verb = m[1] ?? verb
    // "…and footer a right sidebar" carries the verb over; a clause without any verb isn't a change.
    if (!verb) return null
    const name = m[2]!
    // "make @timer a red clock" is a color change (the color logic reads those), not a new kind.
    if (explicitColor(m[3]!)) return null
    const h = (target ? resolveIn(name, target, handles) : null) ?? resolveOnBoard(name, handles, "")
    if (!h) return null
    const p = editOf(`turn ${h} into a ${m[3]}`, known)
    if (!p?.type) return null
    patches.push(p)
  }
  return patches.length ? patches : null
}

const COLUMNS = /\b(?:(?:2|two)[-\s]?col(?:umn)?s?|side[-\s]by[-\s]side|columns|in a row)\b/i

/**
 * "turn the cta and footer into a 2 column layout, cta on the left and footer
 * on the right": one new two-column row where they were, with both moved into
 * it in the order said. Null unless it names two existing siblings.
 */
export function columnsOf(
  text: string,
  handles: HandleInfo,
  target: string | null,
): { row: EntryGraph["nodes"][number]; patches: EntryPatch[] } | null {
  if (!COLUMNS.test(text)) return null
  const m = /^(?:please\s+)?(?:turn|put|make|arrange|place|lay out|set|split|have)\s+(?:the\s+)?(.+?)\s+(?:and|&)\s+(?:the\s+)?(.+?)\s+(?:into|in|as|side|on)\b/i.exec(text.trim())
  if (!m) return null
  const find = (p: string) => (target ? resolveIn(p, target, handles) : null) ?? resolveOnBoard(p, handles, "")
  let left = find(m[1]!)
  let right = find(m[2]!)
  if (!left || !right || left === right) return null
  const parent = handles.get(left)?.parent ?? null
  if (parent !== (handles.get(right)?.parent ?? null)) return null
  // "cta on the left … footer on the right", or the other way round.
  const on = (h: string, side: string) => {
    const name = words(handles.get(h)?.label ?? h.slice(1))
    return new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:on|to|at|in)\\s+(?:the\\s+)?${side}`, "i").test(words(text))
  }
  if (on(left, "right") || on(right, "left")) [left, right] = [right, left]
  return {
    row: { key: "columns", type: "section", label: "Two columns", parent, props: { layout: "row" }, before: left },
    patches: [
      { target: left, parent: "columns" },
      { target: right, parent: "columns" },
    ],
  }
}
