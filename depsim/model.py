# -*- coding: utf-8 -*-
"""模块清单的数据模型：加载、保存与改动应用。"""
import json


class ModelError(Exception):
    """清单数据非法时抛出。"""


class Module(object):
    """一个模块：标识、内容指纹、依赖指向、可选的缓存产物标记。"""

    def __init__(self, module_id, fingerprint, deps=None, cache=None):
        self.id = module_id
        self.fingerprint = fingerprint
        self.deps = list(deps or [])
        self.cache = cache  # None 或 {"signature": str}

    def to_dict(self):
        data = {
            "id": self.id,
            "fingerprint": self.fingerprint,
            "deps": list(self.deps),
        }
        if self.cache is not None:
            data["cache"] = dict(self.cache)
        return data


class Manifest(object):
    """模块清单：id -> Module。"""

    def __init__(self, modules):
        self.modules = {}
        for mod in modules:
            if mod.id in self.modules:
                raise ModelError("模块标识重复: %s" % mod.id)
            self.modules[mod.id] = mod

    @classmethod
    def from_dict(cls, raw):
        items = raw.get("modules")
        if not isinstance(items, list):
            raise ModelError("清单缺少 modules 数组")
        modules = []
        for i, item in enumerate(items):
            if not isinstance(item, dict) or "id" not in item or "fingerprint" not in item:
                raise ModelError("第 %d 个模块缺少 id 或 fingerprint" % (i + 1))
            mid = item["id"]
            deps = item.get("deps", [])
            if not isinstance(deps, list):
                raise ModelError("模块 %s 的 deps 必须是数组" % mid)
            cache = item.get("cache")
            if cache is not None and not isinstance(cache, dict):
                # 兼容 cache: true 写法，视为“有产物但签名未知”
                cache = {}
            modules.append(Module(mid, item["fingerprint"], deps, cache))
        return cls(modules)

    @classmethod
    def load(cls, path):
        try:
            with open(path, "r", encoding="utf-8-sig") as fh:
                raw = json.load(fh)
        except json.JSONDecodeError as exc:
            raise ModelError("清单不是合法的 JSON：%s（%s）" % (path, exc))
        except OSError as exc:
            raise ModelError("无法读取清单：%s（%s）" % (path, exc))
        if not isinstance(raw, dict):
            raise ModelError("清单顶层必须是 JSON 对象：%s" % path)
        return cls.from_dict(raw)

    def to_dict(self):
        return {"modules": [self.modules[k].to_dict() for k in sorted(self.modules)]}

    def save(self, path):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, ensure_ascii=False, indent=2)
            fh.write("\n")

    def clone(self):
        return Manifest.from_dict(self.to_dict())


class Change(object):
    """一次改动：fingerprint（换指纹）/ add_dep / remove_dep。"""

    def __init__(self, kind, module, value=None, target=None):
        self.kind = kind
        self.module = module
        self.value = value
        self.target = target


def apply_changes(manifest, changes):
    """把改动应用到清单上（就地修改），返回每条改动的中文说明。"""
    notes = []
    for ch in changes:
        mod = manifest.modules.get(ch.module)
        if mod is None:
            notes.append("跳过：模块 %s 不在清单中" % ch.module)
            continue
        if ch.kind == "fingerprint":
            if mod.fingerprint == ch.value:
                notes.append("模块 %s 指纹未变化（%s）" % (ch.module, ch.value))
            else:
                notes.append("模块 %s 内容指纹：%s -> %s"
                             % (ch.module, mod.fingerprint, ch.value))
                mod.fingerprint = ch.value
        elif ch.kind == "add_dep":
            if ch.target in mod.deps:
                notes.append("模块 %s 已依赖 %s，无需新增" % (ch.module, ch.target))
            else:
                mod.deps.append(ch.target)
                extra = ""
                if ch.target not in manifest.modules:
                    extra = "（注意：%s 不在清单中，将被标记为依赖缺失）" % ch.target
                notes.append("模块 %s 新增依赖 %s%s" % (ch.module, ch.target, extra))
        elif ch.kind == "remove_dep":
            if ch.target in mod.deps:
                mod.deps.remove(ch.target)
                notes.append("模块 %s 移除依赖 %s" % (ch.module, ch.target))
            else:
                notes.append("模块 %s 并未依赖 %s，无需移除" % (ch.module, ch.target))
        else:
            notes.append("跳过：未知改动类型 %s" % ch.kind)
    return notes
