# 信号处理内核（纯 Python 标准库）

离线传感器信号处理内核：滤波、频域分析、重采样、时间轴对齐、JSON 持久化。
不依赖 numpy/scipy，只用标准库（`math` / `cmath` / `json` / `fractions` / `dataclasses`）。

## 文件

| 文件 | 说明 |
|---|---|
| `signal_kernel.py` | 内核：信号模型、FIR 设计、卷积、FFT、频谱、重采样、对齐、持久化 |
| `main.py` | 命令行入口：从 stdin 逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_signal_kernel.py` | unittest 套件（68 个用例）：`python -m unittest test_signal_kernel -v` |

## 核心约定

- **归一化频率**：所有截止频率用 cycles/sample 表示，0.5 = 奈奎斯特，合法区间为开区间 `(0, 0.5)`。
- **滤波器阶数**：必须为正奇数（偶数抽头）。因此高通/带阻用分数延迟冲激（`sinc(n-c)`）做谱反转；
  偶数抽头在 f=0.5 处响应恒为 0，增益归一化在通带中部参考点完成。
- **apply_filter**：线性卷积 + 零填充边界，输出与输入等长（以群延迟 `order/2` 为中心截取）。
- **filtfilt**：正反各滤一次，零相位；**有效阶数翻倍**（`2*order`），幅度响应平方
  （通带纹波加倍、阻带抑制 dB 加倍、截止点从 -3dB 变为 -6dB）。
- **FFT**：迭代 radix-2；非 2 的幂长度补零到下一个 2 的幂，补零长度记录在 `Spectrum.zero_padded`。
  幅度谱为单边谱，按窗函数相干增益（`sum(w)`）归一化，单频正弦峰值直接读出振幅。
- **重采样**：`resample(signal, up, down)` 要求 up/down 为互质正整数；插零 → 抗混叠低通
  （截止 `0.5/max(up,down)`，增益 `up`）→ 抽取；输出采样率 `sr*up/down`，时间轴精确保持
  （滤波器整数群延迟已补偿），`ResampleResult` 报告截止频率与群延迟。
- **对齐**：`align(signals, target_rate)` 各有理重采样到统一速率后裁剪到公共时间段；
  目标速率低于信号最高频率时由抗混叠滤波器自动处理（衰减而非混叠）。
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

## 持久化

`Workspace.save(path)` 把信号、滤波器系数、频谱、重采样配置、对齐结果写入单个 JSON 文件；
`Workspace.load(path)` 重建并校验：signal_id 唯一、采样率为正、样本有限、滤波器阶数为正奇数
且系数与设计参数一致、up/down 互质、频谱数组与 n_fft 自洽、对齐时间段合法。
文件损坏 / 字段缺失 / 数据不一致都会抛出带定位信息的 `PersistenceError`。
