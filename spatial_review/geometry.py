"""Small dependency-free 3D geometry helpers.

Points are ordinary ``(x, y, z)`` tuples.  Matrices are row-major 4x4 tuples
of tuples and use the usual column-vector convention ``p_world = M @ p``.
"""

from math import cos, sin, sqrt
from typing import Sequence, Tuple


Point3 = Tuple[float, float, float]
Matrix4 = Tuple[Tuple[float, float, float, float], ...]


def identity() -> Matrix4:
    return (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )


def mat_mul(a: Matrix4, b: Matrix4) -> Matrix4:
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4))
        for i in range(4)
    )


def transform_point(m: Matrix4, p: Sequence[float]) -> Point3:
    x, y, z = p
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
        m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
        m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
    )


def transform_vector(m: Matrix4, v: Sequence[float]) -> Point3:
    x, y, z = v
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z,
        m[1][0] * x + m[1][1] * y + m[1][2] * z,
        m[2][0] * x + m[2][1] * y + m[2][2] * z,
    )


def _rotation_x(a: float) -> Matrix4:
    c, s = cos(a), sin(a)
    return (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, c, -s, 0.0),
        (0.0, s, c, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )


def _rotation_y(a: float) -> Matrix4:
    c, s = cos(a), sin(a)
    return (
        (c, 0.0, s, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (-s, 0.0, c, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )


def _rotation_z(a: float) -> Matrix4:
    c, s = cos(a), sin(a)
    return (
        (c, -s, 0.0, 0.0),
        (s, c, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )


def compose_matrix(
    translation: Sequence[float] = (0.0, 0.0, 0.0),
    rotation_xyz: Sequence[float] = (0.0, 0.0, 0.0),
    scale: Sequence[float] = (1.0, 1.0, 1.0),
) -> Matrix4:
    """Build T * Rz * Ry * Rx * S from translations, Euler radians and scale."""
    rx, ry, rz = rotation_xyz
    rotation = mat_mul(mat_mul(_rotation_z(rz), _rotation_y(ry)), _rotation_x(rx))
    sx, sy, sz = scale
    scaled = (
        (rotation[0][0] * sx, rotation[0][1] * sy, rotation[0][2] * sz, rotation[0][3]),
        (rotation[1][0] * sx, rotation[1][1] * sy, rotation[1][2] * sz, rotation[1][3]),
        (rotation[2][0] * sx, rotation[2][1] * sy, rotation[2][2] * sz, rotation[2][3]),
        rotation[3],
    )
    tx, ty, tz = translation
    return (
        (scaled[0][0], scaled[0][1], scaled[0][2], tx),
        (scaled[1][0], scaled[1][1], scaled[1][2], ty),
        (scaled[2][0], scaled[2][1], scaled[2][2], tz),
        scaled[3],
    )


def invert_affine(m: Matrix4) -> Matrix4:
    """Invert a non-singular affine 4x4 transformation."""
    a = [[m[i][j] for j in range(3)] for i in range(3)]
    b = [m[i][3] for i in range(3)]

    def det3(q):
        return (
            q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1])
            - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0])
            + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0])
        )

    def det2(q):
        return q[0][0] * q[1][1] - q[0][1] * q[1][0]

    d = det3(a)
    if abs(d) < 1e-12:
        raise ValueError("变换矩阵不可逆，通常是因为缩放为 0")
    inv = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            minor = [
                row[:j] + row[j + 1:]
                for row_index, row in enumerate(a)
                if row_index != i
            ]
            inv[j][i] = ((-1) ** (i + j)) * det2(minor) / d
    tb = [
        -(inv[0][0] * b[0] + inv[0][1] * b[1] + inv[0][2] * b[2]),
        -(inv[1][0] * b[0] + inv[1][1] * b[1] + inv[1][2] * b[2]),
        -(inv[2][0] * b[0] + inv[2][1] * b[1] + inv[2][2] * b[2]),
    ]
    return tuple(
        tuple(inv[i] + [tb[i]]) if i < 3 else (0.0, 0.0, 0.0, 1.0)
        for i in range(4)
    )


def subtract(a: Sequence[float], b: Sequence[float]) -> Point3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a: Sequence[float], b: Sequence[float]) -> Point3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def normalize(v: Sequence[float]) -> Point3:
    n = sqrt(dot(v, v))
    if n < 1e-12:
        raise ValueError("无法归一化零长度向量")
    return (v[0] / n, v[1] / n, v[2] / n)


def ray_box_intersection(
    origin: Point3,
    direction: Point3,
    bounds_min: Sequence[float],
    bounds_max: Sequence[float],
) -> Tuple[float, float]:
    """Slab intersection for an axis-aligned box in the supplied coordinates."""
    tmin, tmax = -1e300, 1e300
    for axis in range(3):
        if abs(direction[axis]) < 1e-12:
            if origin[axis] < bounds_min[axis] or origin[axis] > bounds_max[axis]:
                return (float("inf"), float("inf"))
            continue
        t1 = (bounds_min[axis] - origin[axis]) / direction[axis]
        t2 = (bounds_max[axis] - origin[axis]) / direction[axis]
        if t1 > t2:
            t1, t2 = t2, t1
        tmin = max(tmin, t1)
        tmax = min(tmax, t2)
        if tmin > tmax:
            return (float("inf"), float("inf"))
    return (tmin, tmax)
