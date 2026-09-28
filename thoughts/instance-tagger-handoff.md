# Handoff: replacing hand-written input parsing with a fast instance tagger

Status on 2026-09-28. Branch `claude/input-parsing-finetuning-3nzsoe`. The kit is in
[`ml/instances/`](../ml/instances/README.md). Nothing is wired into the server yet.

## The problem

Typed input becomes board actions through about 2,300 lines of substring and regex
parsing in `apps/server/src/engine`:

- `split.ts` cuts the text into pieces.
- `assemble.ts`, `modifiers.ts`, `edits.ts`, `target.ts` and `items.ts` pull out counts, labels, names, colors and items.
- `index.ts` `interpret` tries each command in a fixed order: note → detach → unlink → remove → move → columns → retype → list-edit → targeted.

Jev (`classify/Jev.ts`, `jevQuestions.ts`) only classifies pieces that the code has
already cut out. The gpt-oss pass (`refine/`) cleans up afterwards.

Every new phrasing means another regex with its own ordering problems, which won't
keep up long term.

**Goal:** a model decides which words are instances (and references, counts and so on),
as fast as Jev or Laya or faster, with no per-call cost.

## What we looked at

### Laya ([NandhaKishorM/laya](https://github.com/NandhaKishorM/laya))

- **What it is:** an encoder (ModernBERT or mmBERT, 322–421M parameters) that answers typed
  `choice` / `score` / `noul` (yes/no) questions in a single pass. That takes about 33 ms
  on a T4, against 236–276 ms published for Jev. Apache 2.0.
- **Drop-in for Jev's API:** `laya-serve` exposes the same `POST /v1/systemone` endpoint.
- **Near chance until fine-tuned:** zero-shot it scores 0.36 on their benchmark, where random
  is 0.32. Fine-tuned it reaches 0.766, against Jev's published 0.727.
- **Documented weaknesses:**
  - yes/no answers can follow the option labels instead of the text
  - negation is weak (it picked `cancel_account` for requests that said not to cancel)
  - accuracy drops with more than about 20 options
- **Can't extract spans.** `laya/structured.py` rejects free strings outright. It only ever
  picks from options you give it, so it can't find or extract the words.

### Span taggers (the right kind of model for "which words are instances")

Research summary. Hugging Face was blocked in the cloud session, so licences and details
come from GitHub READMEs, npm and search results.

| Option | CPU latency | Notes |
|---|---|---|
| **Fine-tuned Ettin-32m tagger** | **~4–12 ms** | Recommended for production. MIT (unverified), 32 MB in 8-bit, trains in minutes |
| MiniLM / Ettin-17m tagger | ~3 ms | Fastest; a few points less accurate (unverified) |
| `knowledgator/gliner-bi-edge-v2.0` | ~6–12 ms | Best GLiNER within budget. No training needed, Apache-2.0. No JavaScript runtime supports it yet (~100 lines of our own decoding) |
| `urchade/gliner_small-v2.1` | ~16 ms, p95 ~44 ms | Works in JavaScript today (`@lmoe/gliner-onnx`). Borderline on speed |
| GLiNER2 / GLiNER2.5 / GLiNER-relex | 20–70+ ms | Also extract relations; over budget |
| Avoid | | GLiNER v1 and `gliner_base` (CC-BY-NC), GLiREL (CC BY-NC-SA), NuExtract (generative, far too slow), gliner-x (licence unclear) |

Measured latency: model only, random weights, 4-CPU cloud container. It's noisy there, with
p95 about 2–3× the median.

| Model shape (used by) | Params | 8-bit, 32–48 tokens |
|---|---|---|
| MiniLM-L6 | 23M | ~3 ms |
| Ettin-32m | 32M | ~4–6 ms |
| DeBERTa-v3-small (gliner_small) | 141M | 11–16 ms |
| ModernBERT-base (Laya family) | 149M | 26–32 ms |
| DeBERTa-v3-base (GLiNER medium, GLiNER2) | 184M | 26–48 ms |
| DeBERTa-v3-large (GLiNER large, NuNER Zero) | 434M | 71–114 ms |

`onnxruntime-node` 1.30 runs under Bun 1.3.11. Reproduce these numbers with
`python bench/encoder_latency.py`.

## Decisions

1. **Production model: a fine-tuned Ettin-32m word tagger**, run inside the Bun server
   with `onnxruntime-node` and `@huggingface/tokenizers` (pure JS, no dependencies).
   The tag set is fixed, so GLiNER's ability to find any label with no training earns
   little in production.
2. **GLiNER is for data, not production.** It pre-labels generated commands for people to
   correct, and gives a baseline score.
3. **Don't run Laya as a service.**
   - It needs a Python GPU server plus a network hop.
   - It's near random on our questions until fine-tuned.
   - Its docs admit it's weak on negation ("don't connect", "remove").
4. **Keep Jev for now,** as the working classifier and a data labeller alongside gpt-oss.
   End state: one small encoder with two outputs. It tags the spans and also answers the
   per-instance questions Jev handles today (`nodeType`, `layout`, `isContainer`,
   `edgeKind`, `accent`), in about 10 ms. Jev then becomes the fallback when confidence is
   low, and can be removed once the gold set shows the model is as good.
5. **Don't expect 100% accuracy.** The model ships behind a confidence threshold with
   today's parser as the fallback, so it never makes things worse.

## The tags

INSTANCE (a thing to create), REF (already on the board: `@x`, `{x}`, it / them, `the X`),
COUNT, RELATION (a verb linking two things), ACTION (an edit verb), ATTR (color, size,
layout, sequence, position), NAME (a name or value given in the text). Full rules are in
the README and at the top of `data/gold.txt`.

```
a [landing page](INSTANCE) with a [navbar](INSTANCE), [three](COUNT) [pricing cards](INSTANCE)
[api server](INSTANCE) [writes to](RELATION) [@postgres](REF) and [publishes to](RELATION) a [queue](INSTANCE)
```

## What's built (`ml/instances/`)

- `data/gold.txt`: 141 real phrases from the tests and `arrows.ts`, labelled by hand.
  Held out, never trained on. The labels are one person's judgement; review them.
- `src/generate.ts`: 20,000 seeded synthetic examples from the registry. Skips gold sentences.
- `py/train.py`: fine-tuning, default `jhu-clsp/ettin-encoder-32m`. `--smoke` runs a tiny
  model on CPU with no downloads.
- `py/export.py`: ONNX fp32 and 8-bit, plus the tokenizer and a token-id check file.
- `py/zero_shot.py`: GLiNER baselines, accuracy plus CPU latency.
- `src/tagger.ts`: the runtime. `Tagger.load(dir)`, then `tag(text)` returns spans with a confidence.
- `src/eval.ts`: scores the gold set and measures latency under Bun. It checks first that
  the Bun tokenizer matches Python's.
- `bench/encoder_latency.py`: the speed table above.

**How it keeps Python and Bun in step:** the model tags whole words, and both sides build
token IDs one word at a time (`" " + word`). The word splitter is duplicated in
`py/common.py` and `src/words.ts` and must stay identical.

**Smoke-test result** (0.7M parameters from scratch, CPU, 2 minutes):

| | |
|---|---|
| Gold F1 | 0.83 |
| Sentences entirely right | 67% |
| Latency under Bun | 0.3 ms |

Python and Bun 8-bit gave identical scores. This is the floor a pretrained model should beat.

## Not verified yet (needs Hugging Face access, so do it on the laptop)

- Real GLiNER and Ettin accuracy on gold.
- That `@huggingface/tokenizers` matches the Ettin/ModernBERT tokenizer. `eval.ts` checks
  this and stops if it doesn't.
- Ettin's licence (MIT per its GitHub, not checked on the model card).

## Next steps

1. **On the laptop (RTX 4070):** follow `ml/instances/README.md`.
   ```bash
   cd ml/instances && bun install && bun run generate
   python -m venv .venv    # then activate it
   pip install torch --index-url https://download.pytorch.org/whl/cu128
   pip install -r py/requirements.txt
   python py/zero_shot.py                               # GLiNER baselines
   python py/train.py                                   # Ettin-32m
   python py/export.py runs/ettin-encoder-32m
   bun src/eval.ts runs/ettin-encoder-32m/onnx --errors
   ```
   Keep `runs/zero_shot.json`, `runs/*/metrics.json`, `runs/*/gold_errors.txt` and the
   `eval.ts` output.
2. **Pick the model and confidence threshold from those numbers.** If Ettin-32m is short on
   gold, try `--model jhu-clsp/ettin-encoder-68m`.
3. **Better data.**
   - Turn gold misses into general templates or vocabulary in `generate.ts`; never copy
     gold sentences into training.
   - Add a few thousand real or LLM-written commands, labelled by gpt-oss or GLiNER and
     corrected by a person.
   - Add real bad cases from the app to gold.
4. **Wire it in.**
   - Load `Tagger` once in the server.
   - In `interpret` (`apps/server/src/engine/index.ts`), use high-confidence INSTANCE spans
     as the pieces that `split.ts` produces today, with REF, COUNT, ATTR and NAME filling
     what `assemble` and `modifiers` extract by regex.
   - Keep the current code as the fallback below the threshold.
   - Add `onnxruntime-node` to `apps/server` at that point, not before.
5. **Later:** add per-instance classification outputs to the same encoder (Jev's questions),
   then retire Jev once gold shows it's no longer needed.

## Picking this up on the laptop

In a local clone, with a clean working tree, run `claude --teleport` and pick this session.
That brings over the conversation and the branch, and it runs locally with the GPU and
Hugging Face access. The alternative is `claude remote-control` in the repo folder, to
drive it from the Claude Code app.
