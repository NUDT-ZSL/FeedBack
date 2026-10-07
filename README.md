# 古风卷轴画廊 · 收藏链路版

基于 React + TypeScript + Vite 的离线古风卷轴画廊。收藏状态以**单一事实来源（raw 原始记录）**存储，
收藏结果、印章、题跋、顺序全部沿依赖链推导，并支持单条修改/清除后的**局部重推**与批量离线验证。

## 运行

```bash
npm install
npm run dev        # http://localhost:8080，素材全部本地化，断网可用
npm run verify     # 收藏链路离线批量验证（Node >= 22，无浏览器/网络依赖）
npm run build      # 类型检查 + 生产构建
```

## 收藏状态依赖链

```
RawCollectionState（唯一事实来源，localStorage 持久化）
        │
        ├─ 卷轴目录(本地样例) ──► 单条裁决 adjudicateEntry
        │                            ├─ 题跋：非字符串回退空、>100 字截断，留痕
        │                            └─ 印章 adjudicateSeal：
        │                                 形状/颜色必须在既有枚举内，否则整条拒绝
        │                                 旋转 [0,15]、位置 [0,1] 越界钳制、缺失回退
        │                                 每个裁决都保留 received/边界/resolution
        └─ 全局顺序 resolveOrder：order → 入藏时间 → 原始下标；冲突留痕并重写为连续 0..n-1
                                      │
                                      ▼
                         DerivedCollection（ordered + entries + issues + rejected）
```

- 同一卷轴的收藏结果/印章/题跋在 `entries[scrollId]` 与 `ordered[]` 中共享同一对象，不存在多份副本。
- 局部重推只重算发生变化的切片，顺序作为全局依赖每次重算；局部重推与整体重推共用 `deriveAll`，
  并由验证脚本断言 `deepEqual` 一致、未受影响切片引用不变。
- 越界/缺失/非法枚举不会被静默吞掉：全部进入 `issues`/`rejected`，带问题代码、定位路径、原始取值与处理依据。

## 目录

- `src/collection/domain/raw.ts` — 原始记录类型与裁决问题定义
- `src/collection/domain/adjudicate.ts` — 单条收藏与印章裁决（形状/颜色/旋转/位置/题跋/顺序）
- `src/collection/domain/derive.ts` — 依赖链推导、顺序冲突裁决、切片哈希、整体/局部共用推导入口
- `src/collection/engine.ts` — 收藏引擎：增改清除、局部重推、订阅、持久化、整体重推对照
- `src/collection/storage/localStorage.ts` — 可替换的键值存储适配（离线验证可注入内存实现）
- `src/collection/hooks/useCollection.ts` — React 侧唯一状态入口
- `src/components/` — `Gallery` / `ScrollDetail` / `UserWall`，只读取引擎推导结果
- `src/data/scrolls.ts`、`public/samples/*.svg` — 稳定 id 的本地卷轴目录与素材
- `scripts/verify/collection.verify.ts` — 统一批量验证入口

## 批量验证覆盖

`npm run verify` 共 18 项断言，覆盖：正常收藏、印章旋转/位置越界、未知形状/颜色拒绝、
篆字形状不符、题跋为空、题跋超长截断、顺序冲突与确定性决胜、单条题跋/印章修改与清除后的
局部重推一致性、纯顺序调整不重推切片、持久化回环、未知/重复卷轴拒绝、revision 内容确定性。
