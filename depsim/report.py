# -*- coding: utf-8 -*-
"""把分析与推演结果格式化为中文文本报告。"""


def format_status(analysis):
    lines = []
    lines.append("构建顺序（被依赖者先构建，共 %d 个模块）：" % len(analysis.order))
    for i, mid in enumerate(analysis.order, 1):
        mark = " [成环]" if mid in analysis.cycle_of else ""
        lines.append("  %2d. %s%s" % (i, mid, mark))
    if not analysis.order:
        lines.append("  （清单为空）")

    lines.append("")
    if analysis.cycle_groups:
        lines.append("成环模块组（相互依赖，无法给出线性顺序，整组同生共死）：")
        for i, group in enumerate(analysis.cycle_groups, 1):
            lines.append("  环#%d：%s" % (i, ", ".join(group)))
    else:
        lines.append("成环检测：无依赖环")

    lines.append("")
    if analysis.missing:
        lines.append("依赖缺失（模块保留，但结论不可信）：")
        for mid in sorted(analysis.missing):
            lines.append("  %s 依赖的 %s 不在清单中"
                         % (mid, ", ".join(analysis.missing[mid])))
        lines.append("  构建结论不可信的模块：%s"
                     % ", ".join(sorted(analysis.untrusted)))
    else:
        lines.append("依赖缺失：无")

    lines.append("")
    lines.append("模块状态：")
    reusable = 0
    for mid in analysis.order:
        st = analysis.statuses[mid]
        tag = "[复用缓存]" if st.reusable else "[必须重编]"
        if st.reusable:
            reusable += 1
        extra = []
        if st.in_cycle:
            extra.append("成环组：%s" % ", ".join(st.cycle_members))
        if st.missing_deps:
            extra.append("缺失依赖：%s" % ", ".join(st.missing_deps))
        if st.untrusted:
            extra.append("！结论不可信")
        suffix = ("  " + "；".join(extra)) if extra else ""
        lines.append("  %s %-16s 签名=%s  %s%s"
                     % (tag, mid, st.signature, st.reason, suffix))
    lines.append("")
    lines.append("汇总：可复用缓存 %d 个，必须重编 %d 个，结论不可信 %d 个"
                 % (reusable, len(analysis.order) - reusable, len(analysis.untrusted)))
    return "\n".join(lines)


def format_impact(imp, change_notes):
    lines = []
    if change_notes:
        lines.append("改动内容：")
        for note in change_notes:
            lines.append("  - " + note)
        lines.append("")

    if imp.dep_diffs:
        lines.append("依赖声明差异：")
        for mid in sorted(imp.dep_diffs):
            lines.append("  %s：%s" % (mid, imp.dep_diffs[mid].describe()))
        lines.append("")

    lines.append("影响推演结果：")
    if imp.rebuild:
        lines.append("  必须重编（构建签名已变化）%d 个：" % len(imp.rebuild))
        for mid in imp.after.order:
            if mid in imp.rebuild:
                lines.append("    %-16s %s" % (mid, imp.rebuild[mid]))
    else:
        lines.append("  没有模块的构建签名发生变化。")

    if imp.reorder_only:
        lines.append("  仅依赖顺序调整（缓存可复用，无需重编）：%s"
                     % ", ".join(imp.reorder_only))
    if imp.reused:
        lines.append("  未受影响、缓存可复用 %d 个：%s"
                     % (len(imp.reused), ", ".join(imp.reused)))

    after = imp.after
    must = [m for m in after.order if not after.statuses[m].reusable]
    lines.append("")
    lines.append("当前全量状态（与从零全量重算一致）：")
    lines.append("  可复用缓存 %d 个，必须重编 %d 个，结论不可信 %d 个"
                 % (len(after.order) - len(must), len(must), len(after.untrusted)))
    if must:
        lines.append("  必须重编清单：%s" % ", ".join(must))
    return "\n".join(lines)


def format_module(analysis, mid):
    st = analysis.statuses[mid]
    mod = analysis.manifest.modules[mid]
    lines = ["模块 %s" % mid]
    lines.append("  内容指纹：%s" % mod.fingerprint)
    lines.append("  声明依赖：%s" % (", ".join(mod.deps) if mod.deps else "（无）"))
    lines.append("  构建签名：%s" % st.signature)
    cache = mod.cache if isinstance(mod.cache, dict) else {}
    lines.append("  缓存签名：%s" % (cache.get("signature") or "（无）"))
    lines.append("  判定：%s（%s）" % ("可复用缓存" if st.reusable else "必须重编", st.reason))
    if st.in_cycle:
        lines.append("  成环：与 %s 相互依赖" % ", ".join(st.cycle_members))
    if st.missing_deps:
        lines.append("  依赖缺失：%s 不在清单中" % ", ".join(st.missing_deps))
    if st.untrusted:
        lines.append("  ！构建结论不可信（自身或上游存在缺失依赖）")
    return "\n".join(lines)
