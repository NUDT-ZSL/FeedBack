"""A* 寻路与视线（LOS）判定。"""
import heapq


def neighbors(state, x, y):
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if state.walkable(nx, ny):
            yield nx, ny


def find_path(state, start, goal, max_len=99):
    """返回从 start 到 goal 的路径（含 goal，不含 start），不可达返回 None。"""
    if start == goal:
        return []
    frontier = [(0, start)]
    came = {start: None}
    cost = {start: 0}
    while frontier:
        _, cur = heapq.heappop(frontier)
        if cur == goal:
            path = []
            while cur != start:
                path.append(cur)
                cur = came[cur]
            path.reverse()
            return path if len(path) <= max_len else None
        for nxt in neighbors(state, *cur):
            nc = cost[cur] + 1
            if nxt not in cost or nc < cost[nxt]:
                cost[nxt] = nc
                came[nxt] = cur
                h = abs(nxt[0] - goal[0]) + abs(nxt[1] - goal[1])
                heapq.heappush(frontier, (nc + h, nxt))
    return None


def reachable_tiles(state, start, max_steps):
    """BFS：返回 {pos: dist}，用于生成移动候选。"""
    seen = {start: 0}
    queue = [start]
    while queue:
        cur = queue.pop(0)
        if seen[cur] >= max_steps:
            continue
        for nxt in neighbors(state, *cur):
            if nxt not in seen:
                seen[nxt] = seen[cur] + 1
                queue.append(nxt)
    return seen


def has_los(state, a, b):
    """Bresenham 直线视线，墙体阻挡。"""
    x0, y0 = a
    x1, y1 = b
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    x, y = x0, y0
    while (x, y) != (x1, y1):
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x += sx
        if e2 < dx:
            err += dx
            y += sy
        if (x, y) != (x1, y1) and state.tile(x, y) == 1:  # T_WALL
            return False
    return True


def dist(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

