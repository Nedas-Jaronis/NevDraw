"""Export a trained run to ONNX (fp32 + int8) for the Bun server.

    python py/export.py runs/ettin-encoder-32m

Writes runs/<name>/onnx/: model.onnx, model.int8.onnx (outputs: tag logits, and the dep / head
link vectors per token), tokenizer.json, tagger.json (labels, special token ids, link labels and bias), and wordcheck.json (token ids for sample words, which
src/eval.ts compares against its own tokenizer before trusting any score).
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoTokenizer

from common import DATA, LABELS, LINKS, load, words
from model import Parser


def main() -> None:
    run = Path(sys.argv[1])
    model = Parser.load(run / "model").eval()
    tokenizer = AutoTokenizer.from_pretrained(run / "model")
    out = run / "onnx"
    out.mkdir(exist_ok=True)

    ids = torch.tensor([[tokenizer.cls_token_id] + tokenizer.encode(" a landing page", add_special_tokens=False) + [tokenizer.sep_token_id]])
    torch.onnx.export(
        model, (ids, torch.ones_like(ids)), out / "model.onnx",
        input_names=["input_ids", "attention_mask"], output_names=["logits", "dep", "head"],
        dynamic_axes={k: {0: "batch", 1: "seq"} for k in ("input_ids", "attention_mask", "logits", "dep", "head")},
        opset_version=17, dynamo=False,
    )
    quantize_dynamic(out / "model.onnx", out / "model.int8.onnx", weight_type=QuantType.QInt8)

    shutil.copy(run / "model" / "tokenizer.json", out / "tokenizer.json")
    for extra in ("tokenizer_config.json", "special_tokens_map.json"):
        if (run / "model" / extra).exists():
            shutil.copy(run / "model" / extra, out / extra)
    (out / "tagger.json").write_text(json.dumps({
        "labels": LABELS, "cls": tokenizer.cls_token_id, "sep": tokenizer.sep_token_id, "pad": tokenizer.pad_token_id, "max_len": 128,
        "links": {"labels": LINKS, "rank": model.rank, "bias": model.bias.data.tolist()},
    }, indent=2))

    sample = {}
    for ex in load(DATA / "gold.txt")[:40]:
        for a, b in words(ex["text"]):
            w = ex["text"][a:b]
            sample[w] = tokenizer.encode(" " + w, add_special_tokens=False)
    (out / "wordcheck.json").write_text(json.dumps(sample))
    for f in sorted(out.iterdir()):
        print(f"{f.stat().st_size / 1e6:8.1f} MB  {f}")


if __name__ == "__main__":
    main()
