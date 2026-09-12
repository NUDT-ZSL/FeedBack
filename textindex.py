"""可嵌入的流式文本分词与位置倒排索引内核。

纯标准库实现，面向本地日志/文档检索场景：

- ``tokenize``：按 Unicode 规则切分文本，CJK 汉字逐字成词，
  英文/数字连续字符合成一个词，标点与空白丢弃。
- ``InvertedIndex``：支持增量写入（重复 doc_id 覆盖写）、按词项
  AND/OR 检索并返回命中字符偏移、删除文档与实时统计。

位置一律使用 Python 字符偏移（不是字节偏移）。
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["Token", "SearchHit", "tokenize", "InvertedIndex"]


@dataclass(frozen=True)
class Token:
    """一个词项及其在原文中的字符区间 [start, end)。"""

    term: str
    start: int
    end: int


@dataclass(frozen=True)
class SearchHit:
    """单文档命中结果。

    positions: 查询词 -> 该文档中命中的字符起始偏移列表（升序去重）。
    """

    doc_id: str
    score: float
    positions: dict[str, list[int]] = field(default_factory=dict)


def _is_cjk(ch: str) -> bool:
    """是否为 CJK 表意文字（汉字），这类字符每个单独成词。"""
    o = ord(ch)
    return (
        0x4E00 <= o <= 0x9FFF      # CJK 统一表意文字
        or 0x3400 <= o <= 0x4DBF   # 扩展 A
        or 0xF900 <= o <= 0xFAFF   # 兼容表意文字
        or 0x20000 <= o <= 0x2A6DF  # 扩展 B
        or 0x2A700 <= o <= 0x2CEAF  # 扩展 C-F
    )


def tokenize(
    text: str,
    *,
    lowercase: bool = True,
    keep_numbers: bool = True,
) -> list[Token]:
    """把文本切成 Token 列表。

    规则：
    - CJK 汉字每个字单独成一个词；
    - 其余 Unicode 字母/数字连续片段合成一个词；
    - 标点、空白、符号一律丢弃；
    - ``lowercase=True`` 时词项折叠为小写（偏移仍指向原文）；
    - ``keep_numbers=False`` 时丢弃纯数字词项。
    """
    tokens: list[Token] = []
    buf: list[str] = []
    buf_start = 0

    def flush(end: int) -> None:
        nonlocal buf, buf_start
        if not buf:
            return
        term = "".join(buf)
        if lowercase:
            term = term.lower()
        if keep_numbers or not term.isdigit():
            tokens.append(Token(term=term, start=buf_start, end=end))
        buf = []

    for i, ch in enumerate(text):
        if _is_cjk(ch):
            flush(i)
            term = ch.lower() if lowercase else ch
            tokens.append(Token(term=term, start=i, end=i + 1))
        elif ch.isalnum():
            if not buf:
                buf_start = i
            buf.append(ch)
        else:
            flush(i)
    flush(len(text))
    return tokens


class InvertedIndex:
    """位置倒排索引：term -> {doc_id: [起始偏移, ...]}。"""

    def __init__(self, *, lowercase: bool = True, keep_numbers: bool = True) -> None:
        self._lowercase = lowercase
        self._keep_numbers = keep_numbers
        # term -> {doc_id: sorted list of char offsets}
        self._postings: dict[str, dict[str, list[int]]] = {}
        # doc_id -> 该文档包含的词项（用于覆盖写/删除时反查）
        self._doc_terms: dict[str, list[str]] = {}
        self._doc_lengths: dict[str, int] = {}

    # ------------------------------------------------------------------ #
    # 写入
    # ------------------------------------------------------------------ #
    def add_document(self, doc_id: str, text: str) -> int:
        """增量写入文档，返回该文档的词项数（token 数）。

        重复 doc_id 视为覆盖写：先移除旧 posting 再写入新的。
        doc_id 为空字符串时抛 ValueError。
        """
        if not doc_id:
            raise ValueError("doc_id 不能为空字符串")
        if doc_id in self._doc_terms:
            self.remove_document(doc_id)

        tokens = tokenize(
            text,
            lowercase=self._lowercase,
            keep_numbers=self._keep_numbers,
        )
        terms: dict[str, list[int]] = {}
        for tok in tokens:
            terms.setdefault(tok.term, []).append(tok.start)

        for term, positions in terms.items():
            self._postings.setdefault(term, {})[doc_id] = positions
        self._doc_terms[doc_id] = list(terms)
        self._doc_lengths[doc_id] = len(tokens)
        return len(tokens)

    def remove_document(self, doc_id: str) -> bool:
        """删除文档；不存在时返回 False。"""
        terms = self._doc_terms.pop(doc_id, None)
        if terms is None:
            return False
        self._doc_lengths.pop(doc_id, None)
        for term in terms:
            docs = self._postings.get(term)
            if docs is None:
                continue
            docs.pop(doc_id, None)
            if not docs:
                del self._postings[term]
        return True

    # ------------------------------------------------------------------ #
    # 检索
    # ------------------------------------------------------------------ #
    def search(
        self,
        query: str,
        *,
        mode: str = "AND",
        limit: int | None = None,
    ) -> list[SearchHit]:
        """按词项检索。

        - mode="AND"：所有（去重后的）查询词都命中；mode="OR"：命中任一即可。
        - score = 命中词数 / 去重后查询词数；同分按 doc_id 升序稳定排序。
        - limit=None 返回全部；limit<=0 返回空列表。
        - 空查询或全是标点的查询返回空列表，不抛异常。
        """
        if mode not in ("AND", "OR"):
            raise ValueError(f"不支持的 mode: {mode!r}")
        if limit is not None and limit <= 0:
            return []

        query_terms: list[str] = []
        seen: set[str] = set()
        for tok in tokenize(
            query,
            lowercase=self._lowercase,
            keep_numbers=self._keep_numbers,
        ):
            if tok.term not in seen:
                seen.add(tok.term)
                query_terms.append(tok.term)
        if not query_terms:
            return []

        # doc_id -> {term: positions}
        matched: dict[str, dict[str, list[int]]] = {}
        for term in query_terms:
            for doc_id, positions in self._postings.get(term, {}).items():
                matched.setdefault(doc_id, {})[term] = positions

        total = len(query_terms)
        hits: list[SearchHit] = []
        for doc_id, term_positions in matched.items():
            if mode == "AND" and len(term_positions) < total:
                continue
            positions = {
                term: sorted(set(pos)) for term, pos in term_positions.items()
            }
            hits.append(
                SearchHit(
                    doc_id=doc_id,
                    score=len(term_positions) / total,
                    positions=positions,
                )
            )

        hits.sort(key=lambda h: (-h.score, h.doc_id))
        if limit is not None:
            hits = hits[:limit]
        return hits

    # ------------------------------------------------------------------ #
    # 统计
    # ------------------------------------------------------------------ #
    def stats(self) -> dict[str, int]:
        """实时统计：文档数、不同词项数、posting（位置条目）总数。"""
        return {
            "doc_count": len(self._doc_terms),
            "term_count": len(self._postings),
            "posting_count": sum(
                len(positions)
                for docs in self._postings.values()
                for positions in docs.values()
            ),
        }
