/** @handles: readable, unique, permanent names for committed elements. */

/** An @handle token as it appears in text. */
export const HANDLE_TOKEN = /@[a-z0-9][a-z0-9-]*/gi

export function slug(label: string, fallback: string): string {
  const s = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "")
  return s || fallback
}

/** "@landing-page", or "@landing-page-2" when taken. */
export function uniqueHandle(label: string, fallback: string, taken: ReadonlySet<string>): string {
  const base = `@${slug(label, fallback)}`
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}
