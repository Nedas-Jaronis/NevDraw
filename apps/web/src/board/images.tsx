import { isImageSrc, MAX_IMAGE_SRC } from "@rtw/shared"
import { createContext, type ReactNode, useContext, useRef, useState } from "react"

/** Board-level actions components can call (provided by the Board). */
export const BoardActions = createContext<{
  setImage: (id: string, src: string | null) => void
  /** A picture dropped on an element that isn't an image: add an image inside it. */
  dropImage: (parent: string, src: string) => void
  /** Retag an element with a new @handle. */
  renameHandle: (id: string, handle: string) => void
  /** Annotate an element ("" removes the note). */
  setNote: (id: string, note: string) => void
} | null>(null)

/** Shrink a picked file to a data-URL that fits the sync limit. */
export async function downscale(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  for (const [max, quality] of [
    [960, 0.82],
    [720, 0.75],
    [520, 0.7],
    [360, 0.65],
  ] as const) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL("image/jpeg", quality)
    if (url.length <= MAX_IMAGE_SRC) return url
  }
  return null
}

/**
 * A spot people can put their own picture into: click Upload / Link, or drop
 * a file. Only committed elements (the picture is shared and saved).
 */
export function ImageSlot(props: { id: string; src: string | undefined; editable: boolean; className?: string; children?: ReactNode }) {
  const actions = useContext(BoardActions)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const put = (src: string | null) => actions?.setImage(props.id, src)
  const take = async (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return
    setBusy(true)
    const url = await downscale(f)
    setBusy(false)
    if (url) put(url)
  }
  const editable = props.editable && actions !== null
  return (
    <div
      className={`group/img relative overflow-hidden rounded-md ${over ? "ring-2 ring-[var(--a)]" : ""} ${props.className ?? ""}`}
      onDragOver={(e) => {
        if (!editable) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editable) return
        e.preventDefault()
        e.stopPropagation() // the frame around it would take the same drop
        setOver(false)
        void take(e.dataTransfer.files[0])
      }}
    >
      {props.src ? <img src={props.src} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} /> : null}
      <div className="relative">{props.children}</div>
      {editable && (
        <div
          data-ui
          data-export-hide
          className={`absolute right-1.5 top-1.5 flex gap-1 transition-opacity ${props.src ? "opacity-0 group-hover/img:opacity-100" : "opacity-90"}`}
        >
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="rounded-full bg-[var(--panel)]/90 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur"
          >
            {busy ? "…" : props.src ? "Replace" : "Upload"}
          </button>
          <button
            type="button"
            onClick={() => {
              const url = window.prompt("Image link (https://…)")?.trim()
              if (url && isImageSrc(url)) put(url)
            }}
            className="rounded-full bg-[var(--panel)]/90 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur"
          >
            Link
          </button>
          {props.src && (
            <button type="button" aria-label="Remove image" onClick={() => put(null)} className="rounded-full bg-[var(--panel)]/90 px-1.5 py-0.5 text-[10px] shadow-sm">
              ✕
            </button>
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void take(e.target.files?.[0])} />
        </div>
      )}
    </div>
  )
}
