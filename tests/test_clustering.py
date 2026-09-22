# -*- coding: utf-8 -*-
"""端到端一致性测试：人工修订后的结果必须与全量重算一致。"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SAMPLE = [
    "登录的时候经常提示密码错误，但我确定密码是对的",
    "每次登录都要输两遍密码才能进去",
    "扫码登录经常失败，手机扫了没反应",
    "支付的时候跳转支付宝一直转圈",
    "付款成功了但订单状态还是待支付",
    "微信支付偶尔扣了钱但订单没生成",
    "搜索结果和关键词完全不相关",
    "搜索框输入后没有联想提示",
    "希望支持深色模式，晚上太刺眼",
    "字体太小了，老人看不清",
]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FEEDBACK_STATE_FILE", str(tmp_path / "state.json"))
    import app as app_module
    importlib.reload(app_module)
    app_module.state = {"feedbacks": [], "decisions": [],
                        "next_fid": 1, "next_did": 1}
    app_module.refresh()
    c = app_module.app.test_client()
    c.post("/api/import", json={"text": "\n".join(SAMPLE)})
    return c, app_module


def independent_recompute(app_module):
    """绕过缓存，独立全量重算。"""
    import clustering
    return clustering.recompute(app_module.state["feedbacks"],
                                app_module.state["decisions"])


def assert_consistent(resp, app_module):
    """需求 4：接口返回结果 == 从头全量重算；每条反馈恰好归属一个簇。"""
    body = resp.get_json()
    fresh = independent_recompute(app_module)
    assert body["assignment"] == {str(k): v for k, v in fresh["assignment"].items()} \
        or body["assignment"] == fresh["assignment"]
    assert body["clusters"] == fresh["clusters"]
    assigned = [m for c in body["clusters"] for m in c["member_ids"]]
    assert sorted(assigned) == sorted(f["id"] for f in app_module.state["feedbacks"])
    assert len(assigned) == len(set(assigned))  # 无重复归属


def test_import_assigns_everything(client):
    c, mod = client
    r = c.get("/api/state")
    body = r.get_json()
    assert len(body["feedbacks"]) == len(SAMPLE)
    assert_consistent(r, mod)
    assert len(body["clusters"]) >= 3  # 登录/支付/搜索等主题应分开


def test_move_then_full_recompute_consistent(client):
    c, mod = client
    st = c.get("/api/state").get_json()
    fid = st["clusters"][0]["member_ids"][0]
    # 注意：簇 id 由成员最小 id 确定性生成，重算后可能重排，
    # 因此用「目标簇的既有成员」来验证移动结果，而非簇 id。
    target_cl = [x for x in st["clusters"] if fid not in x["member_ids"]][0]
    target_mate = target_cl["member_ids"][0]
    r = c.post("/api/move",
               json={"feedback_id": fid, "target_cluster_id": target_cl["id"]})
    assert_consistent(r, mod)
    body = r.get_json()
    assert body["assignment"][str(fid)] == body["assignment"][str(target_mate)]


def test_split_and_merge_consistent(client):
    c, mod = client
    st = c.get("/api/state").get_json()
    big = max(st["clusters"], key=lambda x: x["size"])
    if big["size"] >= 2:
        sub = big["member_ids"][:1]
        rest_mate = big["member_ids"][1]
        r = c.post("/api/split", json={"cluster_id": big["id"], "feedback_ids": sub})
        assert_consistent(r, mod)
        body = r.get_json()
        # 拆出后：sub 与簇内其余成员不再同簇
        assert body["assignment"][str(sub[0])] != body["assignment"][str(rest_mate)]
    st = c.get("/api/state").get_json()
    a, b = st["clusters"][0]["id"], st["clusters"][1]["id"]
    r = c.post("/api/merge", json={"cluster_a": a, "cluster_b": b})
    assert_consistent(r, mod)
    body = r.get_json()
    members = {cl["id"]: cl["member_ids"] for cl in body["clusters"]}
    assert len(members) == len(st["clusters"]) - 1


def test_conflict_resolution_recorded_and_applied(client):
    c, mod = client
    import clustering
    # 构造一对跨簇高相似反馈：先导入，再强制拆开制造冲突
    c.post("/api/import", json={"text": "登录总是失败，提示密码错误\n登录老是失败，说密码不对"})
    st = c.get("/api/state").get_json()
    pair = None
    text_of = {f["id"]: f["text"] for f in st["feedbacks"]}
    ids = [i for i, t in text_of.items() if "登录" in t and "失败" in t]
    if len(ids) >= 2 and st["assignment"][str(ids[0])] == st["assignment"][str(ids[1])]:
        # 强制拆开，制造冲突场景
        cid = st["assignment"][str(ids[0])]
        c.post("/api/split", json={"cluster_id": cid, "feedback_ids": [ids[0]]})
        pair = (ids[0], ids[1])
    st = c.get("/api/state").get_json()
    if pair and st["conflicts"]:
        cf = next((x for x in st["conflicts"]
                   if {x["a"], x["b"]} == set(pair)), st["conflicts"][0])
        r = c.post("/api/conflict",
                   json={"a": cf["a"], "b": cf["b"], "action": "merge"})
        assert_consistent(r, mod)
        body = r.get_json()
        # 决策已记录
        assert any(d["source"] == "conflict" and d["type"] == "must_link"
                   and {d["a"], d["b"]} == {cf["a"], cf["b"]}
                   for d in body["decisions"])
        # 裁决后两者同簇，且该冲突不再出现
        assert body["assignment"][str(cf["a"])] == body["assignment"][str(cf["b"])]
        assert not any({x["a"], x["b"]} == {cf["a"], cf["b"]}
                       for x in body["conflicts"])
        # 再裁决分开
        r = c.post("/api/conflict",
                   json={"a": cf["a"], "b": cf["b"], "action": "separate"})
        assert_consistent(r, mod)
        body = r.get_json()
        assert body["assignment"][str(cf["a"])] != body["assignment"][str(cf["b"])]
        assert any(d["type"] == "cannot_link" and d["source"] == "conflict"
                   and {d["a"], d["b"]} == {cf["a"], cf["b"]}
                   for d in body["decisions"])


def test_leads_sorted_by_size_and_linked(client):
    c, mod = client
    leads = c.get("/api/leads").get_json()["leads"]
    sizes = [l["size"] for l in leads]
    assert sizes == sorted(sizes, reverse=True)
    all_ids = [i for l in leads for i in l["feedback_ids"]]
    assert sorted(all_ids) == sorted(f["id"] for f in mod.state["feedbacks"])


def test_determinism(client):
    _, mod = client
    r1 = independent_recompute(mod)
    r2 = independent_recompute(mod)
    assert r1 == r2
