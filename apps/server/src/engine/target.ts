/**
 * Targeted editing: the person clicked an element (the target) and what they
 * type edits it. Removing, moving and changing its parts are commands read
 * here; anything else they describe is added inside it.
 */
import { type EntryGraph, type EntryPatch, REGISTRY } from "@rtw/shared"
import type { HandleInfo } from "./assemble.ts"

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
  return (
    unique(all.filter((h) => label(h) === want)) ??
    unique(all.filter((h) => h.slice(1).replace(/-/g, " ") === want)) ??
    unique(all.filter((h) => label(h).replace(/s$/, "") === singular || kind(h) === singular || (singular === "server" && kind(h) === "service")))
  )
}

/** Split the text into commands on existing parts and a description of new ones. */
export function readTargeted(text: string, target: string, handles: HandleInfo): Targeted {
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
  const pair = /^(.+?)\s+(?:to|from|and|&|->|→|with)\s+(.+)$/i.exec(body)
  const aPhrase = pair ? pair[1]! : body
  const bPhrase = pair ? pair[2]! : null
  const a = PRONOUN.test(aPhrase) && target ? target : (resolveOnBoard(aPhrase, handles, "") ?? (bPhrase ? null : target))
  if (!a) return null
  if (!bPhrase) return [{ target: a, unlink: "*" }]
  const bs = all ? resolveAllOnBoard(bPhrase, handles, a) : [resolveOnBoard(bPhrase, handles, a)].filter((h): h is string => !!h)
  if (!bs.length) return null
  return bs.map((b) => ({ target: a, unlink: b }))
}
