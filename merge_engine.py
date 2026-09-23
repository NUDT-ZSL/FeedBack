"""协作编辑合并引擎。

核心模型:
- Document: 带章节层级的文档, 叶子为段落 (paragraph)。
- Edit: 协作者提交的一条编辑记录, 指向某个段落。
- 用户决策只存两类: decisions (accept/reject) 与 overrides (手动调整文本)。
  其余一切状态 (失效、冲突、合并结果、最终文档) 均由二者派生,
  因此任何决策变更后整体重算即可保证一致性, 不会残留矛盾内容。
"""

import difflib
import re

OP_REPLACE = "replace"        # 整段替换
OP_DELETE = "delete"          # 删除段落
OP_INSERT_AFTER = "insert_after"  # 在目标段落后插入新段落

STATUS_PENDING = "pending"
STATUS_ACCEPTED = "accepted"
STATUS_REJECTED = "rejected"
STATUS_INVALID = "invalid"

_TOKEN_RE = re.compile(r"\w+|[^\w\s]|\s+", re.UNICODE)


def tokenize(text):
    return _TOKEN_RE.findall(text)


def changed_spans(base_tokens, new_tokens):
    """返回 new 相对 base 的变更区间: (base_start, base_end, 插入内容tokens)。"""
    sm = difflib.SequenceMatcher(a=base_tokens, b=new_tokens, autojunk=False)
    spans = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        spans.append((i1, i2, new_tokens[j1:j2]))
    return spans


def spans_overlap(a, b):
    """两个变更区间是否重叠。零长插入区间与相邻区间不冲突,
    但两个不同内容的插入落在同一位置视为冲突。"""
    a0, a1, _ains = a
    b0, b1, _bins = b
    if a0 == a1 and b0 == b1:  # 都是插入
        return a0 == b0 and _ains != _bins
    if a0 == a1:  # a 是插入
        return b0 < a0 < b1
    if b0 == b1:  # b 是插入
        return a0 < b0 < a1
    return a0 < b1 and b0 < a1


def merge_replaces(base_text, new_texts):
    """尝试把多个整段替换合并为一个结果。

    返回 (ok, merged_text)。若任意两条修改落在重叠区间则失败。
    """
    base_tokens = tokenize(base_text)
    all_spans = []
    for text in new_texts:
        all_spans.extend(changed_spans(base_tokens, tokenize(text)))
    for i in range(len(all_spans)):
        for j in range(i + 1, len(all_spans)):
            if spans_overlap(all_spans[i], all_spans[j]):
                return False, None
    # 区间互不重叠, 按位置从后往前应用, 前面的区间下标不受影响
    tokens = list(base_tokens)
    for start, end, ins in sorted(all_spans, key=lambda s: (s[0], s[1]), reverse=True):
        tokens[start:end] = ins
    return True, "".join(tokens)


def flatten_paragraphs(sections, path=()):
    """把章节树展开为段落列表, 每项含段落与其所属章节路径。"""
    out = []
    for sec in sections:
        sec_path = path + (sec["title"],)
        for para in sec.get("paragraphs", []):
            out.append({"section_path": sec_path, **para})
        out.extend(flatten_paragraphs(sec.get("children", []), sec_path))
    return out


class MergeSession:
    """一次合并确认会话。decisions/overrides 是唯一持久状态。"""

    def __init__(self, document, edits):
        self.document = document
        self.edits = {e["id"]: dict(e) for e in edits}
        self.paragraphs = {p["id"]: p for p in flatten_paragraphs(document["sections"])}
        self.decisions = {}    # edit_id -> accepted / rejected
        self.overrides = {}    # paragraph_id -> 手动调整后的文本

    # ---- 用户操作 -------------------------------------------------------
    def decide(self, edit_id, action):
        if edit_id not in self.edits:
            raise KeyError(f"未知编辑记录: {edit_id}")
        if action not in (STATUS_ACCEPTED, STATUS_REJECTED):
            raise ValueError(f"未知操作: {action}")
        self.decisions[edit_id] = action

    def set_override(self, paragraph_id, text):
        if paragraph_id not in self.paragraphs:
            raise KeyError(f"未知段落: {paragraph_id}")
        self.overrides[paragraph_id] = text

    def clear_override(self, paragraph_id):
        self.overrides.pop(paragraph_id, None)

    # ---- 派生状态 -------------------------------------------------------
    def _deleted_paragraph_ids(self):
        """被已接受的 delete 编辑删除的段落集合。"""
        return {
            e["target"]
            for eid, e in self.edits.items()
            if e["op"] == OP_DELETE and self.decisions.get(eid) == STATUS_ACCEPTED
        }

    def edit_statuses(self):
        """计算每条编辑的状态与失效原因 (失效可传递)。"""
        deleted = self._deleted_paragraph_ids()
        reasons = {}

        def reason_for(eid, seen):
            if eid in reasons:
                return reasons[eid]
            if eid in seen:  # 依赖环, 不再深挖
                return None
            edit = self.edits[eid]
            decision = self.decisions.get(eid)
            if decision == STATUS_REJECTED:
                reasons[eid] = "该编辑已被用户拒绝"
                return reasons[eid]
            if edit["target"] in deleted:
                reasons[eid] = f"目标段落 {edit['target']} 已被接受的删除编辑移除"
                return reasons[eid]
            if edit["target"] not in self.paragraphs:
                reasons[eid] = f"目标段落 {edit['target']} 在文档中不存在"
                return reasons[eid]
            for dep in edit.get("depends_on", []):
                if dep not in self.edits:
                    reasons[eid] = f"依赖的编辑 {dep} 不存在"
                    return reasons[eid]
                dep_reason = reason_for(dep, seen | {eid})
                if dep_reason:
                    reasons[eid] = f"依赖的编辑 {dep} 已失效/被拒绝 ({dep_reason})"
                    return reasons[eid]
            reasons[eid] = None
            return None

        statuses = {}
        for eid in self.edits:
            reason = reason_for(eid, set())
            decision = self.decisions.get(eid)
            if decision:
                statuses[eid] = {"status": decision, "reason": None}
            elif reason:
                statuses[eid] = {"status": STATUS_INVALID, "reason": reason}
            else:
                statuses[eid] = {"status": STATUS_PENDING, "reason": None}
        return statuses

    def paragraph_groups(self):
        """按目标段落分组, 计算每组的冲突情况与合并结果。"""
        statuses = self.edit_statuses()
        groups = {}
        for eid, edit in self.edits.items():
            st = statuses[eid]["status"]
            if st in (STATUS_REJECTED, STATUS_INVALID):
                continue
            groups.setdefault(edit["target"], []).append(eid)

        result = {}
        for pid, eids in groups.items():
            para = self.paragraphs.get(pid)
            if para is None:
                continue
            base = para["text"]
            accepted = [e for e in (self.edits[i] for i in eids)
                        if statuses[e["id"]]["status"] == STATUS_ACCEPTED]
            pending = [e for e in (self.edits[i] for i in eids)
                       if statuses[e["id"]]["status"] == STATUS_PENDING]
            conflicts = []
            merged = base
            mergeable = True

            active = accepted + pending  # 已接受 + 待定共同构成候选合并视图
            deletes = [e for e in active if e["op"] == OP_DELETE]
            replaces = [e for e in active if e["op"] == OP_REPLACE]
            inserts = [e for e in active if e["op"] == OP_INSERT_AFTER]

            if deletes and (replaces or inserts):
                names = "、".join(e["author"] for e in deletes)
                conflicts.append(f"{names} 要求删除本段, 与其他修改/插入冲突")
                mergeable = False
            if len(deletes) > 1:
                conflicts.append("多位协作者均要求删除本段")
            if len(replaces) > 1:
                ok, text = merge_replaces(base, [e["content"] for e in replaces])
                if ok:
                    merged = text
                else:
                    names = "、".join(e["author"] for e in replaces)
                    conflicts.append(f"{names} 的修改落在重叠区间, 无法自动合并")
                    mergeable = False
            elif len(replaces) == 1:
                merged = replaces[0]["content"]
            if deletes and not (replaces or inserts):
                merged = None  # 段落将被删除

            result[pid] = {
                "paragraph_id": pid,
                "base_text": base,
                "merged_text": merged,
                "deleted": merged is None,
                "mergeable": mergeable,
                "conflicts": conflicts,
                "override": self.overrides.get(pid),
                "edits": [
                    {
                        "id": e["id"],
                        "author": e["author"],
                        "op": e["op"],
                        "content": e.get("content", ""),
                        "depends_on": e.get("depends_on", []),
                        "note": e.get("note", ""),
                        "status": statuses[e["id"]]["status"],
                        "reason": statuses[e["id"]]["reason"],
                    }
                    for e in (self.edits[i] for i in eids)
                ],
            }
        return result

    def final_paragraph_text(self, pid):
        """段落的最终文本: 手动调整 > 已接受编辑的合并 > 原文。

        返回 (text, deleted)。deleted 为 True 表示该段被移除。
        """
        if pid in self.overrides:
            return self.overrides[pid], False
        statuses = self.edit_statuses()
        accepted = [
            e for e in self.edits.values()
            if e["target"] == pid and statuses[e["id"]]["status"] == STATUS_ACCEPTED
        ]
        if any(e["op"] == OP_DELETE for e in accepted):
            return None, True
        replaces = [e["content"] for e in accepted if e["op"] == OP_REPLACE]
        base = self.paragraphs[pid]["text"]
        if not replaces:
            return base, False
        ok, text = merge_replaces(base, replaces)
        return (text if ok else replaces[-1]), False

    def final_document(self):
        """生成最终文档 (章节结构不变, 段落按决策更新/删除/插入)。"""
        statuses = self.edit_statuses()
        inserts_after = {}
        for eid, e in self.edits.items():
            if e["op"] == OP_INSERT_AFTER and statuses[eid]["status"] == STATUS_ACCEPTED:
                inserts_after.setdefault(e["target"], []).append(e["content"])

        def build(sections):
            out = []
            for sec in sections:
                paras = []
                for para in sec.get("paragraphs", []):
                    text, deleted = self.final_paragraph_text(para["id"])
                    if not deleted:
                        paras.append({"id": para["id"], "text": text})
                    for ins in inserts_after.get(para["id"], []):
                        paras.append({"id": f"{para['id']}+ins", "text": ins})
                out.append({
                    "id": sec["id"],
                    "title": sec["title"],
                    "paragraphs": paras,
                    "children": build(sec.get("children", [])),
                })
            return out

        return {"title": self.document["title"], "sections": build(self.document["sections"])}

    def unresolved(self):
        """未解决清单: 待定编辑与仍存在冲突的段落。"""
        statuses = self.edit_statuses()
        groups = self.paragraph_groups()
        pending_edits = [
            {"id": eid, "author": self.edits[eid]["author"], "target": self.edits[eid]["target"]}
            for eid, st in statuses.items() if st["status"] == STATUS_PENDING
        ]
        conflict_paras = [
            {"paragraph_id": pid, "conflicts": g["conflicts"]}
            for pid, g in groups.items() if g["conflicts"]
        ]
        return {"pending_edits": pending_edits, "conflict_paragraphs": conflict_paras}

    def state(self):
        """导出完整状态供前端渲染。"""
        statuses = self.edit_statuses()
        return {
            "document": self.document,
            "paragraphs": self.paragraphs,
            "groups": self.paragraph_groups(),
            "edits": [
                {
                    "id": e["id"], "author": e["author"], "op": e["op"],
                    "target": e["target"], "content": e.get("content", ""),
                    "depends_on": e.get("depends_on", []), "note": e.get("note", ""),
                    "status": statuses[e["id"]]["status"],
                    "reason": statuses[e["id"]]["reason"],
                }
                for e in self.edits.values()
            ],
            "final_document": self.final_document(),
            "unresolved": self.unresolved(),
        }
