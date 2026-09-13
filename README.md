# 信号处理内核（纯 Python 标准库）

离线传感器信号处理内核：滤波、频域分析、重采样、时间轴对齐、JSON 持久化。
不依赖 numpy/scipy，只用标准库（`math` / `cmath` / `json` / `fractions` / `dataclasses`）。

## 文件

| 文件 | 说明 |
|---|---|
| `signal_kernel.py` | 内核：信号模型、FIR 设计、卷积、FFT、频谱、重采样、对齐、持久化 |
| `main.py` | 命令行入口：从 stdin 逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_signal_kernel.py` | unittest 套件（77 个用例）：`python -m unittest test_signal_kernel -v` |

## 核心约定

- **归一化频率**：所有截止频率用 cycles/sample 表示，0.5 = 奈奎斯特，合法区间为开区间 `(0, 0.5)`。
- **滤波器阶数**：必须为正奇数（偶数抽头）。因此高通/带阻用分数延迟冲激（`sinc(n-c)`）做谱反转。
  注意：偶数抽头对称 FIR 在 f=0.5 处响应恒为 0（结构性零点），带阻/高通的上通带在奈奎斯特处必然滚降到 0。
- **通带归一化口径（四种滤波器统一）**：**通带中心增益 = 1**。归一化参考点：
  - 低通：`cutoff / 2`
  - 高通：`(cutoff + 0.5) / 2`
  - 带通：`(low + high) / 2`
  - 带阻：两个通带中心 `low/2` 与 `(high + 0.5)/2` 的增益取平均归一（两端分别保持在 1 附近；
    恰好在 0.5 处因上述结构性零点为 0）
- **apply_filter**：线性卷积 + 零填充边界，输出与输入等长（以群延迟 `order/2` 为中心截取）。
- **filtfilt**：正反各滤一次，零相位；**有效阶数翻倍**（`2*order`），幅度响应平方
  （通带纹波加倍、阻带抑制 dB 加倍、截止点从 -3dB 变为 -6dB）。
- **FFT**：迭代 radix-2；非 2 的幂长度补零到下一个 2 的幂，补零长度记录在 `Spectrum.zero_padded`。
  幅度谱为单边谱，按窗函数相干增益（`sum(w)`）归一化，单频正弦峰值直接读出振幅。
- **重采样**：`resample(signal, up, down)` 要求 up/down 为互质正整数，按显式两级执行：
  插值级（`up>1` 时：插零 + 低通 `0.5/up`，增益 `up`）→ 抽取级（`down>1` 时：抗混叠低通
  `0.5/down` + 抽取）。输出采样率 `sr*up/down`。结果中**区分两个延迟量**：
  - `filter_group_delay_*`：滤波器链自身引入的群延迟，按各级实际抽头数累计
    （`sum((taps-1)/2)`，中间速率样本计；输出样本计为再除以 `down`）——描述滤波器本身；
  - `time_offset_*`：重采样后时间轴的整体偏移。本实现在抽取切片时精确补偿了群延迟，
    该值恒为 0，输出样本 k 对齐到 `start_time + k/new_rate`——**对齐时间轴请用这个值**。
  各级抽头数、截止、延迟在 `stages` 列表中逐级可查。
- **混叠标记**：当输出奈奎斯特频率低于输入奈奎斯特频率（净下采样）时，输入中高于新奈奎斯特的
  能量会被抗混叠滤波器**移除**（而非折叠回来）。若被移除能量占总能量的比例超过
  `alias_threshold`（默认 1%），结果带 `aliasing_detected=True`、`aliased_band=(新奈奎斯特,
  旧奈奎斯特)`（被移除的频段；若不过滤它会折叠进 `[0, 新奈奎斯特]`）和 `aliased_energy_ratio`。
  `align` 对每个信号在 `Alignment.aliasing` 中给出同样的标记和文字说明。
- **对齐**：`align(signals, target_rate)` 各有理重采样到统一速率后裁剪到公共时间段；
  `Alignment.interp` 线性插值，超范围返回 `(None, 原因)`。
- **NaN/Inf**：构造信号、读入命令、加载文件时一律拒绝并报错，不会静默传播。

## CLI 命令

```
load_signal   {cmd, signal_id, sample_rate, samples|[pairs], start_time?}
design_filter {cmd, filter_id, kind, order, cutoff, window?}     kind: lowpass/highpass/bandpass/bandstop
apply         {cmd, signal_id, filter_id, result_id?}
filtfilt      {cmd, signal_id, filter_id, result_id?}
spectrum      {cmd, signal_id, window?, spectrum_id?}
dominant      {cmd, signal_id, top_n, window?}
resample      {cmd, signal_id, up, down, result_id?}
align         {cmd, signal_ids, target_rate, align_id?}
interp        {cmd, align_id, signal_id, time}
save          {cmd, path}
load          {cmd, path}
dump          {cmd}
```

每条命令输出一行 JSON；错误输出 `{"ok": false, "error": ..., "error_type": ...}`。
`resample` 的响应含 `stages`、`filter_group_delay_*`、`time_offset_*`、`aliasing_detected`、
`aliased_band`、`aliased_energy_ratio`；`align` 的响应含逐信号的 `aliasing` 报告。

## 持久化

`Workspace.save(path)` 把信号、滤波器系数、频谱、重采样配置、对齐结果写入单个 JSON 文件；
`Workspace.load(path)` 重建并校验：signal_id 唯一、采样率为正、样本有限、滤波器阶数为正奇数
且系数与设计参数一致、up/down 互质、频谱数组与 n_fft 自洽、对齐时间段合法。
文件损坏 / 字段缺失 / 数据不一致都会抛出带定位信息的 `PersistenceError`。
