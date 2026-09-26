/** Per-device identity: a display name and a color, remembered in localStorage. */

export const PALETTE = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"]

export type Identity = { name: string; color: string }

const KEY = "rtw.identity"

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Identity>
    return typeof v.name === "string" && v.name && typeof v.color === "string" ? { name: v.name, color: v.color } : null
  } catch {
    return null
  }
}

export function saveIdentity(id: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id))
  } catch {
    // private mode etc.: identity just won't persist
  }
}

export function randomColor() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]!
}

export function newRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("")
}
