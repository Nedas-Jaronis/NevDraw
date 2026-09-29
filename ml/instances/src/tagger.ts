/**
 * The parser at runtime: ONNX model + tokenizer, in-process, no network.
 *
 *   const tagger = await Tagger.load("runs/ettin32m-links/onnx", { int8: false })
 *   await tagger.tag("a landing page with 3 pricing cards")
 *   // [{start: 2, end: 14, tag: "INSTANCE", confidence: 0.99},
 *   //  {start: 20, end: 21, tag: "COUNT", confidence: 0.99, arcs: [{label: "mod", head: 2, confidence: 0.98}]},
 *   //  {start: 22, end: 35, tag: "INSTANCE", confidence: 0.99, arcs: [{label: "in", head: 0, confidence: 0.97}]}]
 *
 * One model run gives both outputs: a tag per word, and per-token link vectors.
 * Links between the spans the tags produced are dot products of those vectors,
 * decoded with the same rules as decode_links in py/model.py.
 *
 * Token ids are built one word at a time (" " + word), exactly as py/common.py
 * does in training, so spans land on the same word boundaries in both.
 */
import { Tokenizer } from "@huggingface/tokenizers"
import * as ort from "onnxruntime-node"
import type { Link, Span, Tag } from "./markup.ts"
import { type Word, words } from "./words.ts"

type Meta = { labels: string[]; cls: number; sep: number; pad: number; max_len: number; links?: { labels: Link[]; rank: number; bias: number[] } }
export type TaggedArc = { label: Link; head: number; confidence: number }
export type TaggedSpan = Omit<Span, "arcs"> & { confidence: number; arcs?: TaggedArc[] }

/** Links a span can have only one of: it's inside one thing, describes one thing, is one thing. */
const SINGLE_HEAD = new Set<Link>(["mod", "in", "same"])

type Run = { ws: Word[]; firstToken: number[]; logits: Float32Array; dep: Float32Array | null; head: Float32Array | null }

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

  private async run(text: string): Promise<Run | null> {
    const ws = words(text)
    if (ws.length === 0) return null
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
    const out = await this.session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, n]),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]),
    })
    return { ws, firstToken, logits: out.logits!.data as Float32Array, dep: (out.dep?.data as Float32Array) ?? null, head: (out.head?.data as Float32Array) ?? null }
  }

  /** Spans and the links between them. */
  async tag(text: string): Promise<TaggedSpan[]> {
    const r = await this.run(text)
    if (!r) return []
    const spans = this.spans(r)
    this.link(r, spans)
    return spans
  }

  /** Links only, between spans you already have (how eval.ts scores linking on its own). */
  async linkGiven(text: string, spans: readonly Omit<Span, "arcs">[]): Promise<TaggedSpan[]> {
    const r = await this.run(text)
    const out: TaggedSpan[] = spans.map((s) => ({ start: s.start, end: s.end, tag: s.tag, confidence: 1 }))
    if (r) this.link(r, out)
    return out
  }

  private spans({ ws, firstToken, logits }: Run): TaggedSpan[] {
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
      const row = logits.subarray(t * L, t * L + L)
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

  /** Adds `arcs` to spans in place. Pairs whose best label is a link with p ≥ threshold are kept. */
  private link({ ws, firstToken, dep, head }: Run, spans: TaggedSpan[], threshold = 0.5): void {
    const links = this.meta.links
    if (!links || !dep || !head || spans.length < 2) return
    const { labels, rank: r, bias } = links
    const L = labels.length
    const width = L * r
    const wordAt = new Map(ws.map((w, i) => [w.start, i]))
    const pos = spans.map((s) => firstToken[wordAt.get(s.start) ?? -1] ?? -1)
    const scale = 1 / Math.sqrt(r)
    spans.forEach((s, i) => {
      if (pos[i]! < 0) return
      const d = pos[i]! * width
      const best = new Map<Link, TaggedArc>()
      const many: TaggedArc[] = []
      spans.forEach((_, j) => {
        if (i === j || pos[j]! < 0) return
        const h = pos[j]! * width
        // Scores for "none" (0) and each label; softmax; keep the winner if it's a link.
        let top = 0
        let topScore = 0
        const scores = new Array<number>(L)
        for (let l = 0; l < L; l++) {
          let dot = 0
          for (let k = 0; k < r; k++) dot += dep[d + l * r + k]! * head[h + l * r + k]!
          scores[l] = dot * scale + bias[l]!
          if (scores[l]! > topScore) {
            topScore = scores[l]!
            top = l + 1
          }
        }
        if (top === 0) return
        let sum = Math.exp(-topScore)
        for (let l = 0; l < L; l++) sum += Math.exp(scores[l]! - topScore)
        const p = 1 / sum
        if (p < threshold) return
        const arc = { label: labels[top - 1]!, head: j, confidence: p }
        if (!SINGLE_HEAD.has(arc.label)) many.push(arc)
        else if ((best.get(arc.label)?.confidence ?? -1) < p) best.set(arc.label, arc)
      })
      const arcs = [...many, ...best.values()].sort((a, b) => a.head - b.head)
      if (arcs.length) s.arcs = arcs
    })
  }
}
