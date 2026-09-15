"""测试公共构造：一条覆盖字段增删、类型放宽、枚举扩值、嵌套重排的演进链。

v1（根）
    id       integer 必填
    name     string  必填
    status   string  必填，枚举 draft/published
    score    number，可选，默认 0
    tags     array<string>，默认 []

v2（父 v1）
    枚举扩值：status 增加 archived
    新增 address 对象（默认整体缺省），含 city（默认 "unknown"）/zip
    score 不变

v3（父 v2，带 transform）
    字段增删：name 消失；新增 title（必填，由 transform 从 name 改名而来）
    嵌套重排：tags 从 array<string> 变为 array<object{label:string}>，
              transform 把旧标签包成 {"label": ...}
    枚举迁移：status 收窄为 draft/live/archived，published -> live
"""

from __future__ import annotations

from evo_kernel import Kernel, Transform

V1_FIELDS = [
    {"name": "id", "type": "integer", "required": True},
    {"name": "name", "type": "string", "required": True},
    {
        "name": "status",
        "type": "string",
        "required": True,
        "enum": ["draft", "published"],
    },
    {"name": "score", "type": "number", "default": 0},
    {
        "name": "tags",
        "type": "array",
        "item": {"name": "tag", "type": "string"},
        "default": [],
    },
]

V2_FIELDS = [
    {"name": "id", "type": "integer", "required": True},
    {"name": "name", "type": "string", "required": True},
    {
        "name": "status",
        "type": "string",
        "required": True,
        "enum": ["draft", "published", "archived"],
    },
    {"name": "score", "type": "number", "default": 0},
    {
        "name": "tags",
        "type": "array",
        "item": {"name": "tag", "type": "string"},
        "default": [],
    },
    {
        "name": "address",
        "type": "object",
        "fields": [
            {"name": "city", "type": "string", "default": "unknown"},
            {"name": "zip", "type": "string"},
        ],
    },
]

STATUS_MAP = {"draft": "draft", "published": "live", "archived": "archived"}


def transform_v3(data):
    """name->title 改名、status 枚举迁移、tags 元素包成对象。"""
    if "name" in data:
        data["title"] = data.pop("name")
    data["status"] = STATUS_MAP[data["status"]]
    if "tags" in data:
        data["tags"] = [{"label": t} for t in data["tags"]]


V3_FIELDS = [
    {"name": "id", "type": "integer", "required": True},
    {"name": "title", "type": "string", "required": True},
    {
        "name": "status",
        "type": "string",
        "required": True,
        "enum": ["draft", "live", "archived"],
    },
    {"name": "score", "type": "number", "default": 0},
    {
        "name": "tags",
        "type": "array",
        "item": {
            "name": "tag",
            "type": "object",
            "fields": [{"name": "label", "type": "string", "required": True}],
        },
        "default": [],
    },
    {
        "name": "address",
        "type": "object",
        "fields": [
            {"name": "city", "type": "string", "default": "unknown"},
            {"name": "zip", "type": "string"},
        ],
    },
]


def build_kernel() -> Kernel:
    k = Kernel()
    k.register_version("v1", V1_FIELDS, description="初始版本")
    k.register_version("v2", V2_FIELDS, parent="v1", description="枚举扩值+地址")
    k.register_version(
        "v3",
        V3_FIELDS,
        parent="v2",
        description="改名/枚举迁移/嵌套重排",
        transform=Transform("v2->v3: name改名title, status收窄, tags包对象", transform_v3),
    )
    return k


V3_TRANSFORM_KWARGS = {"description": "v2->v3", "fn": transform_v3}
