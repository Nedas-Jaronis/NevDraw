import type { EntryGraph } from "@rtw/shared"
import { keywordAnswers } from "./answers.ts"
import { assemble } from "./assemble.ts"
import { split } from "./split.ts"

export { type DraftMemory, materialize } from "./materialize.ts"

/** Offline interpretation of an entry: split → keyword answers per piece → graph. */
export function interpretOffline(text: string): EntryGraph {
  const pieces = split(text)
  return assemble(pieces, pieces.map(keywordAnswers))
}
