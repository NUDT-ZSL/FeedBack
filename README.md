# 六爻占卜 · 南宋临安卦铺

基于浏览器的六爻起卦与断卦推演应用，纯前端、可离线使用，无需后端。

## 功能

- **投币起卦**：点击铜钱盒摇动三枚铜钱，六次成卦（自下而上），铜钱翻转动画与音效
- **卦象查询**：内置完整六十四卦（卦名、卦辞、彖辞、大象、爻辞、小象），动爻红点标识
- **断卦推演**：按动爻数量自动推导变卦并给出断语
  - 无动爻：变卦同本卦，以本卦卦辞断，不产生变爻结论
  - 一爻动：以本卦动爻爻辞为主，兼参变卦同位爻辞
  - 两爻动：两动爻辞参断，上爻为主
  - 三至五爻动：本卦与变卦卦辞合参
  - 六爻全动：整体取错卦，乾坤以「用九」「用六」断，其余以变卦卦辞断
- **本地归档**：每次成卦自动入档（localStorage），跨刷新保留，按起卦时刻倒序
- **记录管理**：详情页还原卦象与本卦/变卦对照，可补记所问之事、删除单条、清空全部

## 技术栈

React 18 + TypeScript + Vite + Zustand（persist 持久化）+ Tailwind CSS + React Router（Hash 模式）

## 目录结构

```
src/
├── data/hexagramData.ts   # 六十四卦原文数据（卦辞/彖辞/爻辞等）
├── data/hexagrams.ts      # 卦象查询层（二进制→卦，上下卦拆分）
├── store/divinationStore.ts # 起卦流程与归档状态（localStorage 持久化）
├── utils/hexagramCalc.ts  # 变卦推导与断卦推演核心逻辑
├── utils/coinFlip.ts      # 铜钱投掷与爻位判定
├── components/            # 铜钱盒、卦象图、本卦变卦对照、推演面板
└── pages/                 # 起卦页、归档列表页、记录详情页
```

## 约定

- 六爻二进制串索引 0 为初爻（最下），阳为 1、阴为 0，与本卦/变卦严格同序对应
- 记录 ID 由时间戳 + 单调序号 + 随机串组成，同一毫秒连续起卦也不会互相覆盖

## 数据来源

卦辞、爻辞等文本源自开源项目 [freizl/yijing](https://github.com/freizl/yijing)（MIT License）。

## 开发

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建
npm run check    # 类型检查
npm run lint     # 代码检查
```
