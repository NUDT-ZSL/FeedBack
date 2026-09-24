"""素材适配方案推导逻辑(纯函数, 不依赖 IO)。

规则概述:
- scale:     整体缩放, 素材完整可见(可能留白)。
- crop:      放大铺满目标后裁掉超出部分。
- recompose: 宽高比差异过大, 需要重新构图(人工介入)。

每个 (素材, 规格) 组合独立推导, 结果互不共享, 因此同一素材
被多个规格共用时, 修改任一规格不会影响其他规格的结论。
"""

ASPECT_TOLERANCE = 0.02   # 宽高比相对差异在此范围内视为一致
MAX_CROP_FRACTION = 0.30  # 裁切掉的画面比例上限, 超过则需重新构图

STRATEGY_LABELS = {
    "scale": "缩放",
    "crop": "裁切",
    "recompose": "重新构图",
}


def _rel_aspect_diff(a_w, a_h, s_w, s_h):
    return abs(a_w * s_h - s_w * a_h) / float(s_w * a_h)


def derive_plan(asset, spec, override_strategy=None):
    """推导单个素材在单个规格下的适配方案。"""
    aw, ah = float(asset["width"]), float(asset["height"])
    sw, sh = float(spec["width"]), float(spec["height"])
    margin = float(spec.get("safeMargin", 0))
    allowed = list(spec.get("allowedStrategies", ["scale", "crop", "recompose"]))
    readable = asset.get("minReadable") or {}
    rw, rh = float(readable.get("width", 0)), float(readable.get("height", 0))

    scale_fit = min(sw / aw, sh / ah)    # 完整装入
    scale_fill = max(sw / aw, sh / ah)   # 铺满后裁切
    aspect_diff = _rel_aspect_diff(aw, ah, sw, sh)
    crop_fraction = 1.0 - scale_fit / scale_fill  # 被裁掉的画面比例

    # 1) 自动选择策略
    if aspect_diff <= ASPECT_TOLERANCE:
        auto = "scale"
    elif crop_fraction <= MAX_CROP_FRACTION:
        auto = "crop"
    else:
        auto = "recompose"

    strategy = override_strategy or auto
    conflicts = []
    notes = []

    # 2) 策略是否被规格允许
    if strategy not in allowed:
        conflicts.append({
            "code": "strategy-not-allowed",
            "message": "规格不允许「%s」策略" % STRATEGY_LABELS[strategy],
        })

    # 3) 该策略下的有效缩放与可见窗口
    if strategy == "crop":
        eff_scale = scale_fill
    else:
        eff_scale = scale_fit
    visible_w = sw / eff_scale  # 目标窗口对应的源素材可见宽
    visible_h = sh / eff_scale

    # 4) 安全边距约束: 安全区必须存在
    safe_w = sw - 2 * margin
    safe_h = sh - 2 * margin
    if safe_w <= 0 or safe_h <= 0:
        conflicts.append({
            "code": "safe-margin",
            "message": "安全边距(%gpx)过大, 目标尺寸内不存在安全区" % margin,
        })

    # 5) 最小可读区域约束
    if rw > 0 and rh > 0:
        if rw > visible_w + 1e-9 or rh > visible_h + 1e-9:
            conflicts.append({
                "code": "min-readable",
                "message": "裁切/缩放后可见窗口(%dx%d)小于最小可读区域(%dx%d)"
                           % (round(visible_w), round(visible_h), rw, rh),
            })
        elif safe_w > 0 and safe_h > 0 and (
            rw * eff_scale > safe_w + 1e-9 or rh * eff_scale > safe_h + 1e-9
        ):
            conflicts.append({
                "code": "min-readable",
                "message": "最小可读区域缩放后(%dx%d)超出安全区(%dx%d)"
                           % (round(rw * eff_scale), round(rh * eff_scale),
                              round(safe_w), round(safe_h)),
            })

    if strategy == "recompose":
        notes.append("宽高比差异 %.0f%%, 超出自动适配范围, 需人工重新构图"
                     % (aspect_diff * 100))
    elif strategy == "crop":
        notes.append("裁切约 %.0f%% 的画面" % (crop_fraction * 100))

    return {
        "strategy": strategy,
        "autoStrategy": auto,
        "isOverride": override_strategy is not None,
        "scale": round(eff_scale, 4),
        "conflicts": conflicts,
        "notes": notes,
    }
