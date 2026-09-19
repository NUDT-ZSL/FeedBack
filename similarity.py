"""Offline text similarity for short feedback texts.

Uses character unigram+bigram TF-IDF vectors and cosine similarity.
Works for Chinese and mixed-language text without any external model
or tokenizer, and is fully deterministic.
"""
import math
import re
from collections import Counter

_TOKEN_RE = re.compile(r"[a-z0-9]+|[一-鿿]", re.IGNORECASE)


def tokenize(text):
    """Return terms: word tokens for latin/digits, plus character
    unigrams and bigrams for CJK so no segmenter is needed."""
    text = (text or "").lower()
    terms = []
    cjk_chars = []
    for m in _TOKEN_RE.finditer(text):
        tok = m.group(0)
        if re.match(r"^[a-z0-9]+$", tok):
            terms.append("w:" + tok)
        else:
            cjk_chars.append(tok)
            terms.append("c:" + tok)
    for i in range(len(cjk_chars) - 1):
        terms.append("b:" + cjk_chars[i] + cjk_chars[i + 1])
    return terms


class VectorSpace(object):
    """TF-IDF vector space fitted on a fixed corpus (deterministic)."""

    def __init__(self, texts):
        docs = [tokenize(t) for t in texts]
        df = Counter()
        for terms in docs:
            for term in set(terms):
                df[term] += 1
        n = max(len(docs), 1)
        self.idf = {t: math.log((1.0 + n) / (1.0 + c)) + 1.0
                    for t, c in df.items()}
        self.vectors = [self._vectorize(terms) for terms in docs]
        self.doc_terms = [set(terms) for terms in docs]

    def _vectorize(self, terms):
        tf = Counter(terms)
        vec = {}
        norm = 0.0
        for term, count in tf.items():
            w = (1.0 + math.log(count)) * self.idf.get(term, 0.0)
            if term.startswith("b:"):
                w *= 1.5  # CJK bigrams carry the most meaning
            vec[term] = w
            norm += w * w
        norm = math.sqrt(norm) or 1.0
        return {t: w / norm for t, w in vec.items()}

    def similarity(self, i, j):
        """Blend of cosine and weighted Dice: more robust for short
        feedback texts of different lengths than cosine alone."""
        a, b = self.vectors[i], self.vectors[j]
        if len(a) > len(b):
            a, b = b, a
        cosine = sum(w * b.get(t, 0.0) for t, w in a.items())
        inter = sum(min(w, b.get(t, 0.0)) for t, w in a.items())
        sa, sb = sum(a.values()), sum(b.values())
        dice = 2.0 * inter / (sa + sb) if sa + sb else 0.0
        return max(cosine, dice)

    def common_terms(self, i, j, top=8):
        """Top weighted terms shared by two docs: the merge evidence."""
        shared = self.doc_terms[i] & self.doc_terms[j]
        scored = []
        for t in shared:
            w = self.vectors[i].get(t, 0.0) * self.vectors[j].get(t, 0.0)
            scored.append((w, t))
        scored.sort(reverse=True)
        return [t.split(":", 1)[1] for _, t in scored[:top]]

    def keywords(self, indices, top=6):
        """Top TF-IDF terms across a set of docs (cluster keywords)."""
        agg = Counter()
        for i in indices:
            for t, w in self.vectors[i].items():
                agg[t] += w
        return [t.split(":", 1)[1] for t, _ in agg.most_common(top)]
