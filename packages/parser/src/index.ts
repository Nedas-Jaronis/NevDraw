/**
 * The instance parser's runtime: tags and links for typed text, from the ONNX model
 * that ml/instances trains and `bun run fetch-model` downloads into models/parser/.
 */
export * from "./markup.ts"
export { Tagger, type TaggedArc, type TaggedSpan } from "./tagger.ts"
export { type Word, words } from "./words.ts"
