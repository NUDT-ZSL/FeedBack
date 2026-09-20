# -*- coding: utf-8 -*-
"""模块清单的加载、校验与序列化。"""
import json


class ManifestError(Exception):
    """清单格式不合法。"""


class Module(object):
    """清单中的一个模块。

    id:          模块标识
    fingerprint: 内容指纹（内容变化时应改变）
    deps:        声明的依赖指向（模块 id 列表）
    cache:       可选的缓存产物标记（上次构建时的输入签名）
    """

    def __init__(self, mod_id, fingerprint, deps=None, cache=None):
        self.id = mod_id
        self.fingerprint = fingerprint
        self.deps = list(deps or [])
        self.cache = cache

    def to_dict(self):
        data = {"id": self.id, "fingerprint": self.fingerprint,
                "deps": list(self.deps)}
        if self.cache is not None:
            data["cache"] = self.cache
        return data


def parse_manifest(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("modules"), list):
        raise ManifestError("清单必须是包含 modules 数组的 JSON 对象")
    modules = {}
    for i, entry in enumerate(raw["modules"]):
        if not isinstance(entry, dict):
            raise ManifestError("modules[%d] 不是对象" % i)
        mod_id = entry.get("id")
        if not isinstance(mod_id, str) or not mod_id:
            raise ManifestError("modules[%d] 缺少字符串 id" % i)
        if mod_id in modules:
            raise ManifestError("模块 id 重复: %s" % mod_id)
        fingerprint = entry.get("fingerprint")
        if not isinstance(fingerprint, str) or not fingerprint:
            raise ManifestError("模块 %s 缺少内容指纹 fingerprint" % mod_id)
        deps = entry.get("deps", [])
        if not isinstance(deps, list) or \
                not all(isinstance(d, str) for d in deps):
            raise ManifestError("模块 %s 的 deps 必须是字符串数组" % mod_id)
        cache = entry.get("cache")
        if cache is not None and not isinstance(cache, str):
            raise ManifestError("模块 %s 的 cache 必须是字符串" % mod_id)
        modules[mod_id] = Module(mod_id, fingerprint, deps, cache)
    return modules


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        return parse_manifest(json.load(fh))


def dump_manifest(modules):
    return {"modules": [modules[k].to_dict() for k in sorted(modules)]}
