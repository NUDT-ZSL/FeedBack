# -*- coding: utf-8 -*-
"""协作编辑合并引擎。

把多位协作者针对同一份章节文档提交的编辑记录合并成一份
可逐条确认的版本，并维护接受/拒绝/失效/取代等状态派生。
"""

MAIN_TYPES = ("replace", "delete")   # 直接改写段落本体的编辑，彼此之间会冲突
STATUS_CN = {
    "pending": "待确认", "accepted": "已接受", "rejected": "已拒绝",
    "invalidated": "已失效", "superseded": "已被取代", "manual": "手动调整",
}


def new_edit(raw):
    return {
        "id": raw["id"],
        "author": raw.get("author", "未知"),
        "target": raw["target"],
        "type": raw["type"],
        "content": raw.get("content", ""),
        "depends_on": list(raw.get("depends_on", [])),
        "note": raw.get("note", ""),
        "decision": None,          # 用户显式决定: accepted/rejected/None
        "status": "pending",       # 派生状态
        "reason": "",              # 失效/取代原因
    }


class MergeEngine:
    def __init__(self, document, edits):
        self.document = document
        self.edits = {e["id"]: new_edit(e) for e in edits}
        self.manual = {}           # target paragraph id -> 手动调整后的文本
        self.recompute()

    # ---------- 文档结构 ----------
    def iter_paragraphs(self, sections=None, path=()):
        """产出 (章节路径, 段落)，深度优先遍历章节树。"""
        if sections is None:
            sections = self.document.get("sections", [])
        for sec in sections:
            sec_path = path + (sec.get("title", ""),)
            for p in sec.get("paragraphs", []):
                yield sec_path, p
            yield from self.iter_paragraphs(sec.get("sections", []), sec_path)

    def paragraph_map(self):
        return {p["id"]: p for _, p in self.iter_paragraphs()}

    # ---------- 状态派生 ----------
    def recompute(self):
        para_ids = set(self.paragraph_map())
        for e in self.edits.values():
            e["status"] = e["decision"] or "pending"
            e["reason"] = ""

        # 1) 目标段落不存在
        for e in self.edits.values():
            if e["status"] == "pending" and e["target"] not in para_ids:
                e["status"] = "invalidated"
                e["reason"] = "目标段落 %s 不存在" % e["target"]

        # 2) 目标段落被已接受的 delete 删除 -> 同段落其余编辑失效
        deleted = {e["target"] for e in self.edits.values()
                   if e["type"] == "delete" and e["status"] == "accepted"}
        for e in self.edits.values():
            if (e["status"] == "pending" and e["target"] in deleted
                    and e["type"] != "delete"):
                e["status"] = "invalidated"
                e["reason"] = "目标段落已被接受的删除编辑移除"
                e["status"] = "invalidated"
                e["reason"] = "目标段落已被接受的删除编辑移除"

        # 3) 依赖链失效（迭代至稳定）
        changed = True
        while changed:
            changed = False
            for e in self.edits.values():
                if e["status"] != "pending":
                    continue
                for dep_id in e["depends_on"]:
                    dep = self.edits.get(dep_id)
                    if dep is None:
                        e["status"] = "invalidated"
                        e["reason"] = "依赖的编辑 %s 不存在" % dep_id
                        changed = True
                        break
                    if dep["status"] in ("rejected", "invalidated", "superseded"):
                        e["status"] = "invalidated"
                        e["reason"] = "依赖的编辑 %s（%s）已%s" % (
                            dep_id, dep["author"], STATUS_CN[dep["status"]])
                        changed = True
                        break

        # 4) 同组取代：手动调整覆盖全组；已接受的本体编辑取代其余本体编辑
        for target in self.group_targets():
            group = [e for e in self.edits.values() if e["target"] == target]
            if target in self.manual:
                for e in group:
                    if e["status"] == "pending":
                        e["status"] = "superseded"
                        e["reason"] = "该段落已被手动调整覆盖"
                continue
            accepted_mains = [e for e in group if e["type"] in MAIN_TYPES
                              and e["status"] == "accepted"]
            if accepted_mains:
                winner = accepted_mains[0]
                for e in group:
                    if (e["status"] == "pending" and e["type"] in MAIN_TYPES
                            and e["id"] != winner["id"]):
                        e["status"] = "superseded"
                        e["reason"] = "被已接受的编辑 %s（%s）取代" % (
                            winner["id"], winner["author"])

    # ---------- 分组/冲突 ----------
    def group_targets(self):
        order = [p["id"] for _, p in self.iter_paragraphs()]
        targets = [t for t in order
                   if any(e["target"] == t for e in self.edits.values())]
        known = set(order)
        for e in self.edits.values():
            if e["target"] not in known and e["target"] not in targets:
                targets.append(e["target"])
        return targets

    def group_info(self, target):
        group = [e for e in self.edits.values() if e["target"] == target]
        active = [e for e in group if e["status"] in ("pending", "accepted")]
        mains = [e for e in active if e["type"] in MAIN_TYPES]
        conflict = len(mains) >= 2
        desc = ""
        if conflict:
            desc = "、".join("%s（%s）" % (e["id"], e["author"]) for e in mains) \
                   + " 同时修改段落本体"
        resolved = (bool(group) and all(e["status"] != "pending" for e in group)) \
            or target in self.manual
        return {"target": target, "edits": group, "conflict": conflict,
                "conflict_desc": desc, "resolved": resolved,
                "manual": target in self.manual}
        return {"target": target, "edits": group, "conflict": conflict,
                "conflict_desc": desc, "resolved": resolved,
                "manual": target in self.manual}

    # ---------- 合并预览 / 最终文档 ----------
    def _merged_text(self, pid, base, final_only):
        """计算某段落合并后的文本；返回 None 表示段落被删除。"""
        group = [e for e in self.edits.values() if e["target"] == pid]

        def use(e):
            return e["status"] == "accepted" or (
                not final_only and e["status"] == "pending")

        if any(e["type"] == "delete" and e["status"] == "accepted" for e in group):
            return None
        text = base
        if pid in self.manual:
            text = self.manual[pid]
        else:
            mains = [e for e in group if e["type"] == "replace" and use(e)]
            info = self.group_info(pid)
            if mains and not (info["conflict"] and not final_only):
                text = mains[0]["content"]
        for e in sorted((e for e in group if e["type"] == "append" and use(e)),
                        key=lambda x: x["id"]):
            text = text + e["content"]
        return text

    def build_document(self, final_only=False):
        """生成合并后的文档结构。final_only=True 时只应用已接受/手动内容。"""
        def walk(sections):
            out = []
            for sec in sections:
                node = {"title": sec.get("title", ""),
                        "paragraphs": [], "sections": []}
                for p in sec.get("paragraphs", []):
                    text = self._merged_text(p["id"], p["text"], final_only)
                    if text is not None:
                        node["paragraphs"].append({"id": p["id"], "text": text})
                    inserts = [
                        e for e in self.edits.values()
                        if e["type"] == "insert_after" and e["target"] == p["id"]
                        and (e["status"] == "accepted"
                             or (not final_only and e["status"] == "pending"))]
                    for e in sorted(inserts, key=lambda x: x["id"]):
                        node["paragraphs"].append(
                            {"id": p["id"] + "+" + e["id"], "text": e["content"]})
                node["sections"] = walk(sec.get("sections", []))
                out.append(node)
            return out
        return {"title": self.document.get("title", ""),
                "sections": walk(self.document.get("sections", []))}
        return {"title": self.document.get("title", ""),
                "sections": walk(self.document.get("sections", []))}

    # ---------- 用户操作 ----------
    def decide(self, edit_id, action, content=None):
        e = self.edits.get(edit_id)
        if e is None:
            raise KeyError("编辑 %s 不存在" % edit_id)
        if action == "accept":
            e["decision"] = "accepted"
        elif action == "reject":
            e["decision"] = "rejected"
        elif action == "reset":
            e["decision"] = None
            self.manual.pop(e["target"], None)
        elif action == "adjust":
            if content is None:
                raise ValueError("手动调整需要提供 content")
            self.manual[e["target"]] = content
        else:
            raise ValueError("未知操作: %s" % action)
        self.recompute()
        return self.group_info(e["target"])

    # ---------- 汇总 ----------
    def unresolved(self):
        out = []
        for t in self.group_targets():
            info = self.group_info(t)
            pending = [e for e in info["edits"] if e["status"] == "pending"]
            if info["conflict"] or pending:
                out.append({"target": t, "conflict": info["conflict"],
                            "pending": [e["id"] for e in pending],
                            "desc": info["conflict_desc"]})
        return out

    def state(self):
        paras = self.paragraph_map()
        groups = []
        for t in self.group_targets():
            info = self.group_info(t)
            original = paras.get(t, {}).get("text", "")
            groups.append({
                "target": t,
                "original": original,
                "preview": self._merged_text(t, original, False),
                "conflict": info["conflict"],
                "conflict_desc": info["conflict_desc"],
                "resolved": info["resolved"], "manual": info["manual"],
                "edits": [{k: e[k] for k in
                           ("id", "author", "type", "content", "depends_on",
                            "note", "status", "reason")}
                          for e in info["edits"]],
            })
        return {"document": self.document, "groups": groups,
                "unresolved": self.unresolved()}
