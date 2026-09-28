"""Score GLiNER models zero-shot on the gold set: accuracy and CPU latency, no training.

    python py/zero_shot.py                                   # the default shortlist
    python py/zero_shot.py urchade/gliner_small-v2.1 --threshold 0.3

GLiNER finds spans for label *descriptions*, so the wording in PROMPTS matters;
try variants and keep what scores best. REF ("already on the board") is the one
it cannot really know without training.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import torch

from common import DATA, load, print_score, score

PROMPTS = {
    "INSTANCE": "ui component or software system",
    "REF": "reference to an existing element",
    "COUNT": "quantity",
    "RELATION": "connection verb",
    "ACTION": "edit command verb",
    "ATTR": "color, size, layout or position",
    "NAME": "name or label",
}
DEFAULT = [
    "urchade/gliner_small-v2.1",
    "knowledgator/gliner-bi-edge-v2.0",
    "urchade/gliner_medium-v2.1",
]


def run(name: str, threshold: float, device: str, gliner_cls=None) -> dict:
    if gliner_cls is None:
        from gliner import GLiNER as gliner_cls
    model = gliner_cls.from_pretrained(name)
    if hasattr(model, "to"):
        model = model.to(device)
    gold = load(DATA / "gold.txt")
    by_prompt = {v: k for k, v in PROMPTS.items()}
    labels = list(PROMPTS.values())

    for ex in gold[:5]:  # warm-up
        model.predict_entities(ex["text"], labels, threshold=threshold)
    preds, times = [], []
    for ex in gold:
        t = time.perf_counter()
        ents = model.predict_entities(ex["text"], labels, threshold=threshold, flat_ner=True)
        times.append((time.perf_counter() - t) * 1000)
        preds.append([{"start": e["start"], "end": e["end"], "tag": by_prompt[e["label"]]} for e in ents])
    s = score(gold, preds)
    times.sort()
    s["latency_ms"] = {"p50": round(statistics.median(times), 1), "p95": round(times[int(len(times) * 0.95)], 1), "device": device}
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="*", default=DEFAULT)
    ap.add_argument("--threshold", type=float, default=0.4)
    ap.add_argument("--device", default="cpu", help="cpu matches how the server would run it; cuda for speed while exploring")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    torch.set_num_threads(args.threads)

    out = Path(__file__).resolve().parent.parent / "runs" / "zero_shot.json"
    results = json.loads(out.read_text()) if out.exists() else {}
    for name in args.models:
        s = run(name, args.threshold, args.device)
        print_score(f"{name} (threshold {args.threshold})", s)
        print(f"  latency p50 {s['latency_ms']['p50']} ms, p95 {s['latency_ms']['p95']} ms on {args.device}")
        results[f"{name}@{args.threshold}"] = s
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    print(f"\nsaved {out}")


if __name__ == "__main__":
    main()
