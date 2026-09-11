"""验收演练：多 tag、几万随机字符串，对拍精确 set。

运行::

    python acceptance_check.py

检查项（全部通过则进程退出码 0）：
1. contains 零假阴性；经验假阳性率落在理论估算的 ±5σ 内；
2. estimate_cardinality 相对误差 < 10%；
3. union/intersect/difference 与精确集合运算对拍（track_keys 精确路径）；
   纯位图 union/intersect 同样验证零假阴性；
4. max_bits 触发后抛 CapacityError 且内核状态不变；
5. save/load 往返后继续 insert，成员判定与基数保持一致。
"""

from __future__ import annotations

import json
import os
import random
import string
import sys
import tempfile

from bloom_kernel import (
    BloomKernel,
    CapacityError,
    ExactKernel,
    Item,
    PersistenceError,
)

ALPHABET = string.ascii_letters + string.digits


def rand_keys(n: int, rng: random.Random) -> list:
    out, seen = [], set()
    while len(out) < n:
        key = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(6, 24)))
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        raise SystemExit(f"验收失败: {name}")


def main() -> None:
    rng = random.Random(20260911)
    tags = ["shard-1", "shard-2", "shard-3", "shard.4/x"]
    per_tag = 30000
    m, k = 1 << 20, 7

    print(f"== 构造 {len(tags)} 个 tag × {per_tag} 条随机 key，m={m}, k={k} ==")
    bloom = BloomKernel(default_m=m, default_k=k, max_bits=8 << 20)
    exact = ExactKernel()
    data: dict = {}
    for t_idx, tag in enumerate(tags):
        keys = rand_keys(per_tag, rng)
        data[tag] = set(keys)
        for seq, key in enumerate(keys, 1):
            bloom.insert(Item(key, tag, seq))
            exact.insert(Item(key, tag, seq))

    # ---- 1. 假阴性 / 假阳性 ------------------------------------------------
    total_checks = 0
    for tag in tags:
        for key in data[tag]:
            assert bloom.contains(tag, key), f"假阴性! tag={tag} key={key}"
            total_checks += 1
    check("contains 零假阴性", True, f"核对真实成员 {total_checks} 个")

    # 取一批确定没插过的 key 测经验 FPR
    absent = rand_keys(50000, rng)
    present_all = set().union(*data.values())
    absent = [x for x in absent if x not in present_all][:40000]
    for tag in tags:
        theory = bloom.false_positive_rate(tag)
        hits = sum(bloom.contains(tag, key) for key in absent)
        empirical = hits / len(absent)
        sigma = (theory * (1 - theory) / len(absent)) ** 0.5
        within = abs(empirical - theory) <= 5 * sigma
        check(
            f"FPR 经验≈理论 ({tag})", within,
            f"理论={theory:.6f} 经验={empirical:.6f} 5σ={5*sigma:.6f} "
            f"填充率={bloom.fill_ratio(tag):.4f}",
        )

    # ---- 2. 基数估算 -------------------------------------------------------
    for tag in tags:
        true_n = len(data[tag])
        est = bloom.estimate_cardinality(tag)
        rel = abs(est - true_n) / true_n
        check(
            f"基数估算相对误差<10% ({tag})", rel < 0.10,
            f"真实={true_n} 估算={est} 相对误差={rel:.2%}",
        )

    # ---- 3. 集合运算（精确路径 + 位图路径） ---------------------------------
    a_keys = set(rand_keys(8000, rng))
    b_keys = set(rand_keys(8000, rng))
    # 人为制造 3000 重叠
    overlap = set(rand_keys(3000, rng))
    a_keys |= overlap
    b_keys |= overlap

    def build(keys, tag, track: bool):
        bf = BloomKernel(default_m=1 << 18, default_k=7, track_keys=track)
        for seq, key in enumerate(keys, 1):
            bf.insert(Item(key, tag, seq))
        return bf

    tag = "setops"
    # 精确路径：差集也必须零假阴性
    a_ex, b_ex = build(a_keys, tag, True), build(b_keys, tag, True)
    u, i, d = a_ex.union(b_ex), a_ex.intersect(b_ex), a_ex.difference(b_ex)
    for key in a_keys | b_keys:
        assert u.contains(tag, key)
    for key in a_keys & b_keys:
        assert i.contains(tag, key)
    for key in a_keys - b_keys:
        assert d.contains(tag, key)
    check(
        "精确路径 union/intersect/difference 零假阴性且大小精确",
        (u.stats()[tag]["distinct"] == len(a_keys | b_keys)
         and i.stats()[tag]["distinct"] == len(a_keys & b_keys)
         and d.stats()[tag]["distinct"] == len(a_keys - b_keys)),
        f"并={len(a_keys | b_keys)} 交={len(a_keys & b_keys)} 差={len(a_keys - b_keys)}",
    )

    # 位图路径：union/intersect 零假阴性；交集 FPR 不高于原集合
    a_bf, b_bf = build(a_keys, tag, False), build(b_keys, tag, False)
    ub, ib = a_bf.union(b_bf), a_bf.intersect(b_bf)
    for key in a_keys | b_keys:
        assert ub.contains(tag, key)
    for key in a_keys & b_keys:
        assert ib.contains(tag, key)
    check(
        "位图路径 union/intersect 零假阴性，交集 FPR 不升高",
        ib.false_positive_rate(tag) <= a_bf.false_positive_rate(tag),
        f"交集 FPR={ib.false_positive_rate(tag):.5f} "
        f"<= 左 FPR={a_bf.false_positive_rate(tag):.5f}",
    )

    # 原内核不被运算修改
    before = a_bf.to_dict()["shards"][tag]["bits_hex"]
    a_bf.union(b_bf)
    a_bf.intersect(b_bf)
    a_bf.difference(b_bf)
    check("集合运算不修改原内核",
          a_bf.to_dict()["shards"][tag]["bits_hex"] == before)

    # ---- 4. max_bits -------------------------------------------------------
    cap = BloomKernel(default_m=256, default_k=3, max_bits=256)
    cap.insert(Item("x", "first", 1))
    rejected = False
    try:
        cap.insert(Item("y", "second", 1))
    except CapacityError:
        rejected = True
    check(
        "max_bits 超限拒绝插入且状态不变",
        rejected and cap.tags() == ["first"] and cap.total_bits == 256,
        f"tags={cap.tags()} total_bits={cap.total_bits}",
    )
    zero = BloomKernel(default_m=8, default_k=1, max_bits=0)
    try:
        zero.insert(Item("x", "t", 1))
        rejected = False
    except CapacityError:
        rejected = True
    check("max_bits=0 拒绝一切插入", rejected and zero.tags() == [])

    # ---- 5. save/load 往返后继续插入 ---------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "snapshot.json")
        bloom.save(path)
        restored = BloomKernel.load(path)
        for tag in tags:
            for key in list(data[tag])[:100]:
                assert restored.contains(tag, key)
        new_keys = rand_keys(500, rng)
        for seq, key in enumerate(new_keys, 100000):
            restored.insert(Item(key, "new-shard", seq))
        for key in new_keys:
            assert restored.contains("new-shard", key)
        path2 = os.path.join(tmp, "snapshot2.json")
        restored.save(path2)
        again = BloomKernel.load(path2)
        ok = all(again.contains("new-shard", key) for key in new_keys)
        check("save/load 往返 + 继续 insert 一致", ok,
              f"文件大小 {os.path.getsize(path) // 1024} KiB（4 个 2^20 位分片）")

        # 损坏文件必须报清楚
        bad = os.path.join(tmp, "bad.json")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write('{"format": "bloom-kernel", version: broken')
        try:
            BloomKernel.load(bad)
            ok = False
        except PersistenceError as exc:
            ok = "JSON" in str(exc)
        check("损坏快照报清晰错误", ok)

    # ---- 内存占用 ----------------------------------------------------------
    st = bloom.stats()
    total_mem = sum(v["memory_bytes"] for v in st.values())
    check(
        "内存上限明确",
        bloom.total_bits == m * len(tags) and total_mem == (m // 8) * len(tags),
        f"总位数={bloom.total_bits}（上限 {bloom.max_bits}），"
        f"位数组裸内存={total_mem / 1024 / 1024:.2f} MiB",
    )

    print("\n全部验收项通过 [OK]")


if __name__ == "__main__":
    main()
