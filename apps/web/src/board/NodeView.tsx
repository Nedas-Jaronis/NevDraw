import { type BoardNode, REGISTRY } from "@rtw/shared"
import { AnimatePresence, motion } from "motion/react"
import { createContext, type ReactNode, useContext, useState } from "react"
import { BoardActions, downscale, ImageSlot } from "./images.tsx"
import type { Item, Tree } from "./tree.ts"
import { onColor } from "./values.ts"
import { EmptySection, FormCard, sidebarLayout, Wire } from "./wires.tsx"

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
  const actions = useContext(BoardActions)
  const [dropping, setDropping] = useState(false)
  const lit = (hl.handle !== null && node.handle === hl.handle) || dropping
  // Drop a picture on any committed element: images/heroes take it; anything else gets an image inside.
  const canDrop = !draft && actions !== null
  return (
    <div
      data-node-id={node.id}
      onDragOver={(e) => {
        if (!canDrop || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        e.stopPropagation()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!canDrop) return
        e.preventDefault()
        e.stopPropagation()
        setDropping(false)
        const file = e.dataTransfer.files[0]
        if (!file?.type.startsWith("image/")) return
        void downscale(file).then((src) => {
          if (!src) return
          if (node.type === "image" || node.type === "hero") actions.setImage(node.id, src)
          else actions.dropImage(node.id, src)
        })
      }}
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
  if (!isContainer(node)) {
    // Leaves can hold embedded media ("an image in the hero") under their own body.
    const embedded = tree.children.get(node.id) ?? []
    // A hero with a picture embedded in it IS that picture: one big drop-in image under its title,
    // no placeholder headline or "Get started", and no second frame around the image.
    const picture = node.type === "hero" ? embedded.find((k) => k.node.type === "image") : undefined
    if (picture) {
      const rest = embedded.filter((k) => k !== picture)
      return (
        <div>
          <Title node={node} showAuthor={showAuthor} compact={compact} />
          <ImageSlot
            id={picture.node.id}
            src={picture.node.props.src}
            editable={!picture.draft}
            className={`mt-2.5 h-40 bg-[var(--a)]/10 ${picture.draft ? "outline-dashed outline-1 outline-[var(--muted)]" : ""}`}
          >
            {!picture.node.props.src && (
              <svg viewBox="0 0 100 50" className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
                <path d="M0 50 L30 22 L50 38 L70 18 L100 50 Z" fill="var(--a)" fillOpacity="0.25" />
                <circle cx="78" cy="12" r="5" fill="var(--a)" fillOpacity="0.35" />
              </svg>
            )}
          </ImageSlot>
          {rest.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {rest.map((k) => (
                  <ChildView key={k.node.id} item={k} tree={tree} compact={false} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )
    }
    return (
      <div>
        <Wire node={node} showAuthor={showAuthor} compact={compact} draft={draft} />
        {embedded.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {embedded.map((k) => (
                <ChildView key={k.node.id} item={k} tree={tree} compact={false} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    )
  }
  const layout = node.props.layout ?? "stack"

  const kids = tree.children.get(node.id) ?? []
  // An empty form or modal is a finished dialog (a signup form looks like a signup modal).
  if (kids.length === 0 && (node.type === "form" || node.type === "modal"))
    return (
      <div>
        <Title node={node} showAuthor={showAuthor} compact={compact} />
        <div className="mt-2.5">
          <FormCard node={node} />
        </div>
      </div>
    )
  // A page with a sidebar: header on top, sidebar beside the main column, footer at the bottom.
  const sided = layout === "stack" ? sidebarLayout(kids) : null
  if (sided) {
    const column = (items: readonly Item[], narrow = false) => (
      <AnimatePresence initial={false}>
        {items.map((k) => (
          <ChildView key={k.node.id} item={k} tree={tree} compact={narrow} />
        ))}
      </AnimatePresence>
    )
    return (
      <div>
        <Title node={node} showAuthor={showAuthor} compact={compact} />
        <div className="mt-2.5 flex flex-col gap-2">
          {column(sided.top)}
          <div className="flex items-stretch gap-2">
            <div className="w-[34%] shrink-0 [&>*]:h-full">{column([sided.side], true)}</div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">{column(sided.main)}</div>
          </div>
          {column(sided.bottom)}
        </div>
      </div>
    )
  }
  return (
    <div>
      <Title node={node} showAuthor={showAuthor} compact={compact} />
      <div className={`mt-2.5 ${LAYOUT_CLASS[layout]}`}>
        <AnimatePresence initial={false}>
          {kids.map((k) => (
            <ChildView key={k.node.id} item={k} tree={tree} compact={layout !== "stack"} />
          ))}
        </AnimatePresence>
        {kids.length === 0 && <EmptySection node={node} />}
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

/** The @handle: click it to retag the element (Enter saves, Esc cancels). */
function HandleTag({ id, handle }: { id: string; handle: string }) {
  const actions = useContext(BoardActions)
  const [editing, setEditing] = useState<string | null>(null)
  if (editing === null)
    return (
      <button
        type="button"
        data-ui
        title="Rename this tag"
        onClick={(e) => {
          e.stopPropagation()
          if (actions) setEditing(handle)
        }}
        className="frame-handle shrink-0 rounded px-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
      >
        {handle}
      </button>
    )
  const save = () => {
    if (editing.trim() && editing.trim() !== handle) actions?.renameHandle(id, editing)
    setEditing(null)
  }
  return (
    <input
      data-ui
      autoFocus
      value={editing}
      aria-label="New tag"
      onChange={(e) => setEditing(e.target.value.startsWith("@") ? e.target.value : `@${e.target.value}`)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") save()
        else if (e.key === "Escape") setEditing(null)
      }}
      onBlur={save}
      className="frame-handle is-editing w-32 shrink-0 rounded border border-[var(--hairline)] bg-[var(--panel)] px-1 text-[11px] text-[var(--ink)] outline-none"
    />
  )
}

export function Title({ node, showAuthor, compact }: { node: BoardNode; showAuthor: boolean; compact?: boolean }) {
  const tag = compact ? null : typeTag(node)
  const actions = useContext(BoardActions)
  const note = node.props.note
  /** Per viewer: whether this element's note is open. */
  const [open, setOpen] = useState(false)
  const canNote = actions !== null && node.handle !== undefined
  return (
    <>
      <div className="frame-title flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</span>
        {node.handle && <HandleTag id={node.id} handle={node.handle} />}
        {tag && <span className="frame-type shrink-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">{tag}</span>}
        {canNote && (
          <button
            type="button"
            data-ui
            title={open ? "Hide note" : note ? "Show note" : "Add a note"}
            aria-label={open ? "Hide note" : note ? "Show note" : "Add a note"}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
            className={`${note ? "" : "frame-note-add"} shrink-0 rounded p-0.5 transition hover:bg-[var(--ink)]/5 ${note ? "text-amber-500" : "text-[var(--muted)]"}`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
              <path d="M3 2.5h10v8l-3 3H3z" fill={note ? "currentColor" : "none"} fillOpacity={note ? 0.2 : 0} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M5.5 6h5M5.5 8.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {showAuthor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: node.authorColor }} />}
      </div>
      {canNote && open && <NoteEditor id={node.id} note={note ?? ""} onClose={() => setOpen(false)} />}
      {canNote && !open && note && (
        <button
          type="button"
          data-ui
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
          className="mt-1.5 block w-full truncate rounded-md bg-amber-400/10 px-2 py-1 text-left text-[11px] text-amber-700 dark:text-amber-300"
        >
          {note.split("\n")[0]}
        </button>
      )}
    </>
  )
}

/** The open note: edit in place; saves on blur or ⌘/Ctrl+Enter, Esc minimizes. */
function NoteEditor({ id, note, onClose }: { id: string; note: string; onClose: () => void }) {
  const actions = useContext(BoardActions)
  const [text, setText] = useState(note)
  const save = () => {
    if (text.trim() !== note.trim()) actions?.setNote(id, text)
  }
  return (
    <div data-ui className="mt-1.5 rounded-md bg-amber-400/10 p-1.5" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        data-ui
        autoFocus
        value={text}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        placeholder="Add a note for your team…"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
            save()
            onClose()
          }
        }}
        className="w-full resize-none bg-transparent text-[11px] leading-snug text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
      />
      <div className="flex items-center justify-end gap-2 text-[10px] text-[var(--muted)]">
        {note && (
          <button
            type="button"
            data-ui
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              actions?.setNote(id, "")
              setText("")
              onClose()
            }}
            className="hover:text-[var(--ink)]"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          data-ui
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            save()
            onClose()
          }}
          className="hover:text-[var(--ink)]"
        >
          Minimize
        </button>
      </div>
    </div>
  )
}
