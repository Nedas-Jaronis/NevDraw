/**
 * Read an environment variable, trimmed. A .env saved on Windows has CRLF
 * line endings, which leaves an invisible "\r" on every value (and a 401 on
 * every API call).
 */
export const env = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

export const envNumber = (name: string): number | undefined => {
  const n = Number(env(name))
  return Number.isFinite(n) && n > 0 ? n : undefined
}
