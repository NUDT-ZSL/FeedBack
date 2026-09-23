"""Semantic note-threading engine (stdlib only, deterministic).

A thread's derived data (theme, links, stats) is a pure function of its
note set, so recomputing only affected threads always matches a full
recompute of all threads.
"""
import math
import re

LINK_THRESHOLD = 0.12

_CJK_RE = re.compile(r'[一-鿿㐀-䶿]')
_WORD_RE = re.compile(r'[a-z0-9]+')


def tokenize(text):
    """Latin word tokens + CJK unigrams/bigrams (no jieba needed)."""
    text = (text or '').lower()
    tokens = _WORD_RE.findall(text)
    chars = _CJK_RE.findall(text)
    tokens.extend(chars)
    tokens.extend(a + b for a, b in zip(chars, chars[1:]))
    return tokens


def build_vectors(notes):
    """TF-IDF vectors keyed by note id."""
    docs = {n['id']: tokenize(n.get('text', '')) for n in notes}
    df = {}
    for toks in docs.values():
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    n_docs = max(len(docs), 1)
    vectors = {}
    for nid, toks in docs.items():
        tf = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        vec, norm = {}, 0.0
        for t, c in tf.items():
            idf = math.log((1 + n_docs) / (1 + df[t])) + 1.0
            w = (c / max(len(toks), 1)) * idf
            vec[t] = w
            norm += w * w
        norm = math.sqrt(norm) or 1.0
        vectors[nid] = {t: w / norm for t, w in vec.items()}
    return vectors


def cosine(va, vb):
    if len(va) > len(vb):
        va, vb = vb, va
    return sum(w * vb.get(t, 0.0) for t, w in va.items())


def cluster_note_ids(note_ids, vectors, threshold=LINK_THRESHOLD):
    """Deterministic connected-components clustering (union-find)."""
    parent = {n: n for n in note_ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    ids = sorted(note_ids)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if cosine(vectors[a], vectors[b]) >= threshold:
                pa, pb = find(a), find(b)
                if pa != pb:
                    parent[max(pa, pb)] = min(pa, pb)
    groups = {}
    for n in ids:
        groups.setdefault(find(n), []).append(n)
    return sorted((sorted(g) for g in groups.values()), key=lambda g: g[0])
