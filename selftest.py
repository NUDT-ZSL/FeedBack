"""delta_kernel 自测脚本。

构造随机二进制文件做增删改，验证 apply(diff(old, new)) 与 new 逐字节相同，
并打印分块数、COPY/INSERT 字节占比和干跑统计。同时覆盖边界与错误处理。
"""

import os
import random
import shutil
import sys
import tempfile

import delta_kernel as dk


def files_equal(a, b):
    """逐字节比较两个文件（流式）。"""
    if os.path.getsize(a) != os.path.getsize(b):
        return False
    with open(a, "rb") as fa, open(b, "rb") as fb:
        while True:
            ba = fa.read(1 << 20)
            bb = fb.read(1 << 20)
            if ba != bb:
                return False
            if not ba:
                return True


def chunk_boundaries(path, params):
    return [(off, len(data)) for off, data in dk.iter_chunks(path, params)]


def make_pair(tmp):
    """构造 old(4MB 随机) 与 new（含插入、删除、修改、追加）。"""
    rng = random.Random(20260912)
    old = rng.randbytes(4 * 1024 * 1024)

    new = bytearray()
    new += old[:1_000_000]                      # 头部保留
    new += rng.randbytes(200_000)               # 插入全新数据
    seg = bytearray(old[1_000_000:2_500_000])   # 中段保留但做修改
    for pos in (0, 12345, 700_000, len(seg) - 1):
        seg[pos] ^= 0xFF
    new += seg
    # 删除 old[2_500_000:3_000_000] 共 500KB
    new += old[3_000_000:]                      # 尾部平移保留
    new += rng.randbytes(100_000)               # 末尾追加

    old_path = os.path.join(tmp, "old.bin")
    new_path = os.path.join(tmp, "new.bin")
    with open(old_path, "wb") as f:
        f.write(old)
    with open(new_path, "wb") as f:
        f.write(new)
    return old_path, new_path


def pct(part, total):
    return 0.0 if total == 0 else 100.0 * part / total


def main():
    tmp = tempfile.mkdtemp(prefix="delta-selftest-")
    try:
        params = dk.ChunkParams(min_size=1024, max_size=8192, mask_bits=11)
        old_path, new_path = make_pair(tmp)
        out_path = os.path.join(tmp, "out.bin")
        old_size = os.path.getsize(old_path)
        new_size = os.path.getsize(new_path)

        print(f"old = {old_size} 字节, new = {new_size} 字节")
        print(f"分块参数: min={params.min_size}, max={params.max_size}, "
              f"mask_bits={params.mask_bits}")

        # --- 分块确定性与读取顺序无关 ---
        b1 = chunk_boundaries(old_path, params)
        b2 = chunk_boundaries(old_path, params)
        assert b1 == b2, "同样输入两次分块结果不一致"
        saved_read_size = dk.READ_SIZE
        try:
            dk.READ_SIZE = 64 * 1024  # 改变每次 read 的大小
            b3 = chunk_boundaries(old_path, params)
        finally:
            dk.READ_SIZE = saved_read_size
        assert b1 == b3, "分块结果受读取块大小影响"
        old_chunks = len(b1)
        new_chunks = len(chunk_boundaries(new_path, params))
        print(f"分块数: old={old_chunks}, new={new_chunks} "
              f"(平均块长 old={old_size / max(old_chunks, 1):.0f} 字节)")

        # --- diff / apply 往返 ---
        patch = dk.diff(old_path, new_path, params)
        copy_bytes, insert_bytes, icount = patch.stats()
        total = copy_bytes + insert_bytes
        print(f"指令数: {icount}  "
              f"COPY={copy_bytes} 字节 ({pct(copy_bytes, total):.1f}%), "
              f"INSERT={insert_bytes} 字节 ({pct(insert_bytes, total):.1f}%)")
        print(f"补丁序列化大小: {len(patch.to_bytes())} 字节 "
              f"(new 文件的 {pct(len(patch.to_bytes()), new_size):.1f}%)")

        stats = dk.apply(old_path, patch, out_path)
        assert stats == (copy_bytes, insert_bytes, icount)
        assert files_equal(out_path, new_path), "apply 结果与 new 不一致"
        print("apply(diff(old,new)) 与 new 逐字节相同: OK")

        # --- 补丁序列化往返 ---
        patch2 = dk.Patch.from_bytes(patch.to_bytes())
        assert patch2.stats() == patch.stats()
        dk.apply(old_path, patch2, out_path)
        assert files_equal(out_path, new_path)
        print("补丁序列化/反序列化往返: OK")

        # --- dry_run：不落盘，统计一致 ---
        assert not os.path.exists(out_path + ".dry")
        dry = dk.apply(old_path, patch, out_path + ".dry", dry_run=True)
        assert dry == (copy_bytes, insert_bytes, icount)
        assert not os.path.exists(out_path + ".dry"), "dry_run 不应创建文件"
        print(f"dry_run 统计: copy={dry[0]}, insert={dry[1]}, "
              f"instructions={dry[2]} (未落盘: OK)")

        # --- 边界情况 ---
        empty = os.path.join(tmp, "empty.bin")
        open(empty, "wb").close()

        # 空 old -> 全新文件：全部 INSERT
        p = dk.diff(empty, new_path, params)
        s = dk.apply(empty, p, os.path.join(tmp, "o1.bin"), dry_run=True)
        assert s[0] == 0 and s[1] == new_size and s[2] >= 1
        print(f"空 old -> new: dry_run={s} (全 INSERT: OK)")

        # old == new：全部 COPY
        p = dk.diff(old_path, old_path, params)
        s = dk.apply(old_path, p, os.path.join(tmp, "o2.bin"), dry_run=True)
        assert s[0] == old_size and s[1] == 0
        print(f"old == new: dry_run={s} (全 COPY: OK)")

        # 完全无重叠：全部 INSERT
        other = os.path.join(tmp, "other.bin")
        with open(other, "wb") as f:
            f.write(random.Random(7).randbytes(1 * 1024 * 1024))
        p = dk.diff(old_path, other, params)
        s = dk.apply(old_path, p, os.path.join(tmp, "o3.bin"), dry_run=True)
        assert s[0] == 0 and s[1] == os.path.getsize(other)
        print(f"完全无重叠: dry_run={s} (全 INSERT: OK)")

        # 空 -> 空：零指令，不除零
        p = dk.diff(empty, empty, params)
        s = dk.apply(empty, p, os.path.join(tmp, "o4.bin"), dry_run=True)
        assert s == (0, 0, 0)
        dk.apply(empty, p, os.path.join(tmp, "o4.bin"))
        assert os.path.getsize(os.path.join(tmp, "o4.bin")) == 0
        print(f"空 -> 空: dry_run={s} (零指令: OK)")

        # --- 校验失败：PatchMismatch 且不留半成品 ---
        bad_old = os.path.join(tmp, "old-corrupt.bin")
        shutil.copyfile(old_path, bad_old)
        first_copy = next(i for i in patch.instructions
                          if isinstance(i, dk.Copy))
        with open(bad_old, "r+b") as f:
            f.seek(first_copy.offset)
            b = bytearray(f.read(1))
            b[0] ^= 0xFF
            f.seek(first_copy.offset)
            f.write(b)
        half = os.path.join(tmp, "half.bin")
        try:
            dk.apply(bad_old, patch, half)
            raise AssertionError("应抛出 PatchMismatch")
        except dk.PatchMismatch as e:
            assert "第" in str(e) and "条指令" in str(e)
            assert not os.path.exists(half), "校验失败后不得留下半成品"
            print(f"篡改 old 后 apply 抛出 PatchMismatch 且无半成品: OK ({e})")

        # --- 错误处理 ---
        try:
            dk.diff(os.path.join(tmp, "nope.bin"), new_path)
            raise AssertionError("应抛出 FileNotFoundError")
        except FileNotFoundError:
            print("文件不存在 -> FileNotFoundError: OK")

        for kwargs in ({"mask_bits": 0}, {"mask_bits": 64},
                       {"min_size": 100, "max_size": 50},
                       {"min_size": 0}):
            try:
                dk.ChunkParams(**kwargs)
                raise AssertionError(f"应抛出 ValueError: {kwargs}")
            except ValueError as e:
                print(f"参数 {kwargs} -> ValueError: OK ({e})")

        try:
            dk.Patch.from_bytes(b"BADMAGIC!!" + b"\x00" * 64)
            raise AssertionError("应抛出 UnsupportedPatch")
        except dk.UnsupportedPatch:
            print("魔数错误 -> UnsupportedPatch: OK")
        try:
            blob = bytearray(patch.to_bytes())
            blob[8] = 99  # 篡改版本号
            dk.Patch.from_bytes(bytes(blob))
            raise AssertionError("应抛出 UnsupportedPatch")
        except dk.UnsupportedPatch as e:
            print(f"版本号不认识 -> UnsupportedPatch: OK ({e})")

        # --- FingerprintIndex 基本行为 ---
        idx = dk.FingerprintIndex()
        data = b"hello delta" * 100
        cid = dk.FingerprintIndex.strong(data)
        idx.add(cid, data)
        assert idx.lookup(data) == cid
        assert idx.lookup(data + b"x") is None
        assert idx.lookup(b"x" + data[1:]) is None
        try:
            idx.add(b"\x00" * 16, data)
            raise AssertionError("应抛出 ValueError")
        except ValueError:
            print("FingerprintIndex 强哈希复核与入索引校验: OK")

        print("\n全部自测通过。")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
