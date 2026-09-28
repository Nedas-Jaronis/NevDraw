"""Encoder speed on CPU, independent of accuracy: random weights cost the same compute as trained ones.

    python bench/encoder_latency.py                      # every size below
    python bench/encoder_latency.py "ettin-32m-like (10L/384)"

Prints median ms per input (batch 1) for fp32 / int8, 1 and 4 threads, 48 and 96 tokens.
The model only: tokenizing and decoding add about 1-3 ms. Shapes approximate the named models.
"""
import time, os, sys, json, warnings
warnings.filterwarnings("ignore")
import torch, numpy as np, onnxruntime as ort
from transformers import (DebertaV2Config, DebertaV2Model, ModernBertConfig, ModernBertModel,
                          BertConfig, BertModel)
from onnxruntime.quantization import quantize_dynamic, QuantType

def deb(L, H, heads, ffn):
    return DebertaV2Model(DebertaV2Config(vocab_size=128100, hidden_size=H, num_hidden_layers=L,
        num_attention_heads=heads, intermediate_size=ffn, max_position_embeddings=512,
        relative_attention=True, position_buckets=256, norm_rel_ebd="layer_norm",
        share_att_key=True, pos_att_type=["p2c", "c2p"], position_biased_input=False, max_relative_positions=-1))
def mb(L, H, heads, ffn, vocab=50368):
    return ModernBertModel(ModernBertConfig(vocab_size=vocab, hidden_size=H, num_hidden_layers=L,
        num_attention_heads=heads, intermediate_size=ffn, global_attn_every_n_layers=3, local_attention=128))
def bert(L, H, heads, ffn, vocab=30522):
    return BertModel(BertConfig(vocab_size=vocab, hidden_size=H, num_hidden_layers=L, num_attention_heads=heads, intermediate_size=ffn))

MODELS = {
  "deberta-v3-xsmall (12L/384)": lambda: deb(12, 384, 6, 1536),
  "deberta-v3-small (6L/768)": lambda: deb(6, 768, 12, 3072),
  "deberta-v3-base (12L/768)": lambda: deb(12, 768, 12, 3072),
  "deberta-v3-large (24L/1024)": lambda: deb(24, 1024, 16, 4096),
  "minilm-L6-H384 (bert)": lambda: bert(6, 384, 12, 1536),
  "ettin-17m-like (7L/256)": lambda: mb(7, 256, 4, 384),
  "ettin-32m-like (10L/384)": lambda: mb(10, 384, 6, 576),
  "ettin-68m-like (19L/512)": lambda: mb(19, 512, 8, 768),
  "modernbert-base (22L/768)": lambda: mb(22, 768, 12, 1152),
}
sel = sys.argv[1:] or list(MODELS)
os.makedirs("runs/bench", exist_ok=True)
res = {}
for name in sel:
    torch.manual_seed(0)
    base = MODELS[name]().eval()
    class W(torch.nn.Module):
        def __init__(s, b): super().__init__(); s.b=b
        def forward(s, i, a): return s.b(input_ids=i, attention_mask=a).last_hidden_state
    m = W(base).eval()
    nparams = sum(p.numel() for p in m.parameters()) / 1e6
    path = f"runs/bench/{abs(hash(name))}.onnx"
    ids = torch.randint(5, 1000, (1, 64)); am = torch.ones_like(ids)
    with torch.no_grad():
        torch.onnx.export(m, (ids, am), path, input_names=["input_ids", "attention_mask"], output_names=["h"],
            dynamic_axes={"input_ids": {0: "b", 1: "s"}, "attention_mask": {0: "b", 1: "s"}}, opset_version=17, dynamo=False)
    qpath = path.replace(".onnx", ".int8.onnx")
    quantize_dynamic(path, qpath, weight_type=QuantType.QInt8)
    row = {"params_M": round(nparams, 1)}
    for tag, p in [("fp32", path), ("int8", qpath)]:
        for thr in (1, 4):
            so = ort.SessionOptions(); so.intra_op_num_threads = thr; so.inter_op_num_threads = 1
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            s = ort.InferenceSession(p, so, providers=["CPUExecutionProvider"])
            for seq in (48, 96):
                feed = {"input_ids": np.random.randint(5, 1000, (1, seq)).astype(np.int64), "attention_mask": np.ones((1, seq), np.int64)}
                for _ in range(10): s.run(None, feed)
                ts = []
                for _ in range(50):
                    t = time.perf_counter(); s.run(None, feed); ts.append((time.perf_counter() - t) * 1000)
                row[f"{tag}_t{thr}_s{seq}"] = round(float(np.median(ts)), 1)
    row["fp32_MB"] = round(os.path.getsize(path) / 1e6); row["int8_MB"] = round(os.path.getsize(qpath) / 1e6)
    res[name] = row
    os.remove(path); os.remove(qpath)
    print(name, json.dumps(row), flush=True)
