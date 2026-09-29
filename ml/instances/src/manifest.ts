/**
 * Write models/parser.json for a release: which files the server needs, their sizes and sha256.
 *
 *   bun src/manifest.ts runs/ettin32m-backrefs/onnx parser-v1
 *
 * Then upload those files to the GitHub release named in the manifest
 * (gh release create parser-v1 <files...>) and commit the manifest.
 * `bun run fetch-model` at the repo root downloads and checks them.
 */
import { basename } from "node:path"

const [dir, release] = process.argv.slice(2)
if (!dir || !release) throw new Error("usage: bun src/manifest.ts <runs/NAME/onnx> <release tag, e.g. parser-v1>")

/** What Tagger.load(dir, { int8: false }) reads, plus the tokenizer check. */
const FILES = ["model.onnx", "tokenizer.json", "tokenizer_config.json", "tagger.json", "wordcheck.json"]

const files = []
for (const name of FILES) {
  const bytes = await Bun.file(`${dir}/${name}`).bytes()
  files.push({ name, size: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") })
}
const manifest = {
  release,
  repo: "Nedas-Jaronis/NevDraw",
  trainedFrom: basename(dir.replace(/\/onnx\/?$/, "")),
  files,
}
const out = new URL("../../../models/parser.json", import.meta.url)
await Bun.write(out, JSON.stringify(manifest, null, 2) + "\n")
console.log(`wrote ${out.pathname}: ${files.map((f) => `${f.name} ${(f.size / 1e6).toFixed(1)} MB`).join(", ")}`)
