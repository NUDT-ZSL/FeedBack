import { hashSeed, mulberry32, randInt } from "./rng.js";

export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  GRASS: 2,
  WATER: 3,
  SPAWN: 4,
  TARGET: 5,
});

export const WALKABLE_TILES = new Set([
  TILE.FLOOR,
  TILE.GRASS,
  TILE.SPAWN,
  TILE.TARGET,
]);

export const PARAM_LIMITS = Object.freeze({
  width: { min: 12, max: 80 },
  height: { min: 12, max: 60 },
  roomCount: { min: 2, max: 40 },
  minRoomSize: { min: 3, max: 10 },
  maxRoomSize: { min: 3, max: 12 },
  corridorWidth: { min: 1, max: 3 },
  targetCount: { min: 1, max: 39 },
});

function intIssue(name, value, { min, max }) {
  if (!Number.isInteger(value)) return `${name}必须是整数`;
  if (value < min || value > max) return `${name}必须在 ${min} 到 ${max} 之间`;
  return null;
}

export function normalizeParameters(input = {}) {
  const fieldNames = {
    width: "地图宽度",
    height: "地图高度",
    roomCount: "房间数量",
    minRoomSize: "房间最小边长",
    maxRoomSize: "房间最大边长",
    corridorWidth: "走廊宽度",
    targetCount: "目标数量",
  };
  const p = {
    width: Number(input.width),
    height: Number(input.height),
    roomCount: Number(input.roomCount),
    minRoomSize: Number(input.minRoomSize),
    maxRoomSize: Number(input.maxRoomSize),
    corridorWidth: Number(input.corridorWidth),
    targetCount: Number(input.targetCount),
    floorPercent: Number(input.floorPercent),
    grassPercent: Number(input.grassPercent),
    waterPercent: Number(input.waterPercent),
    ensureReachable: input.ensureReachable !== false,
  };
  const errors = [];
  for (const [name, limit] of Object.entries(PARAM_LIMITS)) {
    const issue = intIssue(name, p[name], limit);
    if (issue) errors.push(issue.replace(name, fieldNames[name]));
  }
  const terrainNames = { floorPercent: "地面占比", grassPercent: "草地占比", waterPercent: "水域占比" };
  for (const name of Object.keys(terrainNames)) {
    if (!Number.isFinite(p[name]) || p[name] < 0 || p[name] > 100) {
      errors.push(`${terrainNames[name]}必须是 0 到 100 之间的数字`);
    }
  }
  if (!errors.some((e) => e.includes("房间最小边长") || e.includes("房间最大边长"))
      && p.minRoomSize > p.maxRoomSize) {
    errors.push("房间最小边长不能大于房间最大边长");
  }
  const terrainSum = p.floorPercent + p.grassPercent + p.waterPercent;
  if (Number.isFinite(terrainSum) && Math.round(terrainSum) !== 100) {
    errors.push(`地形占比之和必须为 100%（当前为 ${Math.round(terrainSum)}%）`);
  }
  if (p.waterPercent > 49) errors.push("水域占比不能超过 49%，否则出生点可能被完全淹没");
  if (p.targetCount >= p.roomCount) errors.push("目标数量必须少于房间数量（出生房间不能放目标）");
  if (errors.length) {
    const err = new Error("参数不合法，未生成地图：\n- " + errors.join("\n- "));
    err.name = "ValidationError";
    err.errors = errors;
    throw err;
  }
  return p;
}

function makeGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(TILE.WALL));
}

function rectsOverlapWithMargin(a, b, margin = 1) {
  return a.x - margin < b.x + b.width
    && a.x + a.width + margin > b.x
    && a.y - margin < b.y + b.height
    && a.y + a.height + margin > b.y;
}

function carveRect(tiles, room, value) {
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) tiles[y][x] = value;
  }
}

function carveCorridor(tiles, a, b, corridorWidth, width, height) {
  const path = [];
  const mark = (x, y) => {
    const begin = -Math.floor(corridorWidth / 2);
    const end = corridorWidth + begin;
    for (let dy = begin; dy < end; dy++) {
      for (let dx = begin; dx < end; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          if (tiles[ny][nx] !== TILE.FLOOR) {
            tiles[ny][nx] = TILE.FLOOR;
            path.push({ x: nx, y: ny });
          }
        }
      }
    }
  };
  let x = a.x;
  let y = a.y;
  mark(x, y);
  while (x !== b.x) {
    x += Math.sign(b.x - x);
    mark(x, y);
  }
  while (y !== b.y) {
    y += Math.sign(b.y - y);
    mark(x, y);
  }
  return path;
}

function generateRooms(p, rng) {
  const rooms = [];
  const pitch = p.minRoomSize + 1;
  const packingCapacity = Math.floor((p.width - 2) / pitch) * Math.floor((p.height - 2) / pitch);
  if (packingCapacity < p.roomCount) {
    const err = new Error(
      `地图尺寸约束被破坏：当前尺寸最多容纳 ${packingCapacity} 个最小房间，无法满足 ${p.roomCount} 个房间。`
    );
    err.name = "GenerationConstraintError";
    err.errors = [err.message];
    throw err;
  }
  for (let attempt = 0; attempt < 5000 && rooms.length < p.roomCount; attempt++) {
    const w = randInt(rng, p.minRoomSize, p.maxRoomSize);
    const h = randInt(rng, p.minRoomSize, p.maxRoomSize);
    const x = randInt(rng, 1, p.width - w - 2);
    const y = randInt(rng, 1, p.height - h - 2);
    const room = { x, y, width: w, height: h, cx: x + (w >> 1), cy: y + (h >> 1) };
    if (rooms.every((other) => !rectsOverlapWithMargin(room, other))) rooms.push(room);
  }
  // Dense maps need a deterministic packing fallback. Using the minimum legal
  // room size still satisfies the requested count and size range.
  if (rooms.length < p.roomCount) {
    const fallbackRooms = [];
    for (let y = 1; y + p.minRoomSize <= p.height - 2 && fallbackRooms.length < p.roomCount; y += pitch) {
      for (let x = 1; x + p.minRoomSize <= p.width - 2 && fallbackRooms.length < p.roomCount; x += pitch) {
        const room = {
          x,
          y,
          width: p.minRoomSize,
          height: p.minRoomSize,
          cx: x + (p.minRoomSize >> 1),
          cy: y + (p.minRoomSize >> 1),
        };
        fallbackRooms.push(room);
      }
    }
    if (fallbackRooms.length === p.roomCount) {
      rooms.length = 0;
      rooms.push(...fallbackRooms);
    }
  }
  if (rooms.length !== p.roomCount) {
    const err = new Error(
      `地图尺寸约束被破坏：只能放置 ${rooms.length}/${p.roomCount} 个房间，请增大地图或减小房间数量/边长。`
    );
    err.name = "GenerationConstraintError";
    err.errors = [err.message];
    throw err;
  }
  return rooms;
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function distributeTerrain(tiles, rooms, p, rng) {
  let openCount = 0;
  for (const row of tiles) for (const v of row) if (v !== TILE.WALL) openCount++;
  const quotas = [
    { type: TILE.FLOOR, exact: openCount * p.floorPercent / 100 },
    { type: TILE.GRASS, exact: openCount * p.grassPercent / 100 },
    { type: TILE.WATER, exact: openCount * p.waterPercent / 100 },
  ];
  let assigned = 0;
  for (const quota of quotas) {
    quota.count = Math.floor(quota.exact);
    assigned += quota.count;
  }
  const remainderOrder = quotas
    .map((quota) => ({ quota, fraction: quota.exact - quota.count, tie: rng() }))
    .sort((a, b) => b.fraction - a.fraction || a.tie - b.tie);
  for (let i = 0; i < openCount - assigned; i++) {
    remainderOrder[i % remainderOrder.length].quota.count++;
  }
  const counts = Object.fromEntries(quotas.map((q) => [q.type, q.count]));
  const waterCount = counts[TILE.WATER];
  const grassCount = counts[TILE.GRASS];
  const waterCandidates = [];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      const isBoundary = y === room.y || y === room.y + room.height - 1;
      for (let x = room.x; x < room.x + room.width; x++) {
        const onRoomEdge = isBoundary || x === room.x || x === room.x + room.width - 1;
        if (tiles[y][x] !== TILE.WALL
          && tiles[y][x] !== TILE.SPAWN
          && tiles[y][x] !== TILE.TARGET
          && !onRoomEdge) {
          waterCandidates.push({ x, y });
        }
      }
    }
  }
  if (waterCount > waterCandidates.length) {
    const err = new Error("地形分布约束被破坏：当前房间内部面积不足以按给定比例放置水域；请降低水域占比或增大房间。");
    err.name = "GenerationConstraintError";
    err.errors = [err.message];
    throw err;
  }
  shuffle(rng, waterCandidates);
  for (let i = 0; i < waterCount; i++) {
    const { x, y } = waterCandidates[i];
    tiles[y][x] = TILE.WATER;
  }
  const grassCandidates = [];
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[y].length; x++) {
      if (tiles[y][x] === TILE.FLOOR) grassCandidates.push({ x, y });
    }
  }
  if (grassCount > grassCandidates.length) {
    const err = new Error("地形分布约束被破坏：开放区域不足以按给定比例放置草地。");
    err.name = "GenerationConstraintError";
    err.errors = [err.message];
    throw err;
  }
  shuffle(rng, grassCandidates);
  for (let i = 0; i < grassCount; i++) {
    const { x, y } = grassCandidates[i];
    tiles[y][x] = TILE.GRASS;
  }
  return {
    openCount,
    waterCount,
    grassCount,
    floorCount: openCount - waterCount - grassCount,
  };
}

export function analyzeAccessibility(tiles, spawn, targets) {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const reachable = Array.from({ length: height }, () => Array(width).fill(false));
  const queue = [spawn];
  reachable[spawn.y][spawn.x] = true;
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || reachable[ny][nx]) continue;
      if (!WALKABLE_TILES.has(tiles[ny][nx])) continue;
      reachable[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  const isReachable = (pos) => reachable[pos.y]?.[pos.x] === true;
  const targetResults = targets.map((target, index) => ({
    ...target,
    id: target.id ?? `T${index + 1}`,
    reachable: isReachable(target),
  }));
  const unreachableTiles = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (WALKABLE_TILES.has(tiles[y][x]) && !reachable[y][x]) {
        unreachableTiles.push({ x, y });
      }
    }
  }
  return {
    reachable,
    reachableCount: queue.length,
    unreachableTiles,
    targets: targetResults,
    reachableTargetCount: targetResults.filter((t) => t.reachable).length,
  };
}

function connectRooms(tiles, rooms, corridorWidth, width, height) {
  const corridors = [];
  const corridorCells = [];
  for (let i = 1; i < rooms.length; i++) {
    let best = 0;
    let bestDistance = Infinity;
    for (let j = 0; j < i; j++) {
      const distance = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = j;
      }
    }
    const from = { x: rooms[best].cx, y: rooms[best].cy };
    const to = { x: rooms[i].cx, y: rooms[i].cy };
    const path = carveCorridor(tiles, from, to, corridorWidth, width, height);
    corridorCells.push(...path);
    corridors.push({ from, to, roomA: best, roomB: i, path });
  }
  return { corridors, corridorCells };
}

export function generateDungeon(rawParams) {
  const params = normalizeParameters(rawParams);
  const originalSeed = rawParams.seed === undefined || rawParams.seed === null ? "" : String(rawParams.seed);
  const numericSeed = hashSeed(originalSeed);
  const rng = mulberry32(numericSeed);
  const rooms = generateRooms(params, rng);
  const baseTiles = makeGrid(params.width, params.height);
  for (const room of rooms) carveRect(baseTiles, room, TILE.FLOOR);
  const { corridors } = connectRooms(baseTiles, rooms, params.corridorWidth, params.width, params.height);
  const spawn = { x: rooms[0].cx, y: rooms[0].cy };
  let result = null;
  const attempts = params.ensureReachable ? 30 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const attemptRng = mulberry32((numericSeed + attempt * 0x9e3779b9) >>> 0);
    const tiles = baseTiles.map((row) => row.slice());
    tiles[spawn.y][spawn.x] = TILE.SPAWN;
    const targetRooms = shuffle(attemptRng, rooms.slice(1)).slice(0, params.targetCount);
    const targets = targetRooms.map((room, index) => {
      const target = {
        id: `T${index + 1}`,
        x: randInt(attemptRng, room.x, room.x + room.width - 1),
        y: randInt(attemptRng, room.y, room.y + room.height - 1),
      };
      tiles[target.y][target.x] = TILE.TARGET;
      return target;
    });
    const terrain = distributeTerrain(tiles, rooms, params, attemptRng);
    const accessibility = analyzeAccessibility(tiles, spawn, targets);
    result = { tiles, targets, terrain, accessibility };
    if (!params.ensureReachable || accessibility.reachableTargetCount === targets.length) break;
  }
  const { tiles, targets, terrain, accessibility } = result;
  if (params.ensureReachable && accessibility.reachableTargetCount < targets.length) {
    const err = new Error(
      `可达性约束被破坏：${attempts} 次确定性尝试后仍有 ${targets.length - accessibility.reachableTargetCount} 个目标不可达。请降低水域占比，或关闭“强制目标可达”查看阻断区域。`
    );
    err.name = "GenerationConstraintError";
    err.errors = [err.message];
    throw err;
  }
  const violations = [];
  if (accessibility.reachableTargetCount < targets.length) {
    violations.push(
      `可达性约束被破坏：${targets.length - accessibility.reachableTargetCount} 个目标被水域或墙体阻断。`
    );
  }

  return {
    seed: originalSeed,
    numericSeed,
    parameters: params,
    width: params.width,
    height: params.height,
    tiles,
    rooms,
    corridors,
    spawn,
    targets: accessibility.targets,
    reachable: accessibility.reachable,
    unreachableTiles: accessibility.unreachableTiles,
    reachableTargetCount: accessibility.reachableTargetCount,
    violations,
    summary: {
      roomCount: rooms.length,
      corridorCount: corridors.length,
      targetCount: targets.length,
      reachableTargetCount: accessibility.reachableTargetCount,
      reachableTargetRatio: `${accessibility.reachableTargetCount}/${targets.length}`,
      seed: originalSeed,
      numericSeed,
      terrain: {
        ...terrain,
        floorPercent: Math.round(terrain.floorCount * 1000 / terrain.openCount) / 10,
        grassPercent: Math.round(terrain.grassCount * 1000 / terrain.openCount) / 10,
        waterPercent: Math.round(terrain.waterCount * 1000 / terrain.openCount) / 10,
      },
    },
  };
}
