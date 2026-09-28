/**
 * The instance tagger at runtime: ONNX model + tokenizer, in-process, no network.
 *
 *   const tagger = await Tagger.load("runs/ettin-encoder-32m/onnx")
 *   tagger.tag("a landing page with 3 pricing cards")
 *   // [{start: 2, end: 14, tag: "INSTANCE", confidence: 0.99}, ...]
 *
 * Token ids are built one word at a time (" " + word), exactly as py/common.py
 * does in training, so spans land on the same word boundaries in both.
 */
import { Tokenizer } from "@huggingface/tokenizers"
import * as ort from "onnxruntime-node"
import type { Span, Tag } from "./markup.ts"
import { words } from "./words.ts"

type Meta = { labels: string[]; cls: number; sep: number; pad: number; max_len: number }
export type TaggedSpan = Span & { confidence: number }

export class Tagger {
  private cache = new Map<string, number[]>()

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly meta: Meta,
  ) {}

  static async load(dir: string, opts: { int8?: boolean; threads?: number } = {}): Promise<Tagger> {
    const file = opts.int8 === false ? "model.onnx" : "model.int8.onnx"
    const session = await ort.InferenceSession.create(`${dir}/${file}`, {
      intraOpNumThreads: opts.threads ?? 2,
      graphOptimizationLevel: "all",
    })
    const config = await Bun.file(`${dir}/tokenizer_config.json`).json().catch(() => ({}))
    const tokenizer = new Tokenizer(await Bun.file(`${dir}/tokenizer.json`).json(), config)
    return new Tagger(session, tokenizer, await Bun.file(`${dir}/tagger.json`).json())
  }

  /** Token ids for one word, as training built them. Cached: the vocabulary of commands is small. */
  wordIds(word: string): number[] {
    let ids = this.cache.get(word)
    if (!ids) {
      ids = this.tokenizer.encode(" " + word, { add_special_tokens: false }).ids
      if (this.cache.size > 50_000) this.cache.clear()
      this.cache.set(word, ids)
    }
    return ids
  }

  async tag(text: string): Promise<TaggedSpan[]> {
    const ws = words(text)
    if (ws.length === 0) return []
    const ids = [this.meta.cls]
    const firstToken: number[] = []
    for (const w of ws) {
      const piece = this.wordIds(text.slice(w.start, w.end))
      if (ids.length + piece.length >= this.meta.max_len) break
      firstToken.push(ids.length)
      ids.push(...piece)
    }
    ids.push(this.meta.sep)

    const n = ids.length
    const feeds = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, n]),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]),
    }
    const { logits } = await this.session.run(feeds)
    const data = logits!.data as Float32Array
    const L = this.meta.labels.length

    const spans: TaggedSpan[] = []
    let open: TaggedSpan | null = null
    let probs: number[] = []
    const close = () => {
      if (open) open.confidence = Math.min(...probs)
      open = null
      probs = []
    }
    firstToken.forEach((t, i) => {
      const row = data.subarray(t * L, t * L + L)
      let best = 0
      for (let k = 1; k < L; k++) if (row[k]! > row[best]!) best = k
      const max = row[best]!
      let sum = 0
      for (let k = 0; k < L; k++) sum += Math.exp(row[k]! - max)
      const p = 1 / sum
      const label = this.meta.labels[best]!
      const w = ws[i]!
      if (label === "O") return close()
      const [prefix, tag] = label.split("-") as ["B" | "I", Tag]
      if (prefix === "I" && open !== null && (open as TaggedSpan).tag === tag) {
        ;(open as TaggedSpan).end = w.end
        probs.push(p)
        return
      }
      close()
      open = { start: w.start, end: w.end, tag, confidence: p }
      probs = [p]
      spans.push(open)
    })
    close()
    return spans
  }
}
