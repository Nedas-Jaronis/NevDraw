import { type ReactNode, useEffect, useRef, useState } from "react"
import { copyPng, EXPORT_SCALES, renderExport, savePdf, savePng } from "./exportImage.ts"

/**
 * Excalidraw's export dialog, for this board: a live preview, "Only
 * selected", "Background", "Dark mode", 1×/2×/3×, then PNG, PDF or copy.
 */
export function ExportDialog(props: { room: string; selected: ReadonlySet<string>; zoom: number; onClose: () => void }) {
  const [onlySelected, setOnlySelected] = useState(props.selected.size > 0)
  const [background, setBackground] = useState(true)
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark")
  const [scale, setScale] = useState(2)
  const [preview, setPreview] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const [busy, setBusy] = useState<null | "png" | "pdf" | "copy">(null)
  const [note, setNote] = useState<string | null>(null)
  const opts = () => ({ only: onlySelected && props.selected.size ? props.selected : null, background, dark, scale })
  const latest = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Re-render the preview (at 1×) when an option changes.
  useEffect(() => {
    const n = ++latest.current
    void renderExport({ ...opts(), scale: 1 }, props.zoom).then((c) => {
      if (n !== latest.current) return
      setEmpty(c === null)
      setPreview(c ? c.toDataURL("image/png") : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlySelected, background, dark])

  const run = async (kind: "png" | "pdf" | "copy") => {
    setBusy(kind)
    setNote(null)
    try {
      const canvas = await renderExport(opts(), props.zoom)
      if (!canvas) return setNote("Nothing to export yet.")
      if (kind === "png") savePng(canvas, props.room)
      else if (kind === "pdf") await savePdf(canvas, props.room, scale)
      else setNote((await copyPng(canvas)) ? "Copied to clipboard." : "This browser can't copy images; use PNG.")
    } catch {
      setNote("Export failed. Try a smaller scale.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-ui className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div
        role="dialog"
        aria-label="Export image"
        className="flex max-h-[90vh] w-[min(760px,100%)] flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-5 shadow-xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[var(--hairline)] p-3"
          style={{
            // A checkerboard shows through when the background is off, like Excalidraw.
            backgroundImage: "repeating-conic-gradient(rgba(127,127,127,0.12) 0% 25%, transparent 0% 50%)",
            backgroundSize: "16px 16px",
          }}
        >
          {preview ? (
            <img src={preview} alt="Export preview" className="max-h-[60vh] max-w-full object-contain shadow-sm" />
          ) : (
            <span className="text-xs text-[var(--muted)]">{empty ? "Nothing on the board yet." : "Rendering…"}</span>
          )}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-3 sm:w-56">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Export image</span>
            <button type="button" aria-label="Close" onClick={props.onClose} className="rounded-md px-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
              ✕
            </button>
          </div>
          {props.selected.size > 0 && (
            <Row label="Only selected">
              <Switch checked={onlySelected} onChange={setOnlySelected} label="Only selected" />
            </Row>
          )}
          <Row label="Background">
            <Switch checked={background} onChange={setBackground} label="Background" />
          </Row>
          <Row label="Dark mode">
            <Switch checked={dark} onChange={setDark} label="Dark mode" />
          </Row>
          <Row label="Scale">
            <div className="flex rounded-lg border border-[var(--panel-border)] p-0.5">
              {EXPORT_SCALES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scale === s}
                  onClick={() => setScale(s)}
                  className={`h-6 w-8 rounded-md text-xs tabular-nums ${scale === s ? "bg-[var(--ink)]/10 font-medium" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </Row>
          <div className="mt-auto flex flex-col gap-3 pt-3">
            <div className="flex gap-2">
              <ActionButton primary busy={busy === "png"} onClick={() => run("png")}>
                PNG
              </ActionButton>
              <ActionButton primary busy={busy === "pdf"} onClick={() => run("pdf")}>
                PDF
              </ActionButton>
            </div>
            <ActionButton wide busy={busy === "copy"} onClick={() => run("copy")}>
              Copy to clipboard
            </ActionButton>
            {note && <span className="pt-0.5 text-center text-[11px] text-[var(--muted)]">{note}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[var(--ink)]" : "bg-[var(--ink)]/15"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--panel)] shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  )
}

function ActionButton(props: { primary?: boolean; wide?: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={props.busy}
      onClick={props.onClick}
      // Side by side the buttons share the row; the wide one takes its own full-height row.
      className={`h-9 shrink-0 rounded-lg text-xs font-medium transition active:scale-[0.98] disabled:opacity-60 ${props.wide ? "w-full" : "flex-1"} ${
        props.primary ? "bg-[var(--ink)] text-[var(--panel)]" : "border border-[var(--panel-border)] hover:bg-[var(--ink)]/5"
      }`}
    >
      {props.busy ? "…" : props.children}
    </button>
  )
}
