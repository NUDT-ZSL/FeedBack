# -*- coding: utf-8 -*-
"""多渠道发布编排模块。

仅用 Python 标准库实现，可完全离线运行。

核心概念：
- MasterDraft  母稿：由若干 MaterialUnit（素材单元）组成，单元有唯一标识、
  类型（title/summary/point/caption）与内容，每次修改版本号自增。
- ChannelRule  渠道规则：允许的单元类型、各类型长度上限、必填单元，
  以及从母稿单元派生内容的方式（逐字替换表）。
- Variant      渠道变体：按规则从母稿派生的内容，记录来源单元及其版本、
  被裁剪项；母稿单元变更后对应变体自动识别为过期，可只重算受影响变体。
- 冲突检测     ：两个渠道对同一母稿单元的同一改写点给出不同结果时，
  双方内容都保留，并生成可读的冲突记录。
- 持久化       ：母稿、规则、变体、冲突与校验报告写入单个 JSON 文件，
  载入时全面校验，任何损坏都会抛出清晰错误且不影响已有内存状态。
"""

from __future__ import annotations

import json
import os


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------

class OrchestratorError(Exception):
    """本模块所有错误的基类。"""


class ValidationError(OrchestratorError):
    """输入数据非法（重复标识、非法类型、引用不存在的单元等）。"""


class NotFoundError(OrchestratorError):
    """查询的对象不存在。"""


class LoadError(OrchestratorError):
    """载入持久化文件时校验失败。"""


# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

#: 合法的素材单元类型
UNIT_TYPES = ("title", "summary", "point", "caption")

#: 持久化文件格式标识
FORMAT_TAG = "content-orchestrator/v1"


# ---------------------------------------------------------------------------
# 素材单元与母稿
# ---------------------------------------------------------------------------

class MaterialUnit:
    """母稿中的一个素材单元。"""

    __slots__ = ("unit_id", "type", "content", "version")

    def __init__(self, unit_id, type_, content, version=1):
        self.unit_id = unit_id
        self.type = type_
        self.content = content
        self.version = version

    def to_dict(self):
        return {
            "id": self.unit_id,
            "type": self.type,
            "content": self.content,
            "version": self.version,
        }

    def __repr__(self):  # pragma: no cover - 便于调试
        return "MaterialUnit(%r, %r, v%d)" % (self.unit_id, self.type, self.version)


class MasterDraft:
    """母稿：素材单元的集合，标识唯一。"""

    def __init__(self):
        self._units = {}  # unit_id -> MaterialUnit（保持插入顺序）

    # -- 维护 ------------------------------------------------------------

    def add_unit(self, unit_id, type_, content):
        """新增素材单元。标识重复或类型非法时拒绝并指出位置。"""
        if not isinstance(unit_id, str) or not unit_id:
            raise ValidationError("单元标识必须是非空字符串，收到: %r" % (unit_id,))
        if unit_id in self._units:
            raise ValidationError("母稿单元标识重复: %r" % unit_id)
        if type_ not in UNIT_TYPES:
            raise ValidationError(
                "母稿单元 %r 的类型 %r 非法，允许的类型: %s"
                % (unit_id, type_, ", ".join(UNIT_TYPES))
            )
        if not isinstance(content, str):
            raise ValidationError("母稿单元 %r 的内容必须是字符串" % unit_id)
        self._units[unit_id] = MaterialUnit(unit_id, type_, content)

    def update_unit(self, unit_id, content):
        """修改单元内容，版本号自增（引用它的变体随之过期）。"""
        unit = self._units.get(unit_id)
        if unit is None:
            raise NotFoundError("母稿中不存在单元 %r，无法修改" % unit_id)
        if not isinstance(content, str):
            raise ValidationError("母稿单元 %r 的内容必须是字符串" % unit_id)
        unit.content = content
        unit.version += 1

    def remove_unit(self, unit_id):
        """删除单元。引用它的变体保留历史内容，但来源随即失效
        （查询时标记为 orphaned，过期状态置真，重新生成时不再引用）。"""
        if unit_id not in self._units:
            raise NotFoundError("母稿中不存在单元 %r，无法删除" % unit_id)
        del self._units[unit_id]

    # -- 查询 ------------------------------------------------------------

    def get(self, unit_id):
        unit = self._units.get(unit_id)
        if unit is None:
            raise NotFoundError("母稿中不存在单元 %r" % unit_id)
        return unit

    def __contains__(self, unit_id):
        return unit_id in self._units

    def unit_ids(self):
        return list(self._units)

    def to_list(self):
        return [u.to_dict() for u in self._units.values()]


# ---------------------------------------------------------------------------
# 派生与裁剪（纯函数，保证“重算 == 从头生成”）
# ---------------------------------------------------------------------------

def apply_replacements(content, replacements):
    """按替换表派生内容。按键排序依次替换，保证结果确定。"""
    for old in sorted(replacements):
        new = replacements[old]
        if not isinstance(old, str) or not isinstance(new, str):
            raise ValidationError("替换表的键和值都必须是字符串: %r -> %r" % (old, new))
        if old == "":
            raise ValidationError("替换表的键不能为空字符串")
        content = content.replace(old, new)
    return content


#: 裁剪时优先在这些字符处断开（避免截断词语/句子）
_BREAK_CHARS = (" ", "　", "。", "，", "；", "、", "！", "？", ",", ";", "!", "?", "\n")


def trim_text(text, limit):
    """确定性裁剪。

    返回 (裁剪后文本, 裁剪记录或 None)。不超过上限时原样返回；
    超过时先取前 limit 个字符，若后半段内存在断句字符则在最后一个
    断句字符处断开，否则硬截断。被裁剪时返回记录，绝不静默截断。
    """
    if limit is None or len(text) <= limit:
        return text, None
    cut = text[:limit]
    boundary = -1
    for ch in _BREAK_CHARS:
        boundary = max(boundary, cut.rfind(ch))
    if boundary >= limit // 2:
        cut = cut[:boundary]
    record = {
        "limit": limit,
        "original": text,
        "trimmed": cut,
    }
    return cut, record


# ---------------------------------------------------------------------------
# 渠道规则
# ---------------------------------------------------------------------------

class Derivation:
    """一条派生规则：从某个母稿单元派生，可附带逐字替换表。"""

    __slots__ = ("source", "replacements")

    def __init__(self, source, replacements=None):
        self.source = source
        self.replacements = dict(replacements or {})

    def to_dict(self):
        return {"source": self.source, "replacements": dict(self.replacements)}


class ChannelRule:
    """一个发布渠道的变体规则。"""

    def __init__(self, channel, allowed_types=None, max_lengths=None,
                 required=None, derivations=None):
        self.channel = channel
        self.allowed_types = list(allowed_types) if allowed_types else list(UNIT_TYPES)
        self.max_lengths = dict(max_lengths or {})   # type -> int
        self.required = list(required or [])          # [unit_id]
        self.derivations = []                          # [Derivation]，保持声明顺序
        for d in derivations or []:
            self.add_derivation(d["source"], d.get("replacements"))

    def add_derivation(self, source, replacements=None):
        self.derivations.append(Derivation(source, replacements))

    def derivation_for(self, source):
        for d in self.derivations:
            if d.source == source:
                return d
        return None

    def max_length_for(self, type_):
        return self.max_lengths.get(type_)

    def to_dict(self):
        return {
            "channel": self.channel,
            "allowed_types": list(self.allowed_types),
            "max_lengths": dict(self.max_lengths),
            "required": list(self.required),
            "derivations": [d.to_dict() for d in self.derivations],
        }


# ---------------------------------------------------------------------------
# 渠道变体
# ---------------------------------------------------------------------------

class Variant:
    """某渠道的一份变体。"""

    def __init__(self, channel):
        self.channel = channel
        self.items = {}    # unit_id -> 派生后的内容（保持派生顺序）
        self.sources = {}  # unit_id -> 来源母稿单元版本号
        self.trims = []    # 被裁剪项记录

    def to_dict(self):
        return {
            "channel": self.channel,
            "items": dict(self.items),
            "sources": dict(self.sources),
            "trims": [dict(t, unit_id=t["unit_id"]) for t in self.trims],
        }

    def __eq__(self, other):
        return (
            isinstance(other, Variant)
            and self.channel == other.channel
            and self.items == other.items
            and self.sources == other.sources
            and self.trims == other.trims
        )


def build_variant(rule, master):
    """按规则从母稿生成变体（纯函数：同样输入必然同样输出）。

    规则在登记时已校验引用合法，因此来源缺失只可能发生在母稿单元
    被删除之后；此时跳过该派生，重新生成的变体不再引用已删除单元。
    """
    variant = Variant(rule.channel)
    for deriv in rule.derivations:
        if deriv.source not in master:
            continue  # 来源单元已被删除
        unit = master.get(deriv.source)
        content = apply_replacements(unit.content, deriv.replacements)
        content, trim_record = trim_text(content, rule.max_length_for(unit.type))
        if trim_record is not None:
            trim_record["unit_id"] = unit.unit_id
            trim_record["channel"] = rule.channel
            variant.trims.append(trim_record)
        variant.items[unit.unit_id] = content
        variant.sources[unit.unit_id] = unit.version
    return variant


# ---------------------------------------------------------------------------
# 编排器
# ---------------------------------------------------------------------------

class Orchestrator:
    """维护母稿、渠道规则、变体、冲突与校验报告。"""

    def __init__(self):
        self.master = MasterDraft()
        self.rules = {}      # channel -> ChannelRule
        self.variants = {}   # channel -> Variant
        self.conflicts = []  # 最近一次校验得到的冲突记录
        self.report = []     # 最近一次校验报告

    # -- 1. 母稿维护（委托给 MasterDraft） --------------------------------

    def add_unit(self, unit_id, type_, content):
        self.master.add_unit(unit_id, type_, content)

    def update_unit(self, unit_id, content):
        self.master.update_unit(unit_id, content)

    def remove_unit(self, unit_id):
        """删除母稿单元。引用它的变体保留历史内容但来源失效。"""
        self.master.remove_unit(unit_id)

    # -- 2. 渠道规则 ------------------------------------------------------

    def add_rule(self, rule):
        """登记渠道规则，并立即对照母稿校验引用合法性。"""
        if not isinstance(rule, ChannelRule):
            raise ValidationError("规则必须是 ChannelRule 实例")
        if rule.channel in self.rules:
            raise ValidationError("渠道规则重复: %r" % rule.channel)
        self._validate_rule(rule)
        self.rules[rule.channel] = rule

    def _validate_rule(self, rule, check_references=True):
        """校验规则。check_references=False 用于载入：母稿单元可能已被
        删除，规则中指向它的引用是合法的历史状态（生成时会跳过）。"""
        for t in rule.allowed_types:
            if t not in UNIT_TYPES:
                raise ValidationError(
                    "渠道 %r 允许的类型 %r 非法，允许的类型: %s"
                    % (rule.channel, t, ", ".join(UNIT_TYPES))
                )
        for t, limit in rule.max_lengths.items():
            if t not in UNIT_TYPES:
                raise ValidationError(
                    "渠道 %r 的长度上限针对非法类型 %r" % (rule.channel, t)
                )
            if not isinstance(limit, int) or limit <= 0:
                raise ValidationError(
                    "渠道 %r 类型 %r 的长度上限必须是正整数，收到: %r"
                    % (rule.channel, t, limit)
                )
        seen_sources = set()
        for d in rule.derivations:
            if check_references and d.source not in self.master:
                raise ValidationError(
                    "渠道 %r 的派生规则引用了不存在的母稿单元 %r"
                    % (rule.channel, d.source)
                )
            if d.source in seen_sources:
                raise ValidationError(
                    "渠道 %r 对母稿单元 %r 声明了重复的派生规则"
                    % (rule.channel, d.source)
                )
            seen_sources.add(d.source)
            if check_references:
                unit_type = self.master.get(d.source).type
                if unit_type not in rule.allowed_types:
                    raise ValidationError(
                        "渠道 %r 不允许使用类型 %r（母稿单元 %r）"
                        % (rule.channel, unit_type, d.source)
                    )
        if check_references:
            for unit_id in rule.required:
                if unit_id not in self.master:
                    raise ValidationError(
                        "渠道 %r 的必填单元 %r 在母稿中不存在"
                        % (rule.channel, unit_id)
                    )

    def remove_channel(self, channel):
        """取消渠道：移除其规则与变体。

        已生成的冲突记录不受影响——记录中保留双方原始内容，查询时
        该方会被标注为已失效（cancelled），不会被静默丢弃。
        """
        if channel not in self.rules and channel not in self.variants:
            raise NotFoundError("渠道 %r 不存在，无法取消" % channel)
        self.rules.pop(channel, None)
        self.variants.pop(channel, None)

    # -- 3/4. 生成与过期重算 ----------------------------------------------

    def generate(self, channel):
        """按规则生成（或重新生成）某渠道变体。"""
        rule = self.rules.get(channel)
        if rule is None:
            raise NotFoundError("未登记渠道规则 %r" % channel)
        self.variants[channel] = build_variant(rule, self.master)
        return self.variants[channel]

    def generate_all(self):
        for channel in sorted(self.rules):
            self.generate(channel)

    def is_stale(self, channel):
        """变体是否过期：任一来源单元的版本与派生时不一致。"""
        variant = self.variants.get(channel)
        if variant is None:
            raise NotFoundError("渠道 %r 尚未生成变体" % channel)
        for unit_id, version in variant.sources.items():
            if unit_id not in self.master:
                return True
            if self.master.get(unit_id).version != version:
                return True
        return False

    def stale_channels(self):
        return sorted(ch for ch in self.variants if self.is_stale(ch))

    def refresh_stale(self):
        """只重算受影响的（过期的）变体，返回被重算的渠道列表。

        生成是纯函数，因此重算结果与从头重新生成完全一致。
        """
        refreshed = []
        for channel in self.stale_channels():
            self.generate(channel)
            refreshed.append(channel)
        return refreshed

    # -- 5. 冲突检测 ------------------------------------------------------

    def detect_conflicts(self):
        """检测不同渠道对同一母稿单元的互相矛盾的改写。

        对同一母稿单元、同一替换点（被替换的原文），若两个渠道给出了
        不同的替换结果，则判定为冲突。双方内容都保留，只生成冲突记录。
        返回按 (单元, 替换点) 稳定排序的冲突记录列表。
        """
        # unit_id -> token -> {channel: replacement}
        by_unit = {}
        for channel in sorted(self.rules):
            for d in self.rules[channel].derivations:
                for token, value in d.replacements.items():
                    by_unit.setdefault(d.source, {}).setdefault(token, {})[channel] = value
        conflicts = []
        for unit_id in sorted(by_unit):
            if unit_id not in self.master:
                continue  # 单元已删除：历史冲突保留在 self.conflicts 中
            for token in sorted(by_unit[unit_id]):
                per_channel = by_unit[unit_id][token]
                if len(set(per_channel.values())) <= 1:
                    continue
                channels = sorted(per_channel)
                conflicts.append({
                    "unit_id": unit_id,
                    "token": token,
                    "channels": channels,
                    "rewrites": {ch: per_channel[ch] for ch in channels},
                    "contents": {
                        ch: self.variants[ch].items.get(unit_id)
                        for ch in channels
                        if ch in self.variants and unit_id in self.variants[ch].items
                    },
                    "message": (
                        "母稿单元 %r 的改写点 %r 在渠道间互相矛盾: %s"
                        % (unit_id, token, "; ".join(
                            "渠道 %r 改为 %r" % (ch, per_channel[ch])
                            for ch in channels
                        ))
                    ),
                })
        return conflicts

    @staticmethod
    def _conflict_key(record):
        return (record["unit_id"], record["token"], tuple(record["channels"]))

    def conflict_records(self):
        """返回冲突记录（含历史记录），并标注每方渠道与单元的当前状态。

        - channel_status: 每方渠道为 "active"（规则仍在）或 "cancelled"
          （已取消/不存在）；原始双方内容始终保留，不静默丢弃。
        - unit_exists: 冲突涉及的母稿单元是否仍存在。
        - active: 各方渠道都在且单元存在时为 True。
        """
        annotated = []
        for c in self.conflicts:
            rec = dict(c)
            status = {
                ch: ("active" if ch in self.rules else "cancelled")
                for ch in c["channels"]
            }
            rec["channel_status"] = status
            rec["unit_exists"] = c["unit_id"] in self.master
            rec["active"] = (rec["unit_exists"]
                             and all(s == "active" for s in status.values()))
            annotated.append(rec)
        return annotated

    # -- 6. 一致性校验 ----------------------------------------------------

    def validate(self):
        """校验全部渠道变体，返回稳定顺序、可重复的报告。

        报告项按 (类别, 渠道, 单元) 排序；同时刷新 self.conflicts 与
        self.report。
        """
        issues = []
        for channel in sorted(self.variants):
            rule = self.rules.get(channel)
            variant = self.variants[channel]
            if rule is None:
                issues.append({
                    "kind": "rule_missing",
                    "channel": channel,
                    "unit_id": None,
                    "message": "渠道 %r 存在变体但没有对应规则" % channel,
                })
                continue
            for unit_id in sorted(rule.required):
                if unit_id not in variant.items:
                    issues.append({
                        "kind": "missing_required",
                        "channel": channel,
                        "unit_id": unit_id,
                        "message": "渠道 %r 缺少必填单元 %r" % (channel, unit_id),
                    })
            for unit_id in sorted(variant.items):
                if unit_id not in self.master:
                    issues.append({
                        "kind": "source_missing",
                        "channel": channel,
                        "unit_id": unit_id,
                        "message": "渠道 %r 的单元 %r 在母稿中已不存在"
                                   % (channel, unit_id),
                    })
                    continue
                limit = rule.max_length_for(self.master.get(unit_id).type)
                if limit is not None and len(variant.items[unit_id]) > limit:
                    issues.append({
                        "kind": "length_exceeded",
                        "channel": channel,
                        "unit_id": unit_id,
                        "message": (
                            "渠道 %r 的单元 %r 长度 %d 超过上限 %d"
                            % (channel, unit_id, len(variant.items[unit_id]), limit)
                        ),
                    })
        # 合并冲突：现行冲突 + 因渠道取消或单元删除而不再是现行的历史冲突
        # （历史记录必须保留，不能静默丢弃）
        live = self.detect_conflicts()
        live_keys = {self._conflict_key(c) for c in live}
        historical = [c for c in self.conflicts
                      if self._conflict_key(c) not in live_keys]
        self.conflicts = sorted(
            live + historical,
            key=lambda c: (c["unit_id"], c["token"], list(c["channels"])),
        )
        for c in self.conflict_records():
            message = c["message"]
            inactive = sorted(ch for ch, s in c["channel_status"].items()
                              if s == "cancelled")
            if inactive:
                message += "（已失效渠道: %s）" % ", ".join(inactive)
            if not c["unit_exists"]:
                message += "（母稿单元已删除）"
            issues.append({
                "kind": "semantic_conflict",
                "channel": ",".join(c["channels"]),
                "unit_id": c["unit_id"],
                "message": message,
            })
        issues.sort(key=lambda i: (i["kind"], i["channel"], i["unit_id"] or ""))
        self.report = issues
        return issues

    # -- 7. 查询 ----------------------------------------------------------

    def variant_view(self, channel):
        """查询某渠道变体的当前内容、来源、过期状态、裁剪项与冲突。

        - sources: 各项内容派生自哪个母稿单元的哪个版本（历史溯源，
          即使该单元后来被删除也保留记录）。
        - orphaned: 来源单元已被删除、内容已失去来源的单元列表。
        - conflicts: 含历史冲突记录，每方渠道标注 active/cancelled。
        """
        variant = self.variants.get(channel)
        if variant is None:
            raise NotFoundError("渠道 %r 尚未生成变体" % channel)
        return {
            "channel": channel,
            "items": dict(variant.items),
            "sources": dict(variant.sources),
            "orphaned": sorted(u for u in variant.sources
                               if u not in self.master),
            "stale": self.is_stale(channel),
            "trims": [dict(t) for t in variant.trims],
            "conflicts": [c for c in self.conflict_records()
                          if channel in c["channels"]],
        }

    # -- 7/8. 持久化 ------------------------------------------------------

    def to_dict(self):
        return {
            "format": FORMAT_TAG,
            "master": {"units": self.master.to_list()},
            "rules": [self.rules[ch].to_dict() for ch in sorted(self.rules)],
            "variants": [self.variants[ch].to_dict() for ch in sorted(self.variants)],
            "conflicts": self.conflicts,
            "report": self.report,
        }

    def save(self, path):
        """把全部状态写入一个 JSON 文件（原子写入，避免半截文件）。"""
        data = self.to_dict()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=False)
        os.replace(tmp, path)

    @classmethod
    def load(cls, path):
        """从文件载入。校验失败抛 LoadError，且不影响任何已有内存状态
        （本方法构造全新实例，只有全部校验通过才返回）。"""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            raise LoadError("文件不存在: %r" % path)
        except json.JSONDecodeError as e:
            raise LoadError("文件不是合法 JSON: %s (第 %d 行第 %d 列)"
                            % (e.msg, e.lineno, e.colno))
        except UnicodeDecodeError as e:
            raise LoadError("文件编码不是 UTF-8: %s" % e)
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise LoadError("文件顶层必须是 JSON 对象")
        if data.get("format") != FORMAT_TAG:
            raise LoadError("格式标识缺失或不匹配，期望 %r，收到 %r"
                            % (FORMAT_TAG, data.get("format")))
        for key in ("master", "rules", "variants", "conflicts", "report"):
            if key not in data:
                raise LoadError("文件缺少必需字段 %r" % key)

        orch = cls()

        # -- 母稿：标识唯一、类型合法、字段齐全 --
        master = data["master"]
        if not isinstance(master, dict) or not isinstance(master.get("units"), list):
            raise LoadError("字段 'master.units' 必须是列表")
        for i, u in enumerate(master["units"]):
            where = "母稿单元[%d]" % i
            if not isinstance(u, dict):
                raise LoadError("%s 必须是对象" % where)
            for field in ("id", "type", "content"):
                if field not in u:
                    raise LoadError("%s 缺少字段 %r" % (where, field))
            try:
                orch.master.add_unit(u["id"], u["type"], u["content"])
            except ValidationError as e:
                raise LoadError("%s 非法: %s" % (where, e))
            version = u.get("version", 1)
            if not isinstance(version, int) or version < 1:
                raise LoadError("%s 的 version 必须是正整数" % where)
            orch.master.get(u["id"]).version = version

        # -- 规则：引用合法 --
        if not isinstance(data["rules"], list):
            raise LoadError("字段 'rules' 必须是列表")
        for i, r in enumerate(data["rules"]):
            where = "规则[%d]" % i
            if not isinstance(r, dict):
                raise LoadError("%s 必须是对象" % where)
            for field in ("channel", "allowed_types", "max_lengths",
                          "required", "derivations"):
                if field not in r:
                    raise LoadError("%s 缺少字段 %r" % (where, field))
            rule = ChannelRule(
                r["channel"],
                allowed_types=r["allowed_types"],
                max_lengths=r["max_lengths"],
                required=r["required"],
            )
            derivations = r["derivations"]
            if not isinstance(derivations, list):
                raise LoadError("%s 的 derivations 必须是列表" % where)
            for j, d in enumerate(derivations):
                if not isinstance(d, dict) or "source" not in d:
                    raise LoadError("%s 的派生[%d] 缺少字段 'source'" % (where, j))
                rule.add_derivation(d["source"], d.get("replacements"))
            try:
                # 载入时不校验母稿引用：单元可能已被删除，引用是合法历史状态
                orch._validate_rule(rule, check_references=False)
            except ValidationError as e:
                raise LoadError("%s 非法: %s" % (where, e))
            if rule.channel in orch.rules:
                raise LoadError("渠道规则重复: %r" % rule.channel)
            orch.rules[rule.channel] = rule

        # -- 变体：渠道有规则、来源存在、字段齐全 --
        if not isinstance(data["variants"], list):
            raise LoadError("字段 'variants' 必须是列表")
        for i, v in enumerate(data["variants"]):
            where = "变体[%d]" % i
            if not isinstance(v, dict):
                raise LoadError("%s 必须是对象" % where)
            for field in ("channel", "items", "sources", "trims"):
                if field not in v:
                    raise LoadError("%s 缺少字段 %r" % (where, field))
            channel = v["channel"]
            if channel not in orch.rules:
                raise LoadError("%s 的渠道 %r 没有对应规则" % (where, channel))
            if channel in orch.variants:
                raise LoadError("渠道 %r 的变体重复出现" % channel)
            variant = Variant(channel)
            if not isinstance(v["items"], dict) or not isinstance(v["sources"], dict):
                raise LoadError("%s 的 items/sources 必须是对象" % where)
            for unit_id, content in v["items"].items():
                if not isinstance(content, str):
                    raise LoadError("%s 单元 %r 的内容必须是字符串" % (where, unit_id))
                variant.items[unit_id] = content
            for unit_id, version in v["sources"].items():
                # 来源单元可能已被删除（orphaned）：合法，载入后由
                # variant_view 标记为来源失效
                if not isinstance(version, int) or version < 1:
                    raise LoadError("%s 单元 %r 的来源版本必须是正整数"
                                    % (where, unit_id))
                variant.sources[unit_id] = version
            for unit_id in variant.sources:
                if unit_id not in variant.items:
                    raise LoadError("%s 的来源单元 %r 缺少对应内容"
                                    % (where, unit_id))
            if not isinstance(v["trims"], list):
                raise LoadError("%s 的 trims 必须是列表" % where)
            for j, t in enumerate(v["trims"]):
                if not isinstance(t, dict):
                    raise LoadError("%s 的裁剪记录[%d] 必须是对象" % (where, j))
                for field in ("unit_id", "limit", "original", "trimmed"):
                    if field not in t:
                        raise LoadError("%s 的裁剪记录[%d] 缺少字段 %r"
                                        % (where, j, field))
                # 裁剪是历史记录：来源单元可能已被删除，合法保留
                entry = {
                    "unit_id": t["unit_id"],
                    "channel": channel,
                    "limit": t["limit"],
                    "original": t["original"],
                    "trimmed": t["trimmed"],
                }
                variant.trims.append(entry)
            orch.variants[channel] = variant

        # -- 冲突记录：自洽（字段齐全、各方互不相同、改写值确实相异、
        #    内容与现存变体一致）。渠道已取消或单元已删除的历史记录
        #    合法保留，查询时会被标注为已失效。 --
        if not isinstance(data["conflicts"], list):
            raise LoadError("字段 'conflicts' 必须是列表")
        for i, c in enumerate(data["conflicts"]):
            where = "冲突记录[%d]" % i
            if not isinstance(c, dict):
                raise LoadError("%s 必须是对象" % where)
            for field in ("unit_id", "token", "channels", "rewrites", "message"):
                if field not in c:
                    raise LoadError("%s 缺少字段 %r" % (where, field))
            channels = c["channels"]
            if (not isinstance(channels, list) or len(channels) < 2
                    or len(set(channels)) != len(channels)):
                raise LoadError("%s 的 channels 必须包含至少两个互不相同的渠道"
                                % where)
            if not isinstance(c["rewrites"], dict):
                raise LoadError("%s 的 rewrites 必须是对象" % where)
            for ch in channels:
                if ch not in c["rewrites"]:
                    raise LoadError("%s 的 rewrites 缺少渠道 %r 的改写值"
                                    % (where, ch))
            if len(set(c["rewrites"][ch] for ch in channels)) <= 1:
                raise LoadError("%s 各方改写值相同，不构成冲突" % where)
            contents = c.get("contents", {})
            if not isinstance(contents, dict):
                raise LoadError("%s 的 contents 必须是对象" % where)
            for ch, content in contents.items():
                if ch not in channels:
                    raise LoadError("%s 的 contents 出现了未参与冲突的渠道 %r"
                                    % (where, ch))
                variant = orch.variants.get(ch)
                if variant is not None and c["unit_id"] in variant.items:
                    if variant.items[c["unit_id"]] != content:
                        raise LoadError(
                            "%s 中渠道 %r 的内容与其变体不一致" % (where, ch))
        orch.conflicts = data["conflicts"]

        if not isinstance(data["report"], list):
            raise LoadError("字段 'report' 必须是列表")
        orch.report = data["report"]

        return orch
