# -*- coding: utf-8 -*-
"""可疑记录裁决的持久化存储。

裁决以顺序号为键独立存放于 JSON 文件，与校验结论分离：
校验依据变化后只重算受影响区间的结论，裁决本身全部保留。
"""
import json
import os
import time

VERDICTS = ("confirmed_tampered", "accepted", "false_alarm", "pending")


class AdjudicationStore(object):
    def __init__(self, path):
        self.path = path
        self._items = {}
        self.load()

    def load(self):
        self._items = {}
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            for key, val in data.get("adjudications", {}).items():
                self._items[int(key)] = val

    def save(self):
        data = {"adjudications": {str(k): v for k, v in
                                  sorted(self._items.items())}}
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

    def set(self, seq, verdict, note, context_checksum=None):
        if verdict not in VERDICTS:
            raise ValueError("未知裁决类型: %s" % verdict)
        self._items[int(seq)] = {
            "verdict": verdict,
            "note": note or "",
            "context_checksum": context_checksum,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        self.save()
        return self._items[int(seq)]

    def get(self, seq):
        return self._items.get(int(seq))

    def all(self):
        return dict(self._items)
