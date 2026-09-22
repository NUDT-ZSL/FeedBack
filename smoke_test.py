# -*- coding: utf-8 -*-
"""端到端冒烟测试：真实 HTTP 请求打到运行中的服务。"""
import json
import urllib.request

BASE = "http://127.0.0.1:5057"


def call(path, payload=None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    call("/api/reset", {})
    with open("sample_feedbacks.txt", encoding="utf-8") as f:
        text = f.read()
    st = call("/api/import", {"text": text})
    print("导入:", st["import_report"])
    print("簇分布:", [(c["id"], c["size"]) for c in st["clusters"]])
    for c in st["clusters"]:
        print(" ", c["id"], c["size"], "条 |", c["label"])
    print("冲突数:", len(st["conflicts"]))
    for cf in st["conflicts"][:3]:
        print("  冲突", cf["a"], "<->", cf["b"], cf["similarity"])

    # 人工修订：移动 -> 拆分 -> 合并 -> 冲突裁决
    big = max(st["clusters"], key=lambda x: x["size"])
    fid = big["member_ids"][0]
    st = call("/api/move", {"feedback_id": fid, "target_cluster_id": "new"})
    print("移动后簇数:", len(st["clusters"]))
    st = call("/api/merge", {"cluster_a": st["clusters"][0]["id"],
                             "cluster_b": st["clusters"][1]["id"]})
    print("合并后簇数:", len(st["clusters"]))
    if st["conflicts"]:
        cf = st["conflicts"][0]
        st = call("/api/conflict", {"a": cf["a"], "b": cf["b"], "action": "merge"})
        print("冲突裁决后剩余冲突:", len(st["conflicts"]))
    leads = call("/api/leads")["leads"]
    print("线索(按规模):", [(l["lead_id"], l["size"]) for l in leads[:5]])
    total = sum(l["size"] for l in leads)
    assert total == len(st["feedbacks"]), "线索来源反馈数与总反馈数不一致!"
    assigned = [m for c in st["clusters"] for m in c["member_ids"]]
    assert sorted(assigned) == sorted(f["id"] for f in st["feedbacks"])
    print("OK: 全部反馈归属完整，无遗漏无重复")


if __name__ == "__main__":
    main()
