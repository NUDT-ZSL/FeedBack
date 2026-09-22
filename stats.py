# -*- coding: utf-8 -*-
"""统计检验工具：双比例 z 检验与样本量充足性判断。"""
import math


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def two_proportion_ztest(x1, n1, x2, n2):
    """双比例 z 检验，返回 (z, p)。任一侧样本为 0 时返回 (None, None)。"""
    if n1 <= 0 or n2 <= 0:
        return None, None
    p_pool = (x1 + x2) / float(n1 + n2)
    se = math.sqrt(p_pool * (1.0 - p_pool) * (1.0 / n1 + 1.0 / n2))
    if se == 0:
        return 0.0, 1.0
    z = (x1 / float(n1) - x2 / float(n2)) / se
    p = 2.0 * (1.0 - norm_cdf(abs(z)))
    return z, max(0.0, min(1.0, p))


def sample_adequacy(x1, n1, x2, n2, min_entrants=100):
    """样本量充足性：双侧进入人数达标且期望格子计数 >= 5。返回 (是否充足, 说明列表)。"""
    notes = []
    ok = True
    for label, x, n in (("实验侧", x1, n1), ("基准侧", x2, n2)):
        if n < min_entrants:
            ok = False
            notes.append("%s进入人数 %d 低于最小样本量 %d。" % (label, n, min_entrants))
        else:
            p = x / float(n)
            if min(n * p, n * (1.0 - p)) < 5:
                ok = False
                notes.append("%s期望转化/未转化格子计数不足 5，渐近检验不可靠。" % label)
    if not notes:
        notes.append("样本量充足（双侧进入人数 >= %d 且期望格子计数 >= 5）。" % min_entrants)
    return ok, notes
