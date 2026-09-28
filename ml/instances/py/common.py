"""Shared by train / export / zero_shot: data loading, word-level BIO labels, span scoring.

Everything works on words, not tokenizer offsets. `words()` splits text the same
way as `src/words.ts`, and each word is encoded on its own (with a leading
space), so Python training and the Bun runtime build identical token ids and
agree exactly on where spans start and end.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

TAGS = ["INSTANCE", "REF", "COUNT", "RELATION", "ACTION", "ATTR", "NAME"]
LABELS = ["O"] + [f"{p}-{t}" for t in TAGS for p in ("B", "I")]
LABEL_ID = {l: i for i, l in enumerate(LABELS)}

# Keep in sync with src/words.ts.
WORD = re.compile(r"[^\s.,;:!?()\[\]`\"]+|[.,;:!?()\[\]`\"]")
MARK = re.compile(r"\[([^\[\]]+)\]\(([A-Z]+)\)")

DATA = Path(__file__).resolve().parent.parent / "data"


def words(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in WORD.finditer(text)]


def parse_markup(line: str) -> dict:
    text, spans, last = "", [], 0
    for m in MARK.finditer(line):
        if m.group(2) not in TAGS:
            raise ValueError(f"unknown tag {m.group(2)} in: {line}")
        text += line[last:m.start()]
        spans.append({"start": len(text), "end": len(text) + len(m.group(1)), "tag": m.group(2)})
        text += m.group(1)
        last = m.end()
    return {"text": text + line[last:], "spans": spans}


def load(path: str | Path) -> list[dict]:
    path = Path(path)
    lines = path.read_text(encoding="utf-8").splitlines()
    if path.suffix == ".jsonl":
        return [json.loads(l) for l in lines if l.strip()]
    return [parse_markup(l.strip()) for l in lines if l.strip() and not l.strip().startswith("#")]


def word_labels(ex: dict) -> tuple[list[tuple[int, int]], list[int]]:
    """BIO label per word. A word belongs to a span if it starts inside it."""
    ws = words(ex["text"])
    labels = [LABEL_ID["O"]] * len(ws)
    for s in ex["spans"]:
        first = True
        for i, (a, _) in enumerate(ws):
            if s["start"] <= a < s["end"]:
                labels[i] = LABEL_ID[("B-" if first else "I-") + s["tag"]]
                first = False
    return ws, labels


def encode_words(tokenizer, text: str, ws: list[tuple[int, int]], max_len: int = 128):
    """[CLS] + each word encoded on its own with a leading space + [SEP]; word index per token."""
    ids = [tokenizer.cls_token_id]
    word_of = [-1]
    for i, (a, b) in enumerate(ws):
        piece = tokenizer.encode(" " + text[a:b], add_special_tokens=False)
        ids += piece
        word_of += [i] * len(piece)
    ids, word_of = ids[: max_len - 1], word_of[: max_len - 1]
    return ids + [tokenizer.sep_token_id], word_of + [-1]


def decode(text: str, ws: list[tuple[int, int]], word_labels_: list[str]) -> list[dict]:
    """Word labels back to character spans. An I- without a matching open span starts one."""
    spans: list[dict] = []
    cur = None
    for (a, b), lab in zip(ws, word_labels_):
        if lab == "O":
            cur = None
            continue
        pre, tag = lab.split("-", 1)
        if pre == "I" and cur is not None and cur["tag"] == tag:
            cur["end"] = b
        else:
            cur = {"start": a, "end": b, "tag": tag}
            spans.append(cur)
    return spans


def score(gold: list[dict], pred: list[list[dict]]) -> dict:
    """Exact-match span precision / recall / F1, per tag and overall."""
    per = {t: {"tp": 0, "fp": 0, "fn": 0} for t in TAGS}
    for g, p in zip(gold, pred):
        gs = {(s["start"], s["end"], s["tag"]) for s in g["spans"]}
        ps = {(s["start"], s["end"], s["tag"]) for s in p}
        for t in TAGS:
            gt = {x for x in gs if x[2] == t}
            pt = {x for x in ps if x[2] == t}
            per[t]["tp"] += len(gt & pt)
            per[t]["fp"] += len(pt - gt)
            per[t]["fn"] += len(gt - pt)

    def f(c):
        p = c["tp"] / (c["tp"] + c["fp"]) if c["tp"] + c["fp"] else 0.0
        r = c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else 0.0
        return {"p": round(p, 3), "r": round(r, 3), "f1": round(2 * p * r / (p + r), 3) if p + r else 0.0, "n": c["tp"] + c["fn"]}

    total = {k: sum(c[k] for c in per.values()) for k in ("tp", "fp", "fn")}
    exact = sum(
        {(s["start"], s["end"], s["tag"]) for s in g["spans"]} == {(s["start"], s["end"], s["tag"]) for s in p}
        for g, p in zip(gold, pred)
    )
    return {"overall": f(total), "sentences_exact": round(exact / max(1, len(gold)), 3), **{t: f(c) for t, c in per.items()}}


def print_score(name: str, s: dict) -> None:
    o = s["overall"]
    print(f"\n{name}: F1 {o['f1']:.3f} (P {o['p']:.3f} R {o['r']:.3f}), whole sentence right {s['sentences_exact']:.1%}")
    for t in TAGS:
        c = s[t]
        print(f"  {t:<9} F1 {c['f1']:.3f}  P {c['p']:.3f}  R {c['r']:.3f}  (n={c['n']})")


def misaligned(examples: list[dict]) -> int:
    """Spans whose edges fall inside a word: the word-level model can't produce them exactly."""
    bad = 0
    for ex in examples:
        starts = {a for a, _ in words(ex["text"])}
        ends = {b for _, b in words(ex["text"])}
        bad += sum(s["start"] not in starts or s["end"] not in ends for s in ex["spans"])
    return bad
