/**
 * Download the parser model named in models/parser.json into models/parser/, checking every
 * file's sha256. Files already there with the right hash are kept, so re-running is cheap.
 *
 *   bun run fetch-model
 *
 * The server loads models/parser/ (or MODEL_DIR); without it, the board runs as before.
 */
import { mkdir, rename } from "node:fs/promises"

type Manifest = { release: string; repo: string; trainedFrom: string; files: { name: string; size: number; sha256: string }[] }

const root = new URL("../", import.meta.url)
const manifest: Manifest = await Bun.file(new URL("models/parser.json", root)).json()
const dir = new URL("models/parser/", root)
await mkdir(dir, { recursive: true })

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

for (const f of manifest.files) {
  const path = new URL(f.name, dir)
  const have = Bun.file(path)
  if ((await have.exists()) && sha256(await have.bytes()) === f.sha256) {
    console.log(`  ok        ${f.name}`)
    continue
  }
  const url = `https://github.com/${manifest.repo}/releases/download/${manifest.release}/${f.name}`
  process.stdout.write(`  download  ${f.name} (${(f.size / 1e6).toFixed(1)} MB) ... `)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (sha256(bytes) !== f.sha256) throw new Error(`${f.name}: checksum mismatch (got ${bytes.length} bytes); not saved`)
  // Write next to it, then rename: a cut-off download never leaves a half file behind.
  const tmp = new URL(`${f.name}.part`, dir)
  await Bun.write(tmp, bytes)
  await rename(tmp, path)
  console.log("done")
}
await Bun.write(new URL("VERSION", dir), `${manifest.release} (${manifest.trainedFrom})\n`)
console.log(`parser ${manifest.release} ready in models/parser/`)
