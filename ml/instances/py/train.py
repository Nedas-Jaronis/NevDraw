"""Fine-tune a small encoder to tag instances, then score it on the held-out gold set.

    python py/train.py                                   # Ettin-32m, the recommended default
    python py/train.py --model jhu-clsp/ettin-encoder-68m
    python py/train.py --smoke                           # tiny random model, CPU, no downloads: checks the pipeline

Writes runs/<name>/model (HF format), runs/<name>/metrics.json. Export with py/export.py.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
from torch.nn.utils.rnn import pad_sequence

from common import DATA, LABELS, decode, encode_words, load, print_score, score, word_labels

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
        feats.append({"ids": torch.tensor(ids), "labels": torch.tensor(y), "word_of": word_of, "words": ws})
    return feats


def batches(feats: list[dict], size: int, pad_id: int, shuffle: bool):
    order = list(range(len(feats)))
    if shuffle:
        random.shuffle(order)
    for i in range(0, len(order), size):
        chunk = [feats[j] for j in order[i : i + size]]
        ids = pad_sequence([f["ids"] for f in chunk], batch_first=True, padding_value=pad_id)
        yield chunk, ids, (ids != pad_id).long(), pad_sequence([f["labels"] for f in chunk], batch_first=True, padding_value=-100)


@torch.no_grad()
def predict(model, tokenizer, examples: list[dict], feats: list[dict], device, bs: int = 64) -> list[list[dict]]:
    model.eval()
    out = []
    for chunk, ids, mask, _ in batches(feats, bs, tokenizer.pad_token_id, shuffle=False):
        logits = model(input_ids=ids.to(device), attention_mask=mask.to(device)).logits.argmax(-1).cpu()
        for f, row in zip(chunk, logits):
            per_word = ["O"] * len(f["words"])
            seen = set()
            for t, w in enumerate(f["word_of"]):
                if w >= 0 and w not in seen:
                    per_word[w] = LABELS[row[t]]
                    seen.add(w)
            out.append(per_word)
    return [decode(ex["text"], f["words"], labs) for ex, f, labs in zip(examples, feats, out)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="jhu-clsp/ettin-encoder-32m")
    ap.add_argument("--name", default=None, help="run folder name (default: from the model)")
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=8e-5)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--max-len", type=int, default=128)
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
        tokenizer, model = smoke_model([e["text"] for e in train])
        name = args.name or "smoke"
    else:
        from transformers import AutoModelForTokenClassification, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(args.model)
        model = AutoModelForTokenClassification.from_pretrained(
            args.model, num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id={l: i for i, l in enumerate(LABELS)}
        )
        name = args.name or args.model.split("/")[-1]
    if tokenizer.cls_token_id is None or tokenizer.sep_token_id is None or tokenizer.pad_token_id is None:
        raise SystemExit(f"{args.model}: the tokenizer needs cls, sep and pad tokens")
    model.config.id2label = dict(enumerate(LABELS))
    model.config.label2id = {l: i for i, l in enumerate(LABELS)}
    model.to(device)

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
        for _, ids, mask, labels in batches(ftrain, args.batch, tokenizer.pad_token_id, shuffle=True):
            with torch.autocast(device.type, dtype=torch.bfloat16, enabled=amp):
                loss = model(input_ids=ids.to(device), attention_mask=mask.to(device), labels=labels.to(device)).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            step += 1
            if step % 100 == 0:
                print(f"  step {step}/{steps}  loss {loss.item():.4f}  {time.time() - t0:.0f}s", flush=True)
        dev_score = score(dev, predict(model, tokenizer, dev, fdev, device))
        print(f"epoch {epoch + 1}: dev F1 {dev_score['overall']['f1']:.3f}")

    gold_pred = predict(model, tokenizer, gold, fgold, device)
    gold_score = score(gold, gold_pred)
    print_score("dev (synthetic, same generator as train)", dev_score)
    print_score("GOLD (real phrases, held out)", gold_score)

    out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out / "model")
    tokenizer.save_pretrained(out / "model")
    (out / "metrics.json").write_text(json.dumps({"model": args.model, "smoke": args.smoke, "args": vars(args), "dev": dev_score, "gold": gold_score}, indent=2))
    # Every gold miss, for reading: what it should have been vs what it said.
    with open(out / "gold_errors.txt", "w", encoding="utf-8") as f:
        for ex, pred in zip(gold, gold_pred):
            key = lambda ss: sorted((s["start"], s["end"], s["tag"]) for s in ss)
            if key(ex["spans"]) != key(pred):
                f.write(f"want {render(ex['text'], ex['spans'])}\ngot  {render(ex['text'], pred)}\n\n")
    print(f"\nsaved {out}")


def render(text: str, spans: list[dict]) -> str:
    out, last = "", 0
    for s in sorted(spans, key=lambda s: s["start"]):
        out += text[last : s["start"]] + f"[{text[s['start']:s['end']]}]({s['tag']})"
        last = s["end"]
    return out + text[last:]


if __name__ == "__main__":
    main()
