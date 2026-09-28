# Instance tagger

A small model that reads what someone types and marks which words are **instances**
(things to create), references to existing elements, counts, relations, edit verbs,
attributes and names. It runs inside the Bun server (ONNX, CPU, no network, no
per-call cost) and is meant to replace the hand-written splitting and labelling in
`apps/server/src/engine` over time.

```
a [landing page](INSTANCE) with a [navbar](INSTANCE), [three](COUNT) [pricing cards](INSTANCE)
[api server](INSTANCE) [writes to](RELATION) [@postgres](REF) and [publishes to](RELATION) a [queue](INSTANCE)
[rename](ACTION) [it](REF) to [Checkout](NAME), then [make](ACTION) the [footer](REF) [navy](ATTR)
```

Background, decisions and next steps: [`thoughts/instance-tagger-handoff.md`](../../thoughts/instance-tagger-handoff.md).

Nothing here is wired into the server yet. This folder is the kit to train, measure
and compare models; the server change comes once the numbers are good.

## Tags

| Tag | What | Examples |
|---|---|---|
| INSTANCE | a thing to create: head noun plus the words naming its kind; no article, count or color | `pricing table`, `25 minute timer`, `api server` |
| REF | something already on the board | `@hero`, `{servers stack}`, `it`, `them`, `everything`, `the [footer]` |
| COUNT | how many | `3`, `three`, `trio`, `4` in "4 of them" |
| RELATION | a verb linking two things | `calls`, `writes to`, `connected to`, `connect` |
| ACTION | an edit verb | `remove`, `move`, `rename`, `make`, `color`, `disconnect`, `group` |
| ATTR | a property, look or position | `red`, `big`, `row`, `glassmorphism`, `animated gradient`, `dashed border`, `increments of 15`, `at the top`, `before` |
| NAME | a name or value given in the text | `called [postgres]`, `call it [Login]`, checklist items, note text |

Creation verbs (`add`, `create`) and filler stay untagged.

Styling: look words before a thing are ATTR and the thing stays INSTANCE (`a [glassmorphism](ATTR) [navbar](INSTANCE)`).
A styled property after "with" is one ATTR span without its article (`a [card](INSTANCE) with a [2px navy border](ATTR)`),
and so is the property an edit names (`[remove](ACTION) the [shadow](ATTR) from [@card](REF)`). A background is a
property of what it's behind, not an instance.

## Files

| Path | What |
|---|---|
| `data/gold.txt` | 179 phrases: 141 real ones from the tests and `scripts/arrows.ts`, plus 38 styling phrases written by hand, all labelled by hand. **Held out: never train on it.** |
| `src/ui21st.ts` | Builds `data/ui-vocab.json` from the 21st.dev sitemap: ~1,400 component kinds (mapped to registry types where they fit) and their style words |
| `data/ui-vocab.json` | That vocabulary, checked in so generating doesn't need the site. `unmapped` lists kinds with no registry type yet |
| `src/generate.ts` | Seeded synthetic training data from the registry, 21st.dev vocabulary and templates; skips anything in gold |
| `py/train.py` | Fine-tunes an encoder (default `jhu-clsp/ettin-encoder-32m`) and scores dev + gold |
| `py/export.py` | ONNX fp32 + int8, tokenizer, label map, and a token-id check file |
| `py/zero_shot.py` | Scores GLiNER models on gold with no training (accuracy + CPU latency) |
| `src/tagger.ts` | The runtime: `Tagger.load(dir)` then `tagger.tag(text)` → spans with confidence |
| `src/eval.ts` | Scores an export on gold and times it under Bun, the way the server would run it |
| `bench/encoder_latency.py` | CPU speed of each model size (random weights), independent of accuracy |

## Run it on your laptop (RTX 4070)

Needs Bun, Python 3.10+, and an NVIDIA driver. Commands are the same on Windows
(PowerShell) and Linux/macOS except where noted.

```bash
cd ml/instances
bun install
bun run generate                 # data/train.jsonl + dev.jsonl (20k examples)

python -m venv .venv
# Windows:      .venv\Scripts\activate
# Linux/macOS:  source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r py/requirements.txt
python -c "import torch; print(torch.cuda.get_device_name(0))"   # should print your 4070
```

**1. GLiNER baseline, no training** (a few minutes; downloads each model once):

```bash
python py/zero_shot.py                       # gliner_small-v2.1, gliner-bi-edge-v2.0, gliner_medium-v2.1
python py/zero_shot.py urchade/gliner_small-v2.1 --threshold 0.3
```

The latency it prints is CPU, which is how the server would run it. Try other label
wordings in `PROMPTS`; REF is the tag it can't really know without training.

**2. Fine-tune the tagger** (about 5–10 minutes for Ettin-32m on a 4070):

```bash
python py/train.py                                         # ettin-encoder-32m
python py/train.py --model jhu-clsp/ettin-encoder-68m      # bigger, if 32m falls short
python py/train.py --model answerdotai/ModernBERT-base     # the Laya-family encoder, for comparison
```

It prints dev F1 (synthetic, same generator: will look great) and **GOLD F1**
(real phrases: the number that matters). Every gold miss is written to
`runs/<name>/gold_errors.txt`.

**3. Export and check it under Bun** (speed and accuracy as the server would see it):

```bash
python py/export.py runs/ettin-encoder-32m
bun src/eval.ts runs/ettin-encoder-32m/onnx --errors
```

`eval.ts` first checks the Bun tokenizer produces the same ids Python trained on and
stops if not. The latency it prints includes tokenizing and decoding.

**Smoke test** (CPU, no downloads, ~2 minutes): `python py/train.py --smoke` then the
export and eval steps with `runs/smoke`. A 0.7M-parameter model trained from scratch
reaches gold F1 0.83 at 0.3 ms, which is the floor a pretrained encoder should beat.

## What to send back

`runs/zero_shot.json` and `runs/<name>/metrics.json` plus the `eval.ts` output. From
those we pick the model and the confidence threshold for wiring it into `interpret`.

## Improving it

- **Fix the data, not the gold set.** When gold misses show a pattern, add a general
  template or vocabulary to `src/generate.ts`; never copy gold sentences into training.
- **Real phrasings beat templates.** The next big gain is a few thousand real or
  LLM-written commands, labelled (gpt-oss or GLiNER first, a person correcting), in the
  same markup.
- **Add to gold when you find a bad case in the app**, so it stays a fair test.
