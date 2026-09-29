"""The parser: one encoder, two outputs.

1. Tags: a BIO label per token (the token-classification head it always had).
2. Links: every token gets a "dependent" and a "head" vector per link label. The
   score that span i links to span j with label l is dep[i, l] · head[j, l] / sqrt(r)
   plus a bias, taken at each span's first token; "no link" scores 0. Scoring pairs
   is a handful of dot products, so the runtime (src/tagger.ts) does it in JS from
   the two exported matrices, for whatever spans the tags produced.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import torch
from torch import nn

from common import LINKS

SINGLE_HEAD = {"mod", "in", "same"}


class Parser(nn.Module):
    def __init__(self, base, rank: int = 64):
        super().__init__()
        self.base = base
        self.rank = rank
        hidden = base.config.hidden_size
        self.dep = nn.Linear(hidden, len(LINKS) * rank)
        self.head = nn.Linear(hidden, len(LINKS) * rank)
        self.bias = nn.Parameter(torch.full((len(LINKS),), -2.0))

    def forward(self, input_ids, attention_mask):
        out = self.base(input_ids=input_ids, attention_mask=attention_mask, output_hidden_states=True)
        h = out.hidden_states[-1]
        return out.logits, self.dep(h), self.head(h)

    def pair_scores(self, dep_row: torch.Tensor, head_row: torch.Tensor, pos: torch.Tensor) -> torch.Tensor:
        """[n, n, 1 + L] logits for spans at token positions `pos` (dep, head, label; label 0 = none)."""
        n, L, r = len(pos), len(LINKS), self.rank
        d = dep_row[pos].view(n, L, r)
        h = head_row[pos].view(n, L, r)
        s = torch.einsum("ilr,jlr->ijl", d, h) / math.sqrt(r) + self.bias
        return torch.cat([torch.zeros(n, n, 1, device=s.device, dtype=s.dtype), s], dim=-1)

    def save(self, out: Path, tokenizer) -> None:
        self.base.save_pretrained(out)
        tokenizer.save_pretrained(out)
        torch.save({"dep": self.dep.state_dict(), "head": self.head.state_dict(), "bias": self.bias.data}, out / "links.pt")
        (out / "links.json").write_text(json.dumps({"labels": LINKS, "rank": self.rank}))

    @classmethod
    def load(cls, out: Path):
        from transformers import AutoModelForTokenClassification

        meta = json.loads((out / "links.json").read_text())
        model = cls(AutoModelForTokenClassification.from_pretrained(out), rank=meta["rank"])
        state = torch.load(out / "links.pt", map_location="cpu")
        model.dep.load_state_dict(state["dep"])
        model.head.load_state_dict(state["head"])
        model.bias.data = state["bias"]
        return model


def decode_links(probs: torch.Tensor, threshold: float = 0.5) -> list[list[list]]:
    """[n, n, 1 + L] probabilities → arcs per span, [[label, head, p], ...].

    Each pair keeps its most likely label if that isn't "none" and clears the threshold;
    mod / in / same keep only their best head per span. Same rules as src/tagger.ts.
    """
    n = probs.shape[0]
    arcs: list[list[list]] = [[] for _ in range(n)]
    p, lab = probs.max(-1)
    for i in range(n):
        best: dict[str, list] = {}
        for j in range(n):
            if i == j or lab[i, j] == 0 or p[i, j] < threshold:
                continue
            name = LINKS[lab[i, j] - 1]
            arc = [name, j, float(p[i, j])]
            if name in SINGLE_HEAD:
                if name not in best or arc[2] > best[name][2]:
                    best[name] = arc
            else:
                arcs[i].append(arc)
        arcs[i].extend(best.values())
        arcs[i].sort(key=lambda a: a[1])
    return arcs
