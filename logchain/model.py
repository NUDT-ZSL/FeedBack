# -*- coding: utf-8 -*-
"""日志记录模型与校验值计算。

校验值算法（离线、确定性的 SHA-256 链式摘要）：
    checksum_i = sha256(canonical(seq, time, source, body, prev_checksum))
其中 prev_checksum 为首条记录取 GENESIS，其余取所引用前序记录的校验值。
"""
import hashlib
import json
import re

CHECKSUM_RE = re.compile(r"^[0-9a-f]{64}$")
GENESIS = "0" * 64  # 首条记录使用的前序校验值


def checksum_format_ok(value):
    return isinstance(value, str) and CHECKSUM_RE.match(value) is not None


def compute_checksum(seq, time, source, body, prev_checksum):
    payload = "v1\n%s\n%s\n%s\n%s\n%s" % (seq, time, source, body, prev_checksum)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class LogRecord(object):
    __slots__ = ("seq", "time", "source", "body", "prev_seq", "checksum",
                 "line_no", "raw", "parse_error")

    def __init__(self, seq, time, source, body, prev_seq, checksum,
                 line_no=0, raw=None, parse_error=None):
        self.seq = seq
        self.time = time
        self.source = source
        self.body = body
        self.prev_seq = prev_seq
        self.checksum = checksum
        self.line_no = line_no
        self.raw = raw
        self.parse_error = parse_error

    @classmethod
    def from_json_line(cls, line, line_no):
        text = line.strip()
        try:
            obj = json.loads(text)
        except ValueError as exc:
            return cls(None, "", "", "", None, None, line_no=line_no,
                       raw={"text": text},
                       parse_error="JSON 解析失败: %s" % exc)
        if not isinstance(obj, dict):
            return cls(None, "", "", "", None, None, line_no=line_no,
                       raw={"text": text},
                       parse_error="记录不是 JSON 对象")
        seq = obj.get("seq")
        if not isinstance(seq, int):
            seq = None
        prev_seq = obj.get("prev_seq")
        if prev_seq is not None and not isinstance(prev_seq, int):
            prev_seq = -1  # 非法引用，校验阶段会标记为指向不存在
        checksum = obj.get("checksum")
        if checksum is not None and not isinstance(checksum, str):
            checksum = str(checksum)
        return cls(seq, obj.get("time", ""), obj.get("source", ""),
                   obj.get("body", ""), prev_seq, checksum,
                   line_no=line_no, raw=obj)

    def to_json_line(self):
        return json.dumps({
            "seq": self.seq,
            "time": self.time,
            "source": self.source,
            "body": self.body,
            "prev_seq": self.prev_seq,
            "checksum": self.checksum,
        }, ensure_ascii=False)
