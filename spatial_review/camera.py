"""Orbit camera, projection and visibility classification."""

from dataclasses import dataclass
from math import cos, pi, sin, sqrt
from typing import List, Optional, Tuple

from .geometry import (
    Point3, cross, dot, invert_affine, normalize, ray_box_intersection,
    subtract, transform_point, transform_vector,
)
from .model import Scene


@dataclass
class Camera:
    target: Point3 = (0.0, 0.0, 0.0)
    distance: float = 12.0
    yaw: float = 0.6
    pitch: float = 0.35
    fov_y_degrees: float = 55.0
    near: float = 0.05

    def eye(self) -> Point3:
        cp, sp = cos(self.pitch), sin(self.pitch)
        return (
            self.target[0] + self.distance * cp * sin(self.yaw),
            self.target[1] + self.distance * sp,
            self.target[2] + self.distance * cp * cos(self.yaw),
        )

    def frame(self) -> Tuple[Point3, Point3, Point3, Point3]:
        eye = self.eye()
        forward = normalize(subtract(self.target, eye))
        world_up = (0.0, 1.0, 0.0)
        if abs(dot(forward, world_up)) > 0.999:
            world_up = (0.0, 0.0, 1.0)
        right = normalize(cross(forward, world_up))
        up = cross(right, forward)
        return eye, forward, right, up

    def orbit(self, delta_yaw: float, delta_pitch: float) -> None:
        self.yaw += delta_yaw
        limit = pi / 2.0 - 0.01
        self.pitch = max(-limit, min(limit, self.pitch + delta_pitch))

    def pan(self, dx: float, dy: float) -> None:
        _eye, forward, right, up = self.frame()
        self.target = (
            self.target[0] - right[0] * dx - up[0] * dy,
            self.target[1] - right[1] * dx - up[1] * dy,
            self.target[2] - right[2] * dx - up[2] * dy,
        )

    def zoom(self, factor: float) -> None:
        self.distance = max(1.5, min(80.0, self.distance * factor))

    def project_point(self, point: Point3, width: int, height: int):
        eye, forward, right, up = self.frame()
        rel = subtract(point, eye)
        z = dot(rel, forward)
        if z <= self.near:
            return None
        focal = height / (2.0 * tan_half_fov(self.fov_y_degrees))
        sx = width / 2.0 + focal * dot(rel, right) / z
        sy = height / 2.0 - focal * dot(rel, up) / z
        return sx, sy, z

    def occlusion_blocker(
        self,
        scene: Scene,
        anchor: Point3,
        host_object_id: Optional[str],
    ) -> Optional[str]:
        eye = self.eye()
        direction = normalize(subtract(anchor, eye))
        for obj_id in scene.object_order:
            if obj_id == host_object_id:
                continue
            inv = invert_affine(scene.world_matrix(obj_id))
            local_origin = transform_point(inv, eye)
            local_dir = normalize(transform_vector(inv, direction))
            local_anchor = transform_point(inv, anchor)
            sx, sy, sz = scene.objects[obj_id].size
            t0, t1 = ray_box_intersection(
                local_origin, local_dir, (0.0, 0.0, 0.0), (sx, sy, sz)
            )
            anchor_distance = sqrt(
                (local_anchor[0] - local_origin[0]) ** 2
                + (local_anchor[1] - local_origin[1]) ** 2
                + (local_anchor[2] - local_origin[2]) ** 2
            )
            # The host itself must not count; a real blocker starts before it.
            if t1 > 1e-5 and t0 < anchor_distance - 1e-5:
                return obj_id
        return None


def tan_half_fov(degrees: float) -> float:
    radians = degrees * pi / 360.0
    return sin(radians) / cos(radians)


@dataclass
class ProjectedAnnotation:
    ann_id: str
    source: str
    body: str
    object_id: str
    world_anchor: Point3
    screen: Optional[Tuple[float, float]]
    visibility: str
    reason: str
    invalid: bool
    conflict: bool
    edge_marker: Optional[Tuple[float, float]] = None
    blocker: Optional[str] = None


def project_annotations(
    scene: Scene,
    camera: Camera,
    width: int,
    height: int,
) -> List[ProjectedAnnotation]:
    conflict_ids = {c.annotation_id for c in scene.conflicts}
    results: List[ProjectedAnnotation] = []
    for state in scene.annotation_states():
        ann = state.annotation
        world = scene.current_world_anchor(ann.id, ann.source)
        projected = camera.project_point(world, width, height)
        evidence_host = state.evidence.object_id if state.evidence else None
        host = ann.object_id if state.valid or evidence_host in scene.objects else None
        invalid = not state.valid
        invalid_reason = state.evidence.reason if invalid else ""

        if projected is None:
            visibility = "behind"
            reason = "锚点位于相机后方或近裁剪面之前"
            screen = None
            edge_marker = (width / 2.0, height / 2.0)
            blocker = None
        else:
            sx, sy, _z = projected
            screen = (sx, sy)
            margin = 8.0
            if not (margin <= sx <= width - margin and margin <= sy <= height - margin):
                visibility = "offscreen"
                reason = "锚点投影落在当前视窗外；边缘标记指示其方向"
                edge_marker = (
                    min(max(sx, margin), width - margin),
                    min(max(sy, margin), height - margin),
                )
                blocker = None
            else:
                blocker = camera.occlusion_blocker(scene, world, host)
                if blocker:
                    visibility = "occluded"
                    reason = f"锚点被对象 {blocker} 的包围盒遮挡"
                else:
                    visibility = "visible"
                    reason = "可见"
                edge_marker = None

        full_reason = reason
        if invalid_reason:
            full_reason = invalid_reason if reason == "可见" else invalid_reason + "；" + reason
        results.append(ProjectedAnnotation(
            ann.id, ann.source, ann.body, ann.object_id, world, screen,
            visibility, full_reason, invalid, ann.id in conflict_ids,
            edge_marker, blocker
        ))
    return results
