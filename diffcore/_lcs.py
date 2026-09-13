"""基于 Myers O(ND) 思路的最长公共子序列（LCS）计算。

采用 Myers 论文中的"中间蛇"（middle snake）分治策略：
时间复杂度 O((N + M) * D)，空间复杂度 O(N + M)，
其中 D 为两个序列之间的最小编辑距离。
相同元素判定为精确相等，不做模糊匹配。
"""


def lcs_matches(a, b):
    """返回序列 a、b 之间一组 LCS 匹配对。

    返回值是 [(i, j), ...] 列表，表示 a[i] == b[j]，
    按 i（同时也是 j）严格递增排列。结果对同一输入完全确定。
    """
    matches = []
    if not a or not b:
        return matches
    # 用显式栈代替递归，避免大输入时触及递归深度限制。
    # 每项为 (a 切片, b 切片, a 偏移, b 偏移)。
    stack = [(a, b, 0, 0)]
    while stack:
        sa, sb, ao, bo = stack.pop()
        n = len(sa)
        m = len(sb)
        # 去掉公共前缀
        p = 0
        lim = n if n < m else m
        while p < lim and sa[p] == sb[p]:
            p += 1
        if p:
            for i in range(p):
                matches.append((ao + i, bo + i))
            sa = sa[p:]
            sb = sb[p:]
            ao += p
            bo += p
            n -= p
            m -= p
        # 去掉公共后缀
        s = 0
        lim = n if n < m else m
        while s < lim and sa[n - 1 - s] == sb[m - 1 - s]:
            s += 1
        if s:
            for i in range(s):
                matches.append((ao + n - 1 - i, bo + m - 1 - i))
            sa = sa[:n - s]
            sb = sb[:m - s]
            n -= s
            m -= s
        if n == 0 or m == 0:
            continue
        x, y, u, v, d = _middle_snake(sa, sb)
        if d <= 0:
            # 编辑距离为 0，两段完全相同（防御性分支，正常不会走到）
            for i in range(n):
                matches.append((ao + i, bo + i))
            continue
        # 记录中间蛇 (x, y) -> (u, v) 上的对角匹配
        for i in range(u - x):
            matches.append((ao + x + i, bo + y + i))
        # 分治左右两段
        stack.append((sa[u:], sb[v:], ao + u, bo + v))
        stack.append((sa[:x], sb[:y], ao, bo))
    matches.sort()
    return matches


def _middle_snake(a, b):
    """在序列 a、b 上寻找中间蛇。

    返回 (x, y, u, v, d)：中间蛇从 (x, y) 到 (u, v)，
    a -> b 的最小编辑距离为 d。
    """
    n = len(a)
    m = len(b)
    delta = n - m
    half = (n + m + 1) >> 1
    size = 2 * half + 3
    vf = [0] * size
    vb = [0] * size
    fo = half + 1          # 正向 V 数组的 k 偏移
    bo = half + 1 - delta  # 反向 V 数组的 k 偏移
    vf[fo + 1] = 0
    vb[bo + delta - 1] = n
    odd = delta & 1

    for d in range(half + 1):
        # 正向搜索：k 取 -d, -d+2, ..., d
        dmin = delta - d + 1
        dmax = delta + d - 1
        for k in range(-d, d + 1, 2):
            fk = fo + k
            if k == -d or (k != d and vf[fk - 1] < vf[fk + 1]):
                x = vf[fk + 1]
            else:
                x = vf[fk - 1] + 1
            y = x - k
            x0 = x
            y0 = y
            while x < n and y < m and a[x] == b[y]:
                x += 1
                y += 1
            vf[fk] = x
            # delta 为奇数时，检查正反向是否重叠
            if odd and dmin <= k <= dmax and x >= vb[bo + k]:
                return x0, y0, x, y, 2 * d - 1
        # 反向搜索：k 取 delta-d, delta-d+2, ..., delta+d
        for k in range(delta - d, delta + d + 1, 2):
            bk = bo + k
            if k == delta + d or (k != delta - d and vb[bk - 1] < vb[bk + 1]):
                x = vb[bk - 1]
            else:
                x = vb[bk + 1] - 1
            y = x - k
            x0 = x
            y0 = y
            while x > 0 and y > 0 and a[x - 1] == b[y - 1]:
                x -= 1
                y -= 1
            vb[bk] = x
            # delta 为偶数时，检查正反向是否重叠
            if not odd and -d <= k <= d and x <= vf[fo + k]:
                return x, y, x0, y0, 2 * d
    raise AssertionError("middle snake not found")  # 理论上不可达
