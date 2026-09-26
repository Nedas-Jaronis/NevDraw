import { type BoardNode, REGISTRY } from "@rtw/shared"
import { AnimatePresence, motion } from "motion/react"
import { createContext, type ReactNode, useContext } from "react"
import type { Item, Tree } from "./tree.ts"
import { onColor } from "./values.ts"
import { Wire } from "./wires.tsx"

export const CONTAINER_WIDTH = 320
export const LEAF_WIDTH = 240

const spring = { type: "spring", stiffness: 420, damping: 36 } as const

/** The @handle being pointed at (autocomplete / reference chips): its element glows. */
export const HighlightContext = createContext<{ handle: string | null; color: string }>({ handle: null, color: "#000" })

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
  /** The ✕ on the element (only when it's the one selected; several use the toolbar). */
  showDelete: boolean
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
          {props.showDelete && (
          <button
            type="button"
            data-ui
            aria-label={`Delete ${node.label}`}
            onClick={props.onDelete}
            className="absolute -right-3 -top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--panel)] text-xs text-[var(--muted)] shadow-sm hover:text-[var(--ink)]"
          >
            ✕
          </button>
          )}
        </>
      )}
      {typing && (
        <div className="pointer-events-none absolute -top-6 left-1 max-w-[340px] truncate text-xs" style={{ color: node.authorColor }}>
          {typing}
        </div>
      )}
      <Frame node={node} draft={draft} root selected={selected}>
        <Body item={item} tree={tree} />
      </Frame>
    </motion.div>
  )
}

/**
 * A nested element, laid out by its parent's CSS flow. It fades in and out but
 * never uses Motion's `layout` animation: that measures in screen space and
 * ignores the board's zoom transform, so at any zoom other than 100% nested
 * elements "flew" in and out on every click and re-render.
 */
function ChildView({ item, tree, compact }: { item: Item; tree: Tree; compact: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.16 }}
      className="min-w-0"
    >
      <Frame node={item.node} draft={item.draft}>
        <Body item={item} tree={tree} compact={compact} />
      </Frame>
    </motion.div>
  )
}

function Frame(props: { node: BoardNode; draft: boolean; root?: boolean; selected?: boolean; children: ReactNode }) {
  const { node, draft, root } = props
  const hl = useContext(HighlightContext)
  const lit = hl.handle !== null && node.handle === hl.handle
  return (
    <div
      data-node-id={node.id}
      className={`frame transition-shadow ${props.selected ? "is-selected" : ""} ${
        root
          ? "rounded-2xl bg-[var(--panel)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.14)]"
          : "rounded-xl bg-[var(--surface)] p-2.5"
      }`}
      style={{
        // An element's accent (from the prompt) colors it and everything inside it.
        ...(node.props.color
          ? ({
              "--a": node.props.color,
              "--on-a": onColor(node.props.color),
              // A colored element is visibly that color: tinted surface, colored hairline.
              background: `color-mix(in srgb, ${node.props.color} 9%, ${root ? "var(--panel)" : "var(--surface)"})`,
            } as React.CSSProperties)
          : {}),
        border: draft
          ? `1.5px dashed ${node.authorColor}`
          : node.props.color
            ? `1px solid color-mix(in srgb, ${node.props.color} 55%, transparent)`
            : "1px solid var(--hairline)",
        ...(lit ? { boxShadow: `0 0 0 3px color-mix(in srgb, ${hl.color} 35%, transparent)` } : {}),
      }}
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

function Body({ item, tree, compact = false }: { item: Item; tree: Tree; compact?: boolean }) {
  const { node, draft } = item
  const showAuthor = !draft && node.parent === null
  if (!isContainer(node)) return <Wire node={node} showAuthor={showAuthor} compact={compact} draft={draft} />
  const layout = node.props.layout ?? "stack"

  const kids = tree.children.get(node.id) ?? []
  return (
    <div>
      <Title node={node} showAuthor={showAuthor} compact={compact} />
      <div className={`mt-2.5 ${LAYOUT_CLASS[layout]}`}>
        <AnimatePresence initial={false}>
          {kids.map((k) => (
            <ChildView key={k.node.id} item={k} tree={tree} compact={layout !== "stack"} />
          ))}
        </AnimatePresence>
        {kids.length === 0 && <div className="h-16 rounded-lg border border-dashed border-[var(--hairline)]" />}
      </div>
    </div>
  )
}

/**
 * The type tag only when it adds something: not when the label already says
 * it ("Navbar", "25 min stop watch"), not for the catch-all, and not in
 * narrow row/grid cells.
 */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "")
const typeTag = (n: BoardNode) => (n.type === "box" || squash(n.label).includes(squash(n.type)) ? null : n.type.replace("-", " "))

export function Title({ node, showAuthor, compact }: { node: BoardNode; showAuthor: boolean; compact?: boolean }) {
  const tag = compact ? null : typeTag(node)
  return (
    <div className="frame-title flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</span>
      {node.handle && <span className="frame-handle shrink-0 text-[11px] text-[var(--muted)]">{node.handle}</span>}
      {tag && <span className="frame-type shrink-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">{tag}</span>}
      {showAuthor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: node.authorColor }} />}
    </div>
  )
}
