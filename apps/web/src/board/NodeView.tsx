import { type BoardNode, REGISTRY } from "@rtw/shared"
import { AnimatePresence, motion } from "motion/react"
import type { ReactNode } from "react"
import type { Item, Tree } from "./tree.ts"
import { Wire } from "./wires.tsx"

export const CONTAINER_WIDTH = 320
export const LEAF_WIDTH = 240

const spring = { type: "spring", stiffness: 420, damping: 36 } as const

const isContainer = (n: BoardNode) => REGISTRY[n.type].container

/**
 * A top-level element, absolutely positioned on the board. Drafts render
 * dashed in the author's color; committed elements are calm and solid. The
 * same id is kept across draft → commit so Motion animates it in place.
 */
export function RootView(props: {
  item: Item
  tree: Tree
  selected: boolean
  dragging: boolean
  /** This viewer's color, for the selection ring. */
  accent: string
  onDelete: () => void
}) {
  const { item, tree, selected, dragging, accent } = props
  const { node, draft, typing } = item
  return (
    <motion.div
      data-root-id={draft ? undefined : node.id}
      initial={{ opacity: 0, scale: 0.94, x: node.x, y: node.y }}
      animate={{ opacity: 1, scale: dragging ? 1.01 : 1, x: node.x, y: node.y }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
      // The dragger's own element tracks the pointer exactly; everyone else's glides.
      transition={dragging ? { duration: 0 } : spring}
      className={`absolute left-0 top-0 ${draft ? "" : "cursor-grab active:cursor-grabbing"}`}
      style={{ width: isContainer(node) ? CONTAINER_WIDTH : LEAF_WIDTH, zIndex: dragging || selected ? 10 : undefined }}
    >
      {selected && (
        <>
          <div className="pointer-events-none absolute -inset-1.5 rounded-[20px]" style={{ boxShadow: `0 0 0 1.5px ${accent}` }} />
          <button
            type="button"
            data-ui
            aria-label={`Delete ${node.label}`}
            onClick={props.onDelete}
            className="absolute -right-3 -top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--panel)] text-xs text-[var(--muted)] shadow-sm hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </>
      )}
      {typing && (
        <div className="pointer-events-none absolute -top-6 left-1 max-w-[340px] truncate text-xs" style={{ color: node.authorColor }}>
          {typing}
        </div>
      )}
      <Frame node={node} draft={draft} root>
        <Body item={item} tree={tree} />
      </Frame>
    </motion.div>
  )
}

/** A nested element: laid out by its parent's CSS flow, animated on reflow. */
function ChildView({ item, tree }: { item: Item; tree: Tree }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
      transition={spring}
      className="min-w-0"
    >
      <Frame node={item.node} draft={item.draft}>
        <Body item={item} tree={tree} />
      </Frame>
    </motion.div>
  )
}

function Frame(props: { node: BoardNode; draft: boolean; root?: boolean; children: ReactNode }) {
  const { node, draft, root } = props
  return (
    <div
      className={
        root
          ? "rounded-2xl bg-[var(--panel)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.14)]"
          : "rounded-xl bg-[var(--surface)] p-2.5"
      }
      style={{ border: draft ? `1.5px dashed ${node.authorColor}` : "1px solid var(--hairline)" }}
    >
      {props.children}
    </div>
  )
}

const LAYOUT_CLASS = {
  stack: "flex flex-col gap-2",
  row: "flex flex-row gap-2 [&>*]:flex-1",
  grid: "grid grid-cols-2 gap-2",
} as const

function Body({ item, tree }: { item: Item; tree: Tree }) {
  const { node, draft } = item
  const showAuthor = !draft && node.parent === null
  if (!isContainer(node)) return <Wire node={node} showAuthor={showAuthor} />

  const kids = tree.children.get(node.id) ?? []
  return (
    <div>
      <Title node={node} showAuthor={showAuthor} />
      <div className={`mt-2.5 ${LAYOUT_CLASS[node.props.layout ?? "stack"]}`}>
        <AnimatePresence initial={false}>
          {kids.map((k) => (
            <ChildView key={k.node.id} item={k} tree={tree} />
          ))}
        </AnimatePresence>
        {kids.length === 0 && <div className="h-16 rounded-lg border border-dashed border-[var(--hairline)]" />}
      </div>
    </div>
  )
}

/** The type tag only when the label doesn't already say it ("Navbar" doesn't need "NAVBAR"). */
const typeTag = (n: BoardNode) => (n.label.toLowerCase().includes(n.type.replace("-", " ")) ? null : n.type)

export function Title({ node, showAuthor }: { node: BoardNode; showAuthor: boolean }) {
  const tag = typeTag(node)
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</span>
      {tag && <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">{tag}</span>}
      {showAuthor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: node.authorColor }} />}
    </div>
  )
}
