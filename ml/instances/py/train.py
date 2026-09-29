"""Fine-tune a small encoder to tag spans and link them, then score it on the held-out gold set.

    python py/train.py                                   # Ettin-32m, the recommended default
    python py/train.py --model jhu-clsp/ettin-encoder-68m
    python py/train.py --smoke                           # tiny random model, CPU, no downloads: checks the pipeline

Writes runs/<name>/model (HF format plus links.pt), runs/<name>/metrics.json and
runs/<name>/gold_errors.txt. Export with py/export.py.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.nn.utils.rnn import pad_sequence

from common import DATA, LABELS, LINK_ID, decode, encode_words, load, print_links, print_score, score, score_links, word_labels
from model import Parser, decode_links

ROOT = Path(__file__).resolve().parent.parent


def smoke_model(train_texts: list[str]):
    """A tiny BERT with a WordPiece vocab learned from our own data: no Hugging Face access needed."""
    from tokenizers import Tokenizer, models, normalizers, pre_tokenizers, trainers
    from transformers import BertConfig, BertForTokenClassification, PreTrainedTokenizerFast

    tok = Tokenizer(models.WordPiece(unk_token="[UNK]"))
    tok.normalizer = normalizers.BertNormalizer(lowercase=True)
    tok.pre_tokenizer = pre_tokenizers.BertPreTokenizer()
    tok.train_from_iterator(train_texts, trainers.WordPieceTrainer(vocab_size=4000, special_tokens=["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]))
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=tok, unk_token="[UNK]", pad_token="[PAD]", cls_token="[CLS]", sep_token="[SEP]", mask_token="[MASK]")
    cfg = BertConfig(vocab_size=tokenizer.vocab_size, hidden_size=128, num_hidden_layers=2, num_attention_heads=2, intermediate_size=256, num_labels=len(LABELS))
    return tokenizer, BertForTokenClassification(cfg)


def first_tokens(word_of: list[int]) -> dict[int, int]:
    """Word index → the position of its first token."""
    out: dict[int, int] = {}
    for t, w in enumerate(word_of):
        if w >= 0 and w not in out:
            out[w] = t
    return out


def span_positions(ws, word_of, spans) -> list[int]:
    """Each span's first-token position (-1 when it was cut off by max_len)."""
    first = first_tokens(word_of)
    word_at = {a: i for i, (a, _) in enumerate(ws)}
    return [first.get(word_at.get(s["start"], -1), -1) for s in spans]


def featurize(tokenizer, examples: list[dict], max_len: int) -> list[dict]:
    feats = []
    for ex in examples:
        ws, labs = word_labels(ex)
        ids, word_of = encode_words(tokenizer, ex["text"], ws, max_len)
        # Only a word's first token carries its label; the rest are ignored by the loss.
        y, prev = [], None
        for w in word_of:
            y.append(-100 if w < 0 or w == prev else labs[w])
            prev = w
        spans = ex["spans"]
        n = len(spans)
        links = torch.zeros(n, n, dtype=torch.long)
        for i, s in enumerate(spans):
            for label, head in s.get("arcs", []):
                links[i, head] = LINK_ID[label]
        feats.append({"ids": torch.tensor(ids), "labels": torch.tensor(y), "word_of": word_of, "words": ws, "pos": span_positions(ws, word_of, spans), "links": links})
    return feats


def batches(feats: list[dict], size: int, pad_id: int, shuffle: bool):
    order = list(range(len(feats)))
    if shuffle:
        random.shuffle(order)
    for i in range(0, len(order), size):
        chunk = [feats[j] for j in order[i : i + size]]
        ids = pad_sequence([f["ids"] for f in chunk], batch_first=True, padding_value=pad_id)
        yield chunk, ids, (ids != pad_id).long(), pad_sequence([f["labels"] for f in chunk], batch_first=True, padding_value=-100)


def link_loss(model: Parser, chunk: list[dict], dep: torch.Tensor, head: torch.Tensor) -> torch.Tensor:
    """Cross-entropy over every ordered pair of (gold) spans in each example; "no link" is class 0."""
    losses, pairs = [], 0
    for b, f in enumerate(chunk):
        keep = [i for i, p in enumerate(f["pos"]) if p >= 0]
        if len(keep) < 2:
            continue
        pos = torch.tensor([f["pos"][i] for i in keep], device=dep.device)
        target = f["links"][keep][:, keep].to(dep.device)
        scores = model.pair_scores(dep[b], head[b], pos).float()
        off = ~torch.eye(len(keep), dtype=torch.bool, device=dep.device)
        losses.append(F.cross_entropy(scores[off], target[off], reduction="sum"))
        pairs += int(off.sum())
    return torch.stack(losses).sum() / pairs if losses else dep.sum() * 0


@torch.no_grad()
def predict(model: Parser, tokenizer, examples: list[dict], feats: list[dict], device, bs: int = 64, gold_spans: bool = False) -> list[list[dict]]:
    """Spans with their links. With gold_spans, links are predicted between the gold spans (scores linking alone)."""
    model.eval()
    out = []
    for chunk, ids, mask, _ in batches(feats, bs, tokenizer.pad_token_id, shuffle=False):
        logits, dep, head = model(ids.to(device), mask.to(device))
        tags = logits.argmax(-1).cpu()
        for b, f in enumerate(chunk):
            ex = examples[len(out)]
            if gold_spans:
                spans = [{k: v for k, v in s.items() if k != "arcs"} for s in ex["spans"]]
                pos = f["pos"]
            else:
                per_word = ["O"] * len(f["words"])
                for w, t in first_tokens(f["word_of"]).items():
                    per_word[w] = LABELS[tags[b, t]]
                spans = decode(ex["text"], f["words"], per_word)
                pos = span_positions(f["words"], f["word_of"], spans)
            keep = [i for i, p in enumerate(pos) if p >= 0]
            if len(keep) >= 2:
                probs = model.pair_scores(dep[b].float(), head[b].float(), torch.tensor([pos[i] for i in keep], device=device)).softmax(-1).cpu()
                for k, arcs in enumerate(decode_links(probs)):
                    if arcs:
                        spans[keep[k]]["arcs"] = [[label, keep[j], p] for label, j, p in arcs]
            out.append(spans)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="jhu-clsp/ettin-encoder-32m")
    ap.add_argument("--name", default=None, help="run folder name (default: from the model)")
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=8e-5)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--max-len", type=int, default=128)
    ap.add_argument("--rank", type=int, default=64, help="size of each link vector")
    ap.add_argument("--link-weight", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0, help="train on the first N examples only")
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train, dev, gold = load(DATA / "train.jsonl"), load(DATA / "dev.jsonl"), load(DATA / "gold.txt")
    if args.limit:
        train = train[: args.limit]

    if args.smoke:
        tokenizer, base = smoke_model([e["text"] for e in train])
        name = args.name or "smoke"
    else:
        from transformers import AutoModelForTokenClassification, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(args.model)
        base = AutoModelForTokenClassification.from_pretrained(
            args.model, num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id={l: i for i, l in enumerate(LABELS)}
        )
        name = args.name or args.model.split("/")[-1]
    if tokenizer.cls_token_id is None or tokenizer.sep_token_id is None or tokenizer.pad_token_id is None:
        raise SystemExit(f"{args.model}: the tokenizer needs cls, sep and pad tokens")
    base.config.id2label = dict(enumerate(LABELS))
    base.config.label2id = {l: i for i, l in enumerate(LABELS)}
    model = Parser(base, rank=args.rank).to(device)

    out = ROOT / "runs" / name
    print(f"{name} on {device}: {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M params, {len(train)} train / {len(dev)} dev / {len(gold)} gold")

    ftrain, fdev, fgold = (featurize(tokenizer, x, args.max_len) for x in (train, dev, gold))
    steps = args.epochs * math.ceil(len(ftrain) / args.batch)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, s / max(1, steps // 10)) * max(0.0, (steps - s) / steps))
    amp = device.type == "cuda"

    step, t0 = 0, time.time()
    for epoch in range(args.epochs):
        model.train()
        for chunk, ids, mask, labels in batches(ftrain, args.batch, tokenizer.pad_token_id, shuffle=True):
            with torch.autocast(device.type, dtype=torch.bfloat16, enabled=amp):
                logits, dep, head = model(ids.to(device), mask.to(device))
                tag_loss = F.cross_entropy(logits.float().flatten(0, 1), labels.to(device).flatten(), ignore_index=-100)
                arc_loss = link_loss(model, chunk, dep, head)
                loss = tag_loss + args.link_weight * arc_loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            step += 1
            if step % 100 == 0:
                print(f"  step {step}/{steps}  tags {tag_loss.item():.4f}  links {arc_loss.item():.4f}  {time.time() - t0:.0f}s", flush=True)
        dev_pred = predict(model, tokenizer, dev, fdev, device)
        print(f"epoch {epoch + 1}: dev tag F1 {score(dev, dev_pred)['overall']['f1']:.3f}  link F1 {score_links(dev, dev_pred)['overall']['f1']:.3f}")

    dev_pred = predict(model, tokenizer, dev, fdev, device)
    gold_pred = predict(model, tokenizer, gold, fgold, device)
    gold_given = predict(model, tokenizer, gold, fgold, device, gold_spans=True)
    result = {
        "dev": score(dev, dev_pred),
        "dev_links": score_links(dev, dev_pred),
        "gold": score(gold, gold_pred),
        "gold_links": score_links(gold, gold_pred),
        "gold_links_given_spans": score_links(gold, gold_given),
    }
    print_score("dev (synthetic, same generator as train)", result["dev"])
    print_links("dev links", result["dev_links"])
    print_score("GOLD tags (real phrases, held out)", result["gold"])
    print_links("GOLD links, given the right spans", result["gold_links_given_spans"])
    print_links("GOLD links, end to end (spans and links both right)", result["gold_links"])

    out.mkdir(parents=True, exist_ok=True)
    model.save(out / "model", tokenizer)
    (out / "metrics.json").write_text(json.dumps({"model": args.model, "smoke": args.smoke, "args": vars(args), **result}, indent=2))
    # Every gold miss, for reading: what it should have been vs what it said.
    with open(out / "gold_errors.txt", "w", encoding="utf-8") as f:
        for ex, pred in zip(gold, gold_pred):
            want, got = render(ex["text"], ex["spans"]), render(ex["text"], pred)
            if want != got:
                f.write(f"want {want}\ngot  {got}\n\n")
    print(f"\nsaved {out}")


def render(text: str, spans: list[dict]) -> str:
    """Markup with links; a link names its head by text (add ~N by hand if that's ambiguous)."""
    out, last = "", 0
    order = sorted(range(len(spans)), key=lambda i: spans[i]["start"])
    for i in order:
        s = spans[i]
        arcs = "".join(f" {a[0]}:{text[spans[a[1]]['start']:spans[a[1]]['end']]}" for a in sorted(s.get("arcs", []), key=lambda a: (a[0], a[1])))
        out += text[last : s["start"]] + f"[{text[s['start']:s['end']]}]({s['tag']}{arcs})"
        last = s["end"]
    return out + text[last:]


if __name__ == "__main__":
    main()
