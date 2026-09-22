"""Point cloud parsing + octree LOD construction (numpy only)."""
import os
import numpy as np

NODE_CAP = 30000      # max representative points stored per node
GRID = 64             # per-node sampling grid (spacing = node_size / GRID)
MAX_DEPTH = 12

_PLY_TYPES = {
    "char": ("i1", 1), "uchar": ("u1", 1), "int8": ("i1", 1), "uint8": ("u1", 1),
    "short": ("<i2", 2), "ushort": ("<u2", 2), "int16": ("<i2", 2), "uint16": ("<u2", 2),
    "int": ("<i4", 4), "uint": ("<u4", 4), "int32": ("<i4", 4), "uint32": ("<u4", 4),
    "float": ("<f4", 4), "float32": ("<f4", 4), "double": ("<f8", 8), "float64": ("<f8", 8),
}


def load_pointcloud(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".ply":
        pos, col = _load_ply(path)
    elif ext in (".xyz", ".txt", ".csv", ".pts", ".asc"):
        pos, col = _load_xyz(path)
    else:
        raise ValueError("unsupported format: %s (use .ply/.xyz/.txt/.csv/.pts)" % ext)
    pos = np.ascontiguousarray(pos, dtype=np.float32)
    if col is None:
        col = np.full((len(pos), 3), 200, dtype=np.uint8)
    col = np.ascontiguousarray(col, dtype=np.uint8)
    return pos, col


def _load_ply(path):
    with open(path, "rb") as f:
        magic = f.readline().strip()
        if magic != b"ply":
            raise ValueError("not a PLY file")
        fmt = None
        elements = []  # [name, count, [(pname, ptype, is_list)]]
        cur = None
        while True:
            line = f.readline()
            if not line:
                raise ValueError("unexpected EOF in PLY header")
            parts = line.split()
            if not parts:
                continue
            key = parts[0]
            if key == b"format":
                fmt = parts[1].decode()
            elif key == b"element":
                cur = [parts[1].decode(), int(parts[2]), []]
                elements.append(cur)
            elif key == b"property" and cur is not None:
                if parts[1] == b"list":
                    cur[2].append((parts[4].decode(), parts[3].decode(), True))
                else:
                    cur[2].append((parts[2].decode(), parts[1].decode(), False))
            elif key == b"end_header":
                break
        if fmt not in ("ascii", "binary_little_endian"):
            raise ValueError("unsupported PLY format: %s" % fmt)
        vname, vcount, vprops = elements[0]
        if vname != "vertex":
            raise ValueError("first PLY element must be 'vertex'")
        names = [p[0] for p in vprops if not p[2]]
        if fmt == "ascii":
            raw = f.read()
            if len(elements) == 1 and all(not p[2] for p in vprops):
                arr = np.fromstring(raw.decode("latin1"), sep=" ", dtype=np.float64)
                arr = arr[: vcount * len(names)].reshape(vcount, len(names))
            else:
                lines = raw.decode("latin1").splitlines()
                arr = np.loadtxt(lines[:vcount], dtype=np.float64, ndmin=2)
        else:
            if any(p[2] for p in vprops):
                raise ValueError("list properties in vertex element not supported")
            dt = np.dtype([(p[0], _PLY_TYPES[p[1]][0]) for p in vprops])
            rec = np.frombuffer(f.read(dt.itemsize * vcount), dtype=dt, count=vcount)
            arr = np.column_stack([rec[n] for n in names]).astype(np.float64)
    def col_of(*cands):
        for c in cands:
            if c in names:
                return arr[:, names.index(c)]
        return None
    x, y, z = col_of("x"), col_of("y"), col_of("z")
    if x is None or y is None or z is None:
        raise ValueError("PLY vertex element has no x/y/z")
    pos = np.column_stack([x, y, z])
    r = col_of("red", "r", "diffuse_red")
    g = col_of("green", "g", "diffuse_green")
    b = col_of("blue", "b", "diffuse_blue")
    col = None
    if r is not None and g is not None and b is not None:
        col = np.column_stack([r, g, b])
        if col.max() <= 1.0 + 1e-6:
            col = col * 255.0
        col = np.clip(col, 0, 255)
    return pos, col


def _load_xyz(path):
    with open(path, "rb") as f:
        raw = f.read()
    sep = "," if b"," in raw[:4096] else None
    lines = raw.decode("latin1").splitlines()
    try:
        arr = np.loadtxt(lines, delimiter=sep, dtype=np.float64, ndmin=2)
    except ValueError:  # header line etc.
        arr = np.loadtxt(lines, delimiter=sep, skiprows=1, dtype=np.float64, ndmin=2)
    if arr.shape[1] < 3:
        raise ValueError("need at least 3 columns (x y z)")
    pos = arr[:, :3]
    col = None
    if arr.shape[1] >= 6:
        col = arr[:, 3:6]
        if col.max() <= 1.0 + 1e-6:
            col = col * 255.0
        col = np.clip(col, 0, 255)
    return pos, col
class Node:
    __slots__ = ("id", "level", "bbox_min", "bbox_max", "pos", "col", "children")

    def __init__(self, nid, level, bmin, bmax):
        self.id = nid
        self.level = level
        self.bbox_min = bmin
        self.bbox_max = bmax
        self.pos = None          # (k,3) float32 representative points
        self.col = None          # (k,3) uint8
        self.children = []       # child node ids

    @property
    def count(self):
        return 0 if self.pos is None else len(self.pos)


class Dataset:
    """Octree LOD over a point cloud. Each point is stored at exactly one node;
    coarser nodes keep a grid-sampled subset, the rest is pushed to children."""

    def __init__(self, name, pos, col, node_cap=NODE_CAP, max_depth=MAX_DEPTH):
        self.name = name
        self.total_points = int(len(pos))
        self.node_cap = node_cap
        self.max_depth = max_depth
        lo = pos.min(axis=0)
        hi = pos.max(axis=0)
        center = (lo + hi) * 0.5
        size = float(max(hi - lo).max()) if len(pos) else 1.0
        size = max(size, 1e-6)
        self.root_min = center - size * 0.5
        self.root_max = center + size * 0.5
        self.root_size = size
        self.spacing0 = size / GRID          # sampling spacing at level 0
        self.nodes = {}
        self._build("r", 0, np.arange(len(pos)), self.root_min, self.root_max,
                    pos, col)

    def spacing(self, level):
        return self.spacing0 / (2 ** level)

    def _grid_keep(self, p, spacing):
        """Index of one representative point per grid cell."""
        keys = np.floor((p - self.root_min) / spacing).astype(np.int64)
        keys = np.clip(keys, 0, (1 << 20) - 1)
        packed = (keys[:, 0] << 40) | (keys[:, 1] << 20) | keys[:, 2]
        _, idx = np.unique(packed, return_index=True)
        return np.sort(idx)

    def _build(self, nid, level, idx, bmin, bmax, pos, col):
        node = Node(nid, level, bmin, bmax)
        self.nodes[nid] = node
        if len(idx) <= self.node_cap or level >= self.max_depth:
            node.pos = np.ascontiguousarray(pos[idx])
            node.col = np.ascontiguousarray(col[idx])
            return
        keep_local = self._grid_keep(pos[idx], self.spacing(level))
        if len(keep_local) > self.node_cap:
            rng = np.random.default_rng(1234)
            keep_local = np.sort(rng.choice(keep_local, self.node_cap, replace=False))
        keep_mask = np.zeros(len(idx), dtype=bool)
        keep_mask[keep_local] = True
        node.pos = np.ascontiguousarray(pos[idx[keep_mask]])
        node.col = np.ascontiguousarray(col[idx[keep_mask]])
        rest = idx[~keep_mask]
        if len(rest) == 0:
            return
        mid = (bmin + bmax) * 0.5
        p = pos[rest]
        code = ((p[:, 0] >= mid[0]).astype(np.int64)
                | ((p[:, 1] >= mid[1]).astype(np.int64) << 1)
                | ((p[:, 2] >= mid[2]).astype(np.int64) << 2))
        order = np.argsort(code, kind="stable")
        rest_sorted = rest[order]
        code_sorted = code[order]
        counts = np.bincount(code_sorted, minlength=8)
        offsets = np.concatenate([[0], np.cumsum(counts)])
        for c in range(8):
            s, e = int(offsets[c]), int(offsets[c + 1])
            if s == e:
                continue
            lo = bmin.copy()
            hi = bmax.copy()
            for axis in range(3):
                if (c >> axis) & 1:
                    lo[axis] = mid[axis]
                else:
                    hi[axis] = mid[axis]
            child_id = nid + str(c)
            node.children.append(child_id)
            self._build(child_id, level + 1, rest_sorted[s:e], lo, hi, pos, col)

    def meta(self):
        levels = {}
        for n in self.nodes.values():
            levels[str(n.level)] = levels.get(str(n.level), 0) + 1
        return {
            "name": self.name,
            "totalPoints": self.total_points,
            "nodeCount": len(self.nodes),
            "bboxMin": self.root_min.tolist(),
            "bboxMax": self.root_max.tolist(),
            "spacing0": self.spacing0,
            "maxDepth": self.max_depth,
            "levels": levels,
        }

    def node_payload(self, nid):
        """uint32 jsonLen | json header | xyz float32 | rgb uint8"""
        import json as _json
        n = self.nodes[nid]
        header = _json.dumps({
            "id": n.id, "level": n.level, "count": n.count,
            "bboxMin": n.bbox_min.tolist(), "bboxMax": n.bbox_max.tolist(),
            "children": n.children, "spacing": self.spacing(n.level),
        }).encode()
        # pad header so the float32 block starts at a 4-byte boundary
        pad = (-(4 + len(header))) % 4
        header += b" " * pad
        body = n.pos.tobytes() + n.col.tobytes()
        return len(header).to_bytes(4, "little") + header + body
