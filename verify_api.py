# -*- coding: utf-8 -*-
"""对运行中的服务器做端到端 API 验证（临时脚本）。"""
import json
import urllib.request

BASE = "http://127.0.0.1:8017"


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def link_of(state, src, tgt):
    return [l for e in state["entries"] if e["id"] == src
            for l in e["links"] if l["target"] == tgt][0]


# 1) 确认后实质改写 -> 待重新确认
post("/api/links/decision",
     {"source": "E001", "target": "E005", "decision": "confirmed"})
r = post("/api/entries/E005/revise",
         {"body": "评审流程关注边界条件、单测覆盖率与日志规范，配置变更走评审。",
          "tags": ["流程", "质量"], "note": "改写为评审主题"})
lk = link_of(r["state"], "E001", "E005")
print("1 confirmed+substantive:", lk["decision"], lk["state"])

# 2) 推断链接依据消失 -> 失效
r = post("/api/entries/E006/revise",
         {"body": "本条目记录团队周会的议题收集与纪要归档方式。",
          "tags": ["流程"], "note": "改写为会议纪要"})
lk = link_of(r["state"], "E001", "E006")
print("2 inferred invalidated:", lk["origin"], lk["state"])

# 3) 废弃传播
r = post("/api/entries/E004/deprecate", {"note": "内容过时"})
lk = link_of(r["state"], "E002", "E004")
print("3 deprecate inbound:", lk["state"])

# 4) 否决后修订不复活
post("/api/links/decision",
     {"source": "E003", "target": "E007", "decision": "rejected"})
r = post("/api/entries/E003/revise", {"note": "微调措辞"})
lk = link_of(r["state"], "E003", "E007")
print("4 rejected stays:", lk["decision"], lk["state"])

# 5) 合并
r = post("/api/entries/E007/merge", {"target": "E003"})
e7 = [e for e in r["state"]["entries"] if e["id"] == "E007"][0]
print("5 merged:", e7["status"], e7["merged_into"])

# 6) 新建条目触发推断
r = post("/api/entries",
         {"title": "缓存雪崩防护",
          "body": "缓存雪崩指大量缓存同时失效，要给缓存失效时间加随机抖动，Redis 层做限流。",
          "tags": ["缓存", "稳定性"]})
new = [e for e in r["state"]["entries"] if e["id"] == r["id"]][0]
print("6 new entry inferred:",
      [(l["target"], l["reason"][:36]) for l in new["links"]])

# 7) 冲突仍然保留双方
e5 = [e for e in r["state"]["entries"] if e["id"] == "E005"][0]
e6 = [e for e in r["state"]["entries"] if e["id"] == "E006"][0]
print("7 conflict kept:",
      link_of(r["state"], "E005", "E006")["state"],
      link_of(r["state"], "E006", "E005")["state"])
