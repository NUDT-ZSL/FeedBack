"""跨语言文本归一化与相似度。

目标是“同一句话的不同语言字幕”之外的**共有词**锚点（人名、专有名词、
数字、品牌等）也能匹配上，同时对大小写、标点、全半角、空白不敏感。
不同语言的虚词自然不同，因此相似度采用基于词集合/字符二元组的混合度量，
纯翻译文本（无共有词）相似度会很低，不会被误锚。
"""

from __future__ import annotations

import re
import unicodedata
from typing import List, Set, Tuple

# 统一替换为空格的标点（含 CJK 标点）。
_PUNCT = "".join(
    chr(c)
    for c in range(0x110000)
    if unicodedata.category(chr(c)).startswith("P") or unicodedata.category(chr(c)).startswith("S")
)
_PUNCT_RE = re.compile(f"[{re.escape(_PUNCT)}]+")
_WS_RE = re.compile(r"\s+")
_DIGIT_RE = re.compile(r"\d")


def normalize(text: str) -> str:
    """归一化为 NFKC、小写、标点转空格、压缩空白后的字符串。"""
    if text is None:
        return ""
    s = unicodedata.normalize("NFKC", str(text))
    s = s.lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def tokens(text: str) -> List[str]:
    """切词：空白分词 + 连续 CJK 字符拆为单字。"""
    norm = normalize(text)
    if not norm:
        return []
    out: List[str] = []
    for part in norm.split(" "):
        if not part:
            continue
        buf = ""
        for ch in part:
            if _is_cjk(ch):
                if buf:
                    out.append(buf)
                    buf = ""
                out.append(ch)
            else:
                buf += ch
        if buf:
            out.append(buf)
    return out


def _is_cjk(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x4E00 <= cp <= 0x9FFF
        or 0x3400 <= cp <= 0x4DBF
        or 0xF900 <= cp <= 0xFAFF
        or 0x20000 <= cp <= 0x2A6DF
    )


def similarity(text_a: str, text_b: str) -> float:
    """返回 0~1 的相似度，确定、对称。

    混合策略，取三者最大值：

    * 归一化完全相等 → 1.0；
    * 词集合 Jaccard（捕捉共有专有名词/数字）；
    * 字符二元组 Dice 系数（捕捉拼写相近与 CJK 部分重合）；
    * **实词覆盖分** ``0.5 + 0.5·cover``：实词 = 含数字或长度≥3 的词，
      ``cover = 共有实词数 / min(双方实词数)``。跨语言字幕里真正可靠的
      锚点是人名/品牌/数字（NASA、2024），它们在翻译句中往往只出现一次，
      用 Jaccard 会被长短句稀释，实词覆盖避免该问题；单调双射匹配与
      模糊锚点上限会抑制单个共有词造成的偶然误锚。
    """
    a = normalize(text_a)
    b = normalize(text_b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0

    ta, tb = set(tokens(a)), set(tokens(b))
    if ta or tb:
        inter = len(ta & tb)
        jaccard = inter / len(ta | tb) if (ta | tb) else 0.0
    else:
        jaccard = 0.0

    bg_a = _bigrams(a.replace(" ", ""))
    bg_b = _bigrams(b.replace(" ", ""))
    if bg_a and bg_b:
        # Dice = 2|A∩B|/(|A|+|B|)
        common = len(bg_a & bg_b)
        dice = 2 * common / (len(bg_a) + len(bg_b))
    else:
        dice = 0.0

    ca = {t for t in ta if _is_content(t)}
    cb = {t for t in tb if _is_content(t)}
    if ca and cb:
        cover = len(ca & cb) / min(len(ca), len(cb))
        # 仅在实词至少半数重合时启用；最高 0.8，与精确匹配（1.0）明确区分。
        coverage_score = 0.4 + 0.4 * cover if cover >= 0.5 else 0.0
    else:
        coverage_score = 0.0

    return max(jaccard, dice, coverage_score)


def _is_content(token: str) -> bool:
    """实词：长度≥3，或至少 2 位的数字。

    单位数数字（条目编号式的 0、1…）跨语言到处出现、区分度太低，
    不单独算锚点信号；年份/数量通常多位，保留。
    """
    if len(token) >= 3:
        return True
    return bool(_DIGIT_RE.search(token)) and len(token) >= 2


def _bigrams(s: str) -> Set[str]:
    return {s[i : i + 2] for i in range(len(s) - 1)}


def shared_signals(text_a: str, text_b: str) -> Tuple[int, bool]:
    """辅助依据：返回 ``(共有词数, 是否共有数字串)``，供报告解释锚点强度。"""
    ta, tb = set(tokens(text_a)), set(tokens(text_b))
    shared = ta & tb
    has_digit = any(_DIGIT_RE.search(w) for w in shared)
    return len(shared), has_digit
