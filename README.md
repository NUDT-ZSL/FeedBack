# hotspot — 流式热点探测与淘汰决策内核

可嵌入的纯标准库 Python 内核,用于缓存准入与热点探测。不依赖第三方库、
不接真实网络;时间一律使用**整数逻辑时间**,由调用方注入,便于确定性测试。

文件:

- `hotspot.py` — 内核(`Access` + `HotspotKernel`),可直接 import 嵌入
- `main.py` — 命令行接口,每条命令输出一行 JSON
- `test_hotspot.py` — 单元测试(`python -m unittest -v`)

## 数据模型

```python
from hotspot import Access, HotspotKernel

Access(key="user:42")            # weight 默认 1, ts 默认 0
Access(key="user:42", weight=3, ts=100)
```

校验规则(违反即抛 `ValueError`,信息明确):

- `key` 必须是非空字符串
- `weight` 必须是 ≥ 1 的整数
- `ts` 必须是 ≥ 0 的整数

## 衰减频次表

每个 key 维护一个衰减热度分数。新访问 `(key, weight, ts)` 到来时:

```
score = score * decay ** (ts - last_ts) + weight
```

- `decay`(默认 `0.9`)表示每经过一个时间单位分数乘以该因子;必须在
  `(0, 1]` 内,否则构造时报错。`decay=1.0` 表示不衰减。
- 同一 key 的 `ts` 不得小于其 `last_ts`(乱序访问报错);查询用的 `now`
  早于某 key 的 `last_ts` 时,该 key 按不衰减处理(查询永不失败)。
- 查询接口 `score(key, now=None)`;`now` 缺省时取内核见过的最大 `ts`。

## 淘汰决策:`evict_candidates(n, now=None)`

返回当前热度最低的 `n` 个 key,按 **(score 升序, key 升序)** 排列,顺序稳定。

**min_score 优先规则**:任何 score < `min_score`(构造时配置,默认 `0`)的
key 永远排在候选最前面,且即使数量超过 `n` 也全部包含在结果里(此时返回
列表长度可以大于 `n`)。`n=0` 时返回的恰好是全部低于 `min_score` 的 key。

## 缓存准入:`admit(key, now=None)`

- 缓存未满(`len(cache) < capacity`)→ 直接准入;
- 缓存已满 → 当且仅当该 key 的热度 **不低于** 当前缓存中最低热度时准入,
  并挤掉最低热度的 key(并列时淘汰字典序最小的缓存 key,新 key 准入);
- 已在缓存中的 key 直接返回 `True`。

`capacity` 构造时配置(默认 1024,必须 ≥ 1)。`kernel.cache` 返回当前缓存
key 列表(排序后)。

## 突增检测:`is_burst(key, now=None)` / `burst_keys(now=None)`

每个 key 按 `window`(默认 10 个时间单位)维护当前窗口与前一窗口的加权
计数(计入 `weight`)。判定规则:

- 前一窗口计数为 0 时,当前窗口计数 > 0 即算突增;
- 否则当前窗口计数 > 前一窗口计数 × `burst_factor`(默认 2.0)时算突增。

`window_counts(key, now)` 返回 `(当前窗口计数, 前一窗口计数)`。

## max_keys 上限策略

- `max_keys=None`(默认):**精确模式**,频次表不设上限,永不触发上限。
- `max_keys=M`:有界模式。新增第 M+1 个 key 时按 `overflow` 策略处理:
  - `overflow="error"`(默认):抛出 `MaxKeysExceededError`,状态不变;
  - `overflow="evict_lowest"`:先丢弃当前(按访问时刻衰减后)热度最低的
    key(并列取字典序最小),再插入新 key。

## 持久化:`save(path)` / `HotspotKernel.load(path)`

JSON 文件包含 `version`、`config`、`scores`、`windows`、`cache`、`now`。
往返后频次表、窗口状态、缓存集合与配置完全一致,继续 `add` 的结果与不
落盘时相同。以下情况抛出带明确信息的 `ValueError`:

- 文件不存在 / 不可读;
- 非法 JSON;
- 顶层不是对象、缺少必需字段、版本不支持;
- 任一字段类型或取值非法(配置项会经构造函数重新校验)。

## 命令行接口

每条命令在 stdout 输出**一行 JSON**;任何错误输出 `{"error": "..."}` 且
退出码非 0。状态保存在 `--state` 指定的文件(默认 `./hotspot_state.json`)。

```bash
python main.py --state s.json init [--decay 0.9] [--min-score 0] \
       [--capacity 1024] [--max-keys M] [--window 10] \
       [--burst-factor 2.0] [--overflow error|evict_lowest]
python main.py --state s.json add KEY [--weight W] --ts T
python main.py --state s.json score KEY [--now T]
python main.py --state s.json evict [--n N] [--now T]
python main.py --state s.json admit KEY [--now T]
python main.py --state s.json burst KEY [--now T]
python main.py --state s.json bursts [--now T]
python main.py --state s.json status
python main.py --state s.json save --path backup.json
python main.py --state s.json load --path backup.json
```

示例输出:

```json
{"ok": true, "key": "user:42", "score": 2.9}
{"candidates": [{"key": "a", "score": 0.1}, {"key": "b", "score": 1.3}]}
{"key": "user:42", "admitted": true, "cache": ["user:42", "user:7"]}
{"key": "user:42", "burst": true, "current": 5, "previous": 1}
{"error": "decay must be in (0, 1], got 1.5"}
```

## 嵌入用法

```python
from hotspot import Access, HotspotKernel, MaxKeysExceededError

kernel = HotspotKernel(decay=0.9, capacity=100, min_score=0.5,
                       max_keys=10_000, overflow="error")

for rec in upstream:                      # 上游不断推来访问记录
    try:
        kernel.add(Access(key=rec.key, weight=rec.weight, ts=rec.ts))
    except MaxKeysExceededError:
        ...                               # 有界模式下超限

kernel.evict_candidates(10)               # 现在最该淘汰的 10 个 key
kernel.is_burst("user:42")                # 某 key 是否突然变热
if kernel.admit("user:42"):               # 是否值得进缓存(自动挤掉最冷 key)
    ...
kernel.save("state.json")                 # 可随时落盘 / 恢复
```
