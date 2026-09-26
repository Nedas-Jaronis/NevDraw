import type { BoardNode, Draft, Point, User } from "@rtw/shared"
import { REGISTRY } from "@rtw/shared"
import { classifyKeywords, labelFrom } from "./classify/keywords.ts"

export const DEFAULT_NODE_SIZE = { w: 240, h: 96 }

/**
 * Interpret a user's input as a draft. For now one entry = one element; the
 * draft keeps its node id and position across keystrokes so it never jumps.
 */
export function buildDraft(input: { text: string; anchor: Point; user: User; prev: Draft | undefined; newId: () => string }): Draft {
  const { text, anchor, user, prev } = input
  const guess = classifyKeywords(text)
  const prevNode = prev?.nodes[0]
  const node: BoardNode = {
    id: prevNode?.id ?? input.newId(),
    type: guess.type,
    label: labelFrom(text),
    parent: null,
    props: { layout: REGISTRY[guess.type].defaultLayout },
    x: prevNode?.x ?? Math.round(anchor.x - DEFAULT_NODE_SIZE.w / 2),
    y: prevNode?.y ?? Math.round(anchor.y - DEFAULT_NODE_SIZE.h / 2),
    pinned: false,
    authorId: user.id,
    authorColor: user.color,
  }
  return { userId: user.id, text, nodes: [node] }
}
