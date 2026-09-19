# -*- coding: utf-8 -*-
"""数据层：SQLite 持久化 + 增量重算 + 全量一致性校验。

增量策略：
- 补录采证 -> 只重算该学员；
- 修改规则 -> 只重算“变化维度及其传递后继”所影响到的学员。
校验接口用全部记录从头重算，与缓存逐一比对，保证两种路径结果一致。
"""
import json
import os
import sqlite3
import threading

import engine

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workbench.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student TEXT NOT NULL,
    dimension TEXT NOT NULL,
    evaluator TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (student TEXT PRIMARY KEY, json TEXT NOT NULL);
"""


class Store(object):
    def __init__(self, path=DB_PATH):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.RLock()
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        if self.conn.execute("SELECT COUNT(*) c FROM rules").fetchone()["c"] == 0:
            self.conn.execute("INSERT INTO rules (id, json) VALUES (1, ?)",
                              (json.dumps(engine.DEFAULT_RULES, ensure_ascii=False),))
            self.conn.commit()

    # ---- 规则 ----
    def get_rules(self):
        row = self.conn.execute("SELECT json FROM rules WHERE id = 1").fetchone()
        return json.loads(row["json"])

    def set_rules(self, rules):
        old = self.get_rules()
        self.conn.execute("UPDATE rules SET json = ? WHERE id = 1",
                          (json.dumps(rules, ensure_ascii=False),))
        self.conn.commit()
        affected = self._affected_students_by_rule_change(old, rules)
        self._recompute(affected)
        return sorted(affected)

    def _affected_students_by_rule_change(self, old, new):
        """规则变化影响的维度（变化维度 + 传递后继）-> 相关学员。"""
        od, nd = old.get("dimensions", {}), new.get("dimensions", {})
        changed = {d for d in set(od) | set(nd) if od.get(d) != nd.get(d)}
        if (old.get("level_scores") != new.get("level_scores")
                or old.get("grade_bands") != new.get("grade_bands")):
            changed = set(nd) | set(od)
        dims = set(changed)
        frontier = set(changed)
        while frontier:  # 传递闭包：后继维度也受影响
            nxt = {d for d, r in nd.items()
                   if set(r.get("prereqs", [])) & frontier} - dims
            dims |= nxt
            frontier = nxt
        if not dims:
            return set()
        marks = ",".join("?" * len(dims))
        rows = self.conn.execute(
            "SELECT DISTINCT student FROM evidence WHERE dimension IN (%s)" % marks,
            tuple(dims)).fetchall()
        students = {r["student"] for r in rows}
        # 权重变化会改变所有学员的综合分母，把已有结果的学员也纳入
        if any(od.get(d, {}).get("weight") != nd.get(d, {}).get("weight")
               for d in set(od) & set(nd)):
            rows = self.conn.execute("SELECT student FROM results").fetchall()
            students |= {r["student"] for r in rows}
        return students

    # ---- 采证 ----
    def add_evidence(self, records):
        """批量导入/补录。返回受影响学员。"""
        students = set()
        for r in records:
            self.conn.execute(
                "INSERT INTO evidence (student, dimension, evaluator, recorded_at, value)"
                " VALUES (?,?,?,?,?)",
                (r["student"], r["dimension"], r.get("evaluator", ""),
                 r.get("recorded_at", ""), json.dumps(r["value"], ensure_ascii=False)))
            students.add(r["student"])
        self.conn.commit()
        self._recompute(students)
        return sorted(students)

    def delete_evidence(self, evidence_id):
        row = self.conn.execute("SELECT student FROM evidence WHERE id = ?",
                                (evidence_id,)).fetchone()
        if not row:
            return None
        self.conn.execute("DELETE FROM evidence WHERE id = ?", (evidence_id,))
        self.conn.commit()
        self._recompute({row["student"]})
        return row["student"]

    # ---- 计算 ----
    def _evidence_by_student(self, students=None):
        sql = "SELECT * FROM evidence"
        args = ()
        if students is not None:
            if not students:
                return {}
            marks = ",".join("?" * len(students))
            sql += " WHERE student IN (%s)" % marks
            args = tuple(students)
        out = {}
        for r in self.conn.execute(sql, args):
            out.setdefault(r["student"], {}).setdefault(
                r["dimension"], []).append({
                    "id": r["id"], "evaluator": r["evaluator"],
                    "recorded_at": r["recorded_at"], "value": json.loads(r["value"])})
        return out

    def _recompute(self, students):
        """增量：只重算给定学员，写入结果缓存。"""
        rules = self.get_rules()
        data = self._evidence_by_student(students)
        for s in students:
            result = engine.evaluate_student(data.get(s, {}), rules)
            self.conn.execute(
                "INSERT INTO results (student, json) VALUES (?, ?)"
                " ON CONFLICT(student) DO UPDATE SET json = excluded.json",
                (s, json.dumps(result, ensure_ascii=False)))
        self.conn.commit()

    def verify_consistency(self):
        """全量重算并与增量缓存比对。返回 (ok, 不一致学员列表)。"""
        rules = self.get_rules()
        data = self._evidence_by_student()
        cached = {r["student"]: json.loads(r["json"])
                  for r in self.conn.execute("SELECT * FROM results")}
        mismatched = []
        for s in set(data) | set(cached):
            fresh = engine.evaluate_student(data.get(s, {}), rules)
            if json.dumps(fresh, sort_keys=True) != \
                    json.dumps(cached.get(s), sort_keys=True):
                mismatched.append(s)
        return (not mismatched, mismatched)

    # ---- 查询 ----
    def list_students(self):
        out = []
        for r in self.conn.execute("SELECT * FROM results ORDER BY student"):
            res = json.loads(r["json"])
            c = res["composite"]
            out.append({"student": r["student"], "grade": c["grade"],
                        "score": c["score"], "stable": c["stable"],
                        "coverage": c["coverage"],
                        "assessed": c["assessed"], "total": c["total"],
                        "has_conflict": any(d["conflict"]
                                            for d in res["dims"].values())})
        return out

    def student_detail(self, student):
        row = self.conn.execute("SELECT json FROM results WHERE student = ?",
                                (student,)).fetchone()
        return json.loads(row["json"]) if row else None

    def reset(self):
        self.conn.executescript("DELETE FROM evidence; DELETE FROM results;")
        self.conn.commit()
