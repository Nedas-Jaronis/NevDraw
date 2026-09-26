/** Light / dark / follow the system, remembered per device. */
export type ThemePref = "system" | "light" | "dark"

const KEY = "rtw.theme"
const media = () => window.matchMedia("(prefers-color-scheme: dark)")

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

/** Put the resolved theme on <html> (and remember the choice). */
export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media().matches)
  document.documentElement.dataset.theme = dark ? "dark" : "light"
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
  try {
    if (pref === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // private mode: the choice just isn't remembered
  }
}

/** While on "system", follow the OS as it changes. */
export function followSystem(pref: ThemePref): () => void {
  if (pref !== "system") return () => {}
  const m = media()
  const on = () => applyTheme("system")
  m.addEventListener("change", on)
  return () => m.removeEventListener("change", on)
}
