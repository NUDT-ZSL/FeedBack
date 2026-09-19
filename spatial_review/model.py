"""Scene data, validation and lifecycle rules."""

from dataclasses import dataclass, field, replace
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .geometry import Matrix4, compose_matrix, identity, mat_mul, transform_point


Vec3 = Tuple[float, float, float]


class ValidationError(ValueError):
    """A rejected operation.

    ``issues`` contains machine-readable locations while the message remains
    readable in the GUI and on the command line.
    """

    def __init__(self, message: str, issues: Optional[List[Dict[str, object]]] = None):
        super().__init__(message)
        self.issues = list(issues or [])


def _as_vec(value, location: str) -> Vec3:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValidationError(f"{location} 必须是包含三个数字的数组", [{"location": location}])
    try:
        result = tuple(float(v) for v in value)
    except (TypeError, ValueError):
        raise ValidationError(f"{location} 包含非数字值", [{"location": location}])
    return result  # type: ignore[return-value]


def _as_matrix(value) -> Matrix4:
    if value is None:
        return identity()
    if len(value) != 4 or any(len(row) != 4 for row in value):
        raise ValidationError(
            "局部变换必须是 4x4 矩阵", [{"location": "transform", "field": "matrix"}]
        )
    try:
        return tuple(tuple(float(x) for x in row) for row in value)  # type: ignore
    except (TypeError, ValueError):
        raise ValidationError(
            "局部变换包含非数字值", [{"location": "transform", "field": "matrix"}]
        )


@dataclass
class Transform:
    translation: Vec3 = (0.0, 0.0, 0.0)
    rotation_xyz: Vec3 = (0.0, 0.0, 0.0)  # radians, applied z*y*x
    scale: Vec3 = (1.0, 1.0, 1.0)
    explicit_matrix: Optional[Matrix4] = None

    @classmethod
    def from_data(cls, data: Optional[Dict] = None) -> "Transform":
        data = data or {}
        result = cls()
        if "matrix" in data:
            result.explicit_matrix = _as_matrix(data["matrix"])
            return result
        if "translation" in data:
            result.translation = _as_vec(data["translation"], "transform.translation")
        if "rotation_xyz" in data:
            result.rotation_xyz = _as_vec(data["rotation_xyz"], "transform.rotation_xyz")
        if "scale" in data:
            result.scale = _as_vec(data["scale"], "transform.scale")
        return result

    def matrix(self) -> Matrix4:  # Small shim for the optional matrix branch.
        if self.explicit_matrix is not None:
            return self.explicit_matrix
        return compose_matrix(self.translation, self.rotation_xyz, self.scale)


@dataclass
class SpatialObject:
    id: str
    parent_id: Optional[str] = None
    transform: Transform = field(default_factory=Transform)
    size: Vec3 = (1.0, 1.0, 1.0)


@dataclass
class Annotation:
    id: str
    object_id: str
    local_anchor: Vec3
    body: str
    source: str = "default"


@dataclass
class Relation:
    from_annotation: str
    to_annotation: str
    kind: str = "reference"  # "reference" or "attachment"
    from_source: Optional[str] = None
    to_source: Optional[str] = None


@dataclass
class InvalidEvidence:
    object_id: str
    local_anchor: Vec3
    world_anchor: Vec3
    object_path: List[str]
    reason: str


@dataclass
class AnnotationState:
    annotation: Annotation
    valid: bool = True
    evidence: Optional[InvalidEvidence] = None


@dataclass
class ConflictRecord:
    annotation_id: str
    field: str
    sources: List[str]
    contents: List[object]
    message: str


class Scene:
    """Owns objects, annotations, relations and all mutation rules."""

    def __init__(self) -> None:
        self.objects: Dict[str, SpatialObject] = {}
        self.object_order: List[str] = []
        self.children: Dict[str, List[str]] = {}
        self.annotations: Dict[Tuple[str, str], AnnotationState] = {}
        self.relations: List[Relation] = []
        self.conflicts: List[ConflictRecord] = []
        self._world_cache: Dict[str, Matrix4] = {}

    # ------------------------------------------------------------------
    # Object hierarchy
    # ------------------------------------------------------------------
    def add_object(
        self,
        obj_id: str,
        parent_id: Optional[str] = None,
        transform: Optional[Transform] = None,
        size: Sequence[float] = (1.0, 1.0, 1.0),
    ) -> SpatialObject:
        issues: List[Dict[str, object]] = []
        if not isinstance(obj_id, str) or not obj_id.strip():
            issues.append({"location": "object.id", "reason": "标识必须是非空字符串"})
        if obj_id in self.objects:
            issues.append({"location": f"object[{obj_id}].id", "value": obj_id,
                           "reason": "对象标识重复"})
        if parent_id is not None and parent_id not in self.objects:
            issues.append({"location": f"object[{obj_id}].parent_id", "value": parent_id,
                           "reason": "父对象不存在"})
        dimensions = _as_vec(size, f"object[{obj_id}].size")
        for axis, value in zip(("x", "y", "z"), dimensions):
            if value <= 0:
                issues.append({"location": f"object[{obj_id}].size.{axis}", "value": value,
                               "reason": "包围尺寸必须为正数"})
        transform = transform or Transform()
        if transform.explicit_matrix is not None:
            try:
                from .geometry import invert_affine
                invert_affine(transform.explicit_matrix)
            except ValueError:
                issues.append({"location": f"object[{obj_id}].transform.matrix",
                               "reason": "局部变换不可逆"})
        if issues:
            raise ValidationError("新增对象被拒绝", issues)

        obj = SpatialObject(obj_id, parent_id, transform, dimensions)
        self.objects[obj_id] = obj
        self.object_order.append(obj_id)
        self.children.setdefault(parent_id, []).append(obj_id)
        self.children.setdefault(obj_id, [])
        self._rebuild_world_matrices()
        return obj

    def subtree_ids(self, root_id: str) -> List[str]:
        result: List[str] = []
        stack = [root_id]
        while stack:
            current = stack.pop()
            result.append(current)
            stack.extend(reversed(self.children.get(current, [])))
        return result

    def _ancestor_chain(self, obj_id: str) -> List[str]:
        chain = []
        current: Optional[str] = obj_id
        seen: Set[str] = set()
        while current is not None:
            if current in seen:
                chain.append(current + " (环)")
                break
            seen.add(current)
            chain.append(current)
            current = self.objects[current].parent_id if current in self.objects else None
        return chain

    def object_path(self, obj_id: str) -> List[str]:
        return list(reversed(self._ancestor_chain(obj_id)))

    def _rebuild_world_matrices(self) -> None:
        self._world_cache = {}
        pending = set(self.object_order)
        ordered: List[str] = []
        while pending:
            progressed = False
            for obj_id in list(self.object_order):
                if obj_id not in pending:
                    continue
                parent_id = self.objects[obj_id].parent_id
                if parent_id is None or parent_id not in pending:
                    ordered.append(obj_id)
                    pending.remove(obj_id)
                    progressed = True
            if not progressed:
                # Defensive: hierarchy cycles should have been rejected earlier.
                ordered.extend(sorted(pending))
                break
        for obj_id in ordered:
            obj = self.objects[obj_id]
            local = obj.transform.matrix()
            if obj.parent_id is None:
                self._world_cache[obj_id] = local
            else:
                self._world_cache[obj_id] = mat_mul(self._world_cache[obj.parent_id], local)

    def world_matrix(self, obj_id: str) -> Matrix4:
        if not self._world_cache:
            self._rebuild_world_matrices()
        return self._world_cache[obj_id]

    def world_bounds(self, obj_id: str) -> Tuple[Vec3, Vec3]:
        sx, sy, sz = self.objects[obj_id].size
        matrix = self.world_matrix(obj_id)
        corners = []
        for x in (0.0, sx):
            for y in (0.0, sy):
                for z in (0.0, sz):
                    corners.append(transform_point(matrix, (x, y, z)))
        mins = tuple(min(c[i] for c in corners) for i in range(3))
        maxs = tuple(max(c[i] for c in corners) for i in range(3))
        return mins, maxs  # type: ignore[return-value]

    def set_object_transform(
        self,
        obj_id: str,
        transform: Transform,
    ) -> None:
        if obj_id not in self.objects:
            raise ValidationError("对象变换被拒绝", [
                {"location": f"object[{obj_id}]", "reason": "对象不存在"}
            ])
        issues: List[Dict[str, object]] = []
        if transform.explicit_matrix is not None:
            try:
                from .geometry import invert_affine
                invert_affine(transform.explicit_matrix)
            except ValueError:
                issues.append({"location": f"object[{obj_id}].transform.matrix",
                               "reason": "局部变换不可逆"})
        else:
            for axis, value in zip(("x", "y", "z"), transform.scale):
                if value <= 0:
                    issues.append({"location": f"object[{obj_id}].scale.{axis}",
                                   "value": value, "reason": "缩放必须为正数"})
        if issues:
            raise ValidationError("对象变换被拒绝", issues)
        self.objects[obj_id].transform = transform
        self._rebuild_world_matrices()

    def _freeze_annotations_for(self, subtree: Iterable[str], reason: str) -> None:
        affected = set(subtree)
        for state in self.annotations.values():
            if state.valid and state.annotation.object_id in affected:
                ann = state.annotation
                world = self.current_world_anchor(ann.id, ann.source)
                state.evidence = InvalidEvidence(
                    ann.object_id,
                    ann.local_anchor,
                    world,
                    self.object_path(ann.object_id),
                    reason,
                )
                state.valid = False

    def reparent_object(self, obj_id: str, new_parent_id: Optional[str]) -> None:
        if obj_id not in self.objects:
            raise ValidationError("改挂父对象被拒绝", [
                {"location": f"object[{obj_id}]", "reason": "待改挂对象不存在"}
            ])
        if new_parent_id is not None and new_parent_id not in self.objects:
            raise ValidationError("改挂父对象被拒绝", [
                {"location": f"object[{obj_id}].parent_id", "value": new_parent_id,
                 "reason": "新父对象不存在", "chain": self._relation_chains_for_missing((new_parent_id,))}
            ])
        if new_parent_id == obj_id:
            raise ValidationError("改挂父对象被拒绝", [
                {"location": f"object[{obj_id}].parent_id", "reason": "对象不能成为自己的父对象"}
            ])
        if new_parent_id is not None:
            descendants = set(self.subtree_ids(obj_id))
            if new_parent_id in descendants:
                raise ValidationError("改挂父对象被拒绝", [
                    {"location": f"object[{obj_id}].parent_id", "value": new_parent_id,
                     "reason": "不能改挂到自己的子对象，层级会成环",
                     "chain": self.object_path(new_parent_id) + [obj_id]}
                ])

        old_parent = self.objects[obj_id].parent_id
        self._freeze_annotations_for(
            [obj_id],
            f"对象 {obj_id} 的父对象由 {old_parent or '<根>'} 改挂为 {new_parent_id or '<根>'}；"
            "原世界锚点已冻结留证"
        )
        if old_parent is not None:
            self.children[old_parent].remove(obj_id)
        self.objects[obj_id].parent_id = new_parent_id
        self.children.setdefault(new_parent_id, []).append(obj_id)
        self._rebuild_world_matrices()

    def delete_object(self, obj_id: str) -> None:
        if obj_id not in self.objects:
            raise ValidationError("删除对象被拒绝", [
                {"location": f"object[{obj_id}]", "reason": "对象不存在"}
            ])
        subtree = self.subtree_ids(obj_id)
        self._freeze_annotations_for(
            subtree,
            f"对象 {obj_id} 及其子层级已删除；原局部/世界锚点已冻结留证"
        )
        old_parent = self.objects[obj_id].parent_id
        if old_parent is not None and obj_id in self.children.get(old_parent, []):
            self.children[old_parent].remove(obj_id)
        for removed_id in subtree:
            self.objects.pop(removed_id, None)
            self.object_order.remove(removed_id)
            self.children.pop(removed_id, None)
        self._rebuild_world_matrices()

    # ------------------------------------------------------------------
    # Annotations and conflicts
    # ------------------------------------------------------------------
    def add_annotation(
        self,
        ann_id: str,
        object_id: str,
        local_anchor: Sequence[float],
        body: str,
        source: str = "default",
    ) -> Annotation:
        issues: List[Dict[str, object]] = []
        if not isinstance(ann_id, str) or not ann_id.strip():
            issues.append({"location": "annotation.id", "reason": "标注标识必须是非空字符串"})
        if not isinstance(source, str) or not source.strip():
            issues.append({"location": f"annotation[{ann_id}].source",
                           "reason": "来源必须是非空字符串"})
        if object_id not in self.objects:
            issues.append({"location": f"annotation[{ann_id}].object_id", "value": object_id,
                           "reason": "标注所挂对象不存在"})
        if not isinstance(body, str) or not body.strip():
            issues.append({"location": f"annotation[{ann_id}].body", "reason": "正文不能为空"})
        anchor = _as_vec(local_anchor, f"annotation[{ann_id}].local_anchor")
        key = (ann_id, source)
        if key in self.annotations:
            issues.append({"location": f"annotation[{ann_id}].source[{source}]",
                           "reason": "同一来源重复给出同一标注标识"})
        if issues:
            raise ValidationError("新增标注被拒绝", issues)

        ann = Annotation(ann_id, object_id, anchor, body, source)
        self.annotations[key] = AnnotationState(ann)
        self._refresh_conflicts_for(ann_id)
        return ann

    def states_for_annotation(self, ann_id: str) -> List[AnnotationState]:
        return [state for (aid, _source), state in self.annotations.items() if aid == ann_id]

    def conflict_for(self, ann_id: str) -> Optional[ConflictRecord]:
        for conflict in self.conflicts:
            if conflict.annotation_id == ann_id:
                return conflict
        return None

    def _refresh_conflicts_for(self, ann_id: str) -> None:
        states = self.states_for_annotation(ann_id)
        self.conflicts = [c for c in self.conflicts if c.annotation_id != ann_id]
        if len(states) < 2:
            return
        fields = (
            ("object_id", "挂载对象", lambda a: a.object_id),
            ("local_anchor", "锚点位置", lambda a: tuple(a.local_anchor)),
            ("body", "正文", lambda a: a.body),
        )
        differing = []
        for field_name, label, getter in fields:
            values = [getter(s.annotation) for s in states]
            if len(set(values)) > 1:
                differing.append((label, getter))
        if not differing:
            return
        sources = [s.annotation.source for s in states]
        contents = [
            {"source": s.annotation.source,
             "object_id": s.annotation.object_id,
             "local_anchor": tuple(s.annotation.local_anchor),
             "body": s.annotation.body}
            for s in states
        ]
        details = []
        for label, getter in differing:
            details.append(
                f"{label}："
                + "、".join(f"{st.annotation.source}={getter(st.annotation)!r}" for st in states)
            )
        message = (
            f"标注 {ann_id} 存在互相矛盾的输入；冲突字段：{'；'.join(details)}。"
            "所有来源版本均已保留，未自动择一。"
        )
        self.conflicts.append(
            ConflictRecord(ann_id, ",".join(name for name, _g in differing), sources, contents, message)
        )

    def current_world_anchor(self, ann_id: str, source: str) -> Vec3:
        state = self.annotations.get((ann_id, source))
        if state is None:
            raise KeyError((ann_id, source))
        if not state.valid:
            assert state.evidence is not None
            return state.evidence.world_anchor
        ann = state.annotation
        return transform_point(self.world_matrix(ann.object_id), ann.local_anchor)

    def annotation_states(self) -> List[AnnotationState]:
        return list(self.annotations.values())

    # ------------------------------------------------------------------
    # Annotation references and attachments
    # ------------------------------------------------------------------
    def resolve_annotation_key(
        self,
        ann_id: str,
        source: Optional[str] = None,
        location: str = "annotation",
    ) -> Tuple[str, str]:
        keys = [(aid, src) for aid, src in self.annotations if aid == ann_id]
        if not keys:
            raise ValidationError("标注关系被拒绝", [
                {"location": location, "value": ann_id, "reason": "标注不存在",
                 "chain": ["<待声明>", ann_id, "<不存在>"]}
            ])
        if source is not None:
            key = (ann_id, source)
            if key not in self.annotations:
                raise ValidationError("标注关系被拒绝", [
                    {"location": location, "value": ann_id, "source": source,
                     "reason": "指定来源的标注不存在",
                     "available_sources": [k[1] for k in keys]}
                ])
            if not self.annotations[key].valid:
                raise ValidationError("标注关系被拒绝", [
                    {"location": location, "value": ann_id, "source": source,
                     "reason": "标注已失效，不能建立新关系",
                     "evidence": self.annotations[key].evidence.reason}
                ])
            return key
        if len(keys) > 1:
            raise ValidationError("标注关系被拒绝", [
                {"location": location, "value": ann_id,
                 "reason": "该标识有多个冲突版本，必须显式指定来源",
                 "available_sources": [k[1] for k in keys]}
            ])
        key = keys[0]
        if not self.annotations[key].valid:
            raise ValidationError("标注关系被拒绝", [
                {"location": location, "value": ann_id, "source": key[1],
                 "reason": "标注已失效，不能建立新关系",
                 "evidence": self.annotations[key].evidence.reason}
            ])
        return key

    def add_relation(
        self,
        from_id: str,
        to_id: str,
        kind: str = "reference",
        from_source: Optional[str] = None,
        to_source: Optional[str] = None,
    ) -> Relation:
        if kind not in ("reference", "attachment"):
            raise ValidationError("标注关系被拒绝", [
                {"location": f"relation[{from_id}->{to_id}].kind", "value": kind,
                 "reason": "关系类型只能是 reference 或 attachment"}
            ])
        from_key = self.resolve_annotation_key(from_id, from_source, "relation.from_annotation")
        try:
            to_key = self.resolve_annotation_key(to_id, to_source, "relation.to_annotation")
        except ValidationError as exc:
            for issue in exc.issues:
                issue["chain"] = [
                    f"{from_id}@{from_key[1]}",
                    f"{to_id}@{to_source or 'unspecified-source'}",
                    "<不存在>",
                ]
            raise
        if from_key == to_key:
            raise ValidationError("标注关系被拒绝", [
                {"location": f"relation[{from_id}->{to_id}]",
                 "reason": "标注不能引用或依附自身", "chain": [from_id, to_id]}
            ])
        relation = Relation(from_id, to_id, kind, from_key[1], to_key[1])
        duplicate = any(
            (r.from_annotation, r.from_source, r.to_annotation, r.to_source, r.kind)
            == (from_id, from_key[1], to_id, to_key[1], kind)
            for r in self.relations
        )
        if duplicate:
            return relation
        # The edge is legal unless its target can already reach its source.
        reverse_path = self._path_for_edge(to_key, from_key)
        chain = [from_key] + reverse_path if reverse_path else []
        if chain:
            readable = [f"{aid}@{src}" for aid, src in chain]
            raise ValidationError("标注关系被拒绝：关系不允许成环", [
                {"location": f"relation[{from_id}->{to_id}]", "reason": "新增边形成闭环",
                 "chain": readable}
            ])
        self.relations.append(relation)
        return relation

    def _adjacency(self) -> Dict[Tuple[str, str], List[Tuple[str, str]]]:
        graph: Dict[Tuple[str, str], List[Tuple[str, str]]] = {
            key: [] for key in self.annotations
        }
        for rel in self.relations:
            source = (rel.from_annotation, rel.from_source or "")
            target = (rel.to_annotation, rel.to_source or "")
            graph.setdefault(source, [])
            graph.setdefault(target, [])
            graph[source].append(target)
        return graph

    def _path_for_edge(
        self,
        from_key: Tuple[str, str],
        to_key: Tuple[str, str],
    ) -> List[Tuple[str, str]]:
        graph = self._adjacency()
        queue = [from_key]
        previous: Dict[Tuple[str, str], Optional[Tuple[str, str]]] = {from_key: None}
        while queue:
            current = queue.pop(0)
            if current == to_key:
                path: List[Tuple[str, str]] = []
                node: Optional[Tuple[str, str]] = current
                while node is not None:
                    path.append(node)
                    node = previous[node]
                return list(reversed(path))
            for nxt in graph.get(current, []):
                if nxt not in previous:
                    previous[nxt] = current
                    queue.append(nxt)
        return []

    def relation_chains_from(
        self,
        ann_id: str,
        source: Optional[str] = None,
    ) -> List[List[str]]:
        keys = [(aid, src) for aid, src in self.annotations if aid == ann_id]
        if source is not None:
            keys = [key for key in keys if key[1] == source]
        graph = self._adjacency()
        result: List[List[str]] = []

        def label(key: Tuple[str, str]) -> str:
            return f"{key[0]}@{key[1]}"

        def walk(key, path, seen):
            nxts = graph.get(key, [])
            if not nxts:
                result.append([label(k) for k in path])
            for nxt in nxts:
                if nxt in seen:
                    result.append([label(k) for k in path] + [label(nxt), "成环"])
                else:
                    walk(nxt, path + [nxt], seen | {nxt})

        for key in keys:
            walk(key, [key], {key})
        return result
