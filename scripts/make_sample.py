"""Generate a sample colored point cloud (terrain + buildings + trees), ~1.5M points."""
import os
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "data", "sample.ply")


def main(n_terrain=1_100_000, n_build=300_000, n_tree=200_000):
    rng = np.random.default_rng(7)
    # terrain: 600x600 m, gentle hills
    x = rng.uniform(-300, 300, n_terrain)
    y = rng.uniform(-300, 300, n_terrain)
    z = (18 * np.sin(x / 55.0) * np.cos(y / 70.0)
         + 6 * np.sin(x / 13.0 + y / 21.0)
         + rng.normal(0, 0.25, n_terrain))
    g = np.clip(0.45 + z / 120.0 + rng.normal(0, 0.05, n_terrain), 0, 1)
    ct = np.column_stack([0.35 * g + 0.15, 0.55 * g + 0.2, 0.25 * g + 0.1])
    pt = np.column_stack([x, y, z])
    # buildings: boxes on the terrain
    pb, cb = [], []
    for _ in range(40):
        cx, cy = rng.uniform(-260, 260, 2)
        w, d, h = rng.uniform(8, 30, 2).tolist() + [rng.uniform(8, 60)]
        n = n_build // 40
        face = rng.integers(0, 5, n)
        u = rng.uniform(-0.5, 0.5, n)
        v = rng.uniform(-0.5, 0.5, n)
        bx = np.where(face < 2, u * w, np.where(face < 4, (face - 2.5) * w, u * w))
        by = np.where(face < 2, (face - 0.5) * d, np.where(face < 4, v * d, v * d))
        bz = np.where(face < 4, v * h + h / 2, h)
        bx = np.where(face == 4, u * w, bx)
        shade = rng.uniform(0.5, 0.9)
        col = np.tile(np.array([shade, shade * 0.95, shade * 0.9]), (n, 1))
        pb.append(np.column_stack([cx + bx, cy + by, bz]))
        cb.append(col)
    # trees: cones of green points
    ptr, ctr = [], []
    for _ in range(300):
        cx, cy = rng.uniform(-290, 290, 2)
        h = rng.uniform(4, 12)
        n = n_tree // 300
        r = rng.uniform(1.5, 3.5)
        t = rng.uniform(0, 1, n)
        ang = rng.uniform(0, 2 * np.pi, n)
        rr = r * (1 - t)
        px = cx + rr * np.cos(ang)
        py = cy + rr * np.sin(ang)
        pz = t * h + 1.5
        green = np.column_stack([
            np.full(n, 0.15), rng.uniform(0.35, 0.6, n), np.full(n, 0.12)])
        ptr.append(np.column_stack([px, py, pz]))
        ctr.append(green)
    pos = np.vstack([pt] + pb + ptr).astype(np.float32)
    col = (np.clip(np.vstack([ct] + cb + ctr), 0, 1) * 255).astype(np.uint8)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        "element vertex %d\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        "end_header\n" % len(pos)
    ).encode()
    inter = np.empty((len(pos), 6), dtype=np.float32)
    inter[:, :3] = pos
    inter[:, 3:] = col.astype(np.float32)
    dt = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                   ("red", "u1"), ("green", "u1"), ("blue", "u1")])
    rec = np.empty(len(pos), dtype=dt)
    rec["x"], rec["y"], rec["z"] = pos[:, 0], pos[:, 1], pos[:, 2]
    rec["red"], rec["green"], rec["blue"] = col[:, 0], col[:, 1], col[:, 2]
    with open(OUT, "wb") as f:
        f.write(header)
        f.write(rec.tobytes())
    print("wrote %s: %d points (%.1f MB)"
          % (OUT, len(pos), os.path.getsize(OUT) / 1e6))


if __name__ == "__main__":
    main()
