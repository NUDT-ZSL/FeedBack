# -*- coding: utf-8 -*-
"""反馈文本分析:相似度、紧急度、矛盾检测、影响面与优先级计算(纯规则,可解释)"""
import re

def norm_feature(s):
    return re.sub(r"\s+", "", (s or "").strip().lower())

def tokens(text, n=2):
    """中文按 n 元切分,英文/数字按词,用于相似度与关键词重合。"""
    text = re.sub(r"[^0-9a-zA-Z一-鿿]", " ", text or "")
    toks = set()
    for w in text.split():
        if re.fullmatch(r"[a-zA-Z0-9]+", w):
            toks.add(w.lower())
        elif n == 1:
            toks |= set(w)
        elif len(w) == 1:
            toks.add(w)
        else:
            for i in range(len(w) - 1):
                toks.add(w[i:i + 2])
    return toks

def similarity(a, b):
    """单字与二字 Jaccard 各半,缓解中文短文本字面重合稀疏的问题。"""
    return 0.5 * jaccard(tokens(a, 1), tokens(b, 1)) + \
           0.5 * jaccard(tokens(a, 2), tokens(b, 2))

def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

URGENCY_RULES = [
    (5, r"数据丢失|无法使用|无法登录|崩溃|闪退|白屏|泄露|安全"),
    (4, r"报错|失败|异常|丢失|打不开|超时"),
    (3, r"太慢|卡顿|很慢|加载慢|延迟"),
    (2, r"建议|希望|能不能|可不可以|可否|优化"),
]

def urgency_of(text):
    for level, pat in URGENCY_RULES:
        if re.search(pat, text or ""):
            return level
    return 1

URGENCY_LABEL = {5: "阻断性故障", 4: "功能报错", 3: "性能问题", 2: "改进建议", 1: "一般反馈"}

CONTRA_RULES = [
    ("功能去留", "主张保留", r"保留|不要删|别删|还需要|不能没有",
     "主张移除", r"移除|(?<!不要)(?<!别)删除|去掉|砍掉|下线|取消该|取消这个"),
    ("默认行为", "默认开启", r"默认(开启|打开)(?!太)|建议开启|应该打开|希望.{0,4}开启",
     "默认关闭", r"(?<!现在)默认关闭|建议关闭|应该关闭|默认关掉"),
    ("性能感受", "认为偏慢卡顿", r"太慢|卡顿|很慢|加载慢|超时",
     "认为流畅正常", r"流畅|速度很快|不卡|秒开"),
    ("易用性", "认为难用", r"难用|复杂|找不到|不直观|难找",
     "认为好用", r"好用|方便|简单|直观"),
    ("稳定性", "反馈存在故障", r"崩溃|闪退|报错|无法使用|白屏|失败",
     "反馈运行正常", r"很稳定|没有问题|没问题|运行正常|正常使用"),
]

def detect_contradictions(items, rulings):
    """同一诉求下双方说法都保留;若该方面已有裁定记录则标记为已裁定。"""
    found = []
    for aspect, la, pa, lb, pb in CONTRA_RULES:
        side_a = [i["id"] for i in items if re.search(pa, i["text"])]
        side_b = [i["id"] for i in items if re.search(pb, i["text"])]
        # 双方必须来自不同条目,同一条自述正反两面不算渠道间矛盾
        only_a = [x for x in side_a if x not in side_b]
        only_b = [x for x in side_b if x not in side_a]
        if only_a and only_b:
            ruling = rulings.get(aspect)
            found.append({
                "aspect": aspect,
                "side_a": {"label": la, "item_ids": side_a},
                "side_b": {"label": lb, "item_ids": side_b},
                "status": "已裁定" if ruling else "待裁定",
                "ruling": ruling,
            })
    return found

def impact_of(items):
    """影响面 1-5:覆盖渠道数与反馈条数,返回(分值, 解释)。"""
    sources = {i["source"] for i in items}
    score, parts = 1, ["基础 1"]
    if len(sources) >= 3:
        score += 2; parts.append(f"覆盖 {len(sources)} 个渠道 +2")
    elif len(sources) == 2:
        score += 1; parts.append("覆盖 2 个渠道 +1")
    if len(items) >= 4:
        score += 2; parts.append(f"共 {len(items)} 条反馈 +2")
    elif len(items) >= 2:
        score += 1; parts.append(f"共 {len(items)} 条反馈 +1")
    return min(5, score), ";".join(parts)

def priority_of(impact, urgency):
    score = impact * 2 + urgency * 3
    if score >= 13:
        level = "P0"
    elif score >= 10:
        level = "P1"
    elif score >= 7:
        level = "P2"
    else:
        level = "P3"
    return score, level
