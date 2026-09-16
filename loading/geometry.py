"""3D 整数盒几何：重叠检测与候选放置点（extreme points）。"""

from collections import namedtuple

Box = namedtuple("Box", ["x", "y", "z", "dx", "dy", "dz"])


def overlap(a, b):
    """两个轴对齐盒是否在空间内相交（闭合边界上的贴合不算重叠）。"""
    return (
        a.x < b.x + b.dx
        and a.x + a.dx > b.x
        and a.y < b.y + b.dy
        and a.y + a.dy > b.y
        and a.z < b.z + b.dz
        and a.z + a.dz > b.z
    )


def collides_any(box, boxes):
    """box 是否与 boxes 中任意一个重叠。"""
    for other in boxes:
        if overlap(box, other):
            return True
    return False


def candidate_positions(occupied):
    """根据已放置盒生成候选坐标（extreme points）。

    无货物时只给出原点 (0,0,0)；否则取每个已放盒的
    (x+dx, y, z)、(x, y+dy, z)、(x, y, z+dz)，外加原点。
    坐标本身不做高度可行性过滤，由放置评分与可行性检查负责。
    """
    points = {(0, 0, 0)}
    for b in occupied:
        points.add((b.x + b.dx, b.y, b.z))
        points.add((b.x, b.y + b.dy, b.z))
        points.add((b.x, b.y, b.z + b.dz))
    return points
