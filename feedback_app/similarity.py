"""Text similarity: character n-gram TF-IDF cosine."""
from __future__ import annotations

import math
import re

_WORD_RE = re.compile(r"[a-zA-Z0-9]+")


def normalize(text: str) -> str:
    return (text or "").lower()


def terms(text: str) -> list:
    """Character unigrams/bigrams/trigrams plus latin word tokens.

    Single CJK characters carry meaning (e.g. 密码, 登录 share 字),
    so unigrams matter for short Chinese feedback.
    """
    t = normalize(text)
    out = []
    for w in _WORD_RE.findall(t):
        out.append("w:" + w)
    chars = re.sub(r"\s+", "", t)
    for n in (1, 2, 3):
        for i in range(len(chars) - n + 1):
            out.append("c:" + chars[i:i + n])
    if not out and chars:
        out.append("c:" + chars)
    return out


def build_vectors(texts: list) -> list:
    """Return L2-normalized TF-IDF vectors as {term: weight} dicts."""
    tfs = []
    df = {}
    for text in texts:
        tf = {}
        for tok in terms(text):
            tf[tok] = tf.get(tok, 0) + 1
        tfs.append(tf)
        for tok in tf:
            df[tok] = df.get(tok, 0) + 1
    n_docs = max(len(texts), 1)
    vectors = []
    for tf in tfs:
        vec = {}
        norm_sq = 0.0
        for tok, count in tf.items():
            idf = math.log((1.0 + n_docs) / (1.0 + df[tok])) + 1.0
            w = (1.0 + math.log(count)) * idf
            vec[tok] = w
            norm_sq += w * w
        norm = math.sqrt(norm_sq) or 1.0
        vectors.append({k: v / norm for k, v in vec.items()})
    return vectors


def cosine(a: dict, b: dict) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(w * b.get(k, 0.0) for k, w in a.items())


def shared_terms(a: dict, b: dict, top: int = 6) -> list:
    """Terms contributing most to the similarity, human-readable."""
    common = []
    for k in a:
        if k in b:
            common.append((a[k] * b[k], k))
    common.sort(key=lambda x: (-x[0], x[1]))
    readable = []
    for _, tok in common[:top]:
        readable.append(tok[2:] if tok[:2] in ("c:", "w:") else tok)
    return readable
