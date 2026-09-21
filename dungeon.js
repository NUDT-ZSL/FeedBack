/* dungeon.js - deterministic procedural dungeon generator + reachability analysis.
   Works in the browser (window.Dungeon) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dungeon = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TILE = { WALL: 0, FLOOR: 1, WATER: 2, LAVA: 3 };

  var DEFAULTS = {
    seed: 'demo-1',
    width: 60,
    height: 40,
    roomCount: 10,
    minRoomSize: 4,
    maxRoomSize: 9,
    extraCorridors: 3,
    waterRatio: 0.06,
    lavaRatio: 0.03,
    targetCount: 5
  };

  function hashSeed(str) {
    var h = 0x811c9dc5 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    var t = a >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    var rand = mulberry32(hashSeed(seed));
    return {
      next: rand,
      int: function (lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); },
      shuffle: function (arr) {
        for (var s = arr.length - 1; s > 0; s--) {
          var j = Math.floor(rand() * (s + 1));
          var tmp = arr[s]; arr[s] = arr[j]; arr[j] = tmp;
        }
        return arr;
      }
    };
  }

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  function validateParams(p) {
    var errors = [];
    if (!p.seed || String(p.seed).trim() === '') errors.push('种子不能为空');
    if (!isInt(p.width) || p.width < 24 || p.width > 160) errors.push('地图宽度必须是 24~160 的整数');
    if (!isInt(p.height) || p.height < 24 || p.height > 160) errors.push('地图高度必须是 24~160 的整数');
    if (!isInt(p.roomCount) || p.roomCount < 2 || p.roomCount > 60) errors.push('房间数量必须是 2~60 的整数');
    if (!isInt(p.minRoomSize) || p.minRoomSize < 3 || p.minRoomSize > 20) errors.push('最小房间尺寸必须是 3~20 的整数');
    if (!isInt(p.maxRoomSize) || p.maxRoomSize > 24) errors.push('最大房间尺寸不能超过 24');
    else if (isInt(p.minRoomSize) && p.maxRoomSize < p.minRoomSize) errors.push('最大房间尺寸不能小于最小房间尺寸');
    if (!isInt(p.extraCorridors) || p.extraCorridors < 0 || p.extraCorridors > 30) errors.push('额外走廊数必须是 0~30 的整数');
    if (typeof p.waterRatio !== 'number' || !(p.waterRatio >= 0 && p.waterRatio <= 0.5)) errors.push('水域比例必须在 0~0.5 之间');
    if (typeof p.lavaRatio !== 'number' || !(p.lavaRatio >= 0 && p.lavaRatio <= 0.5)) errors.push('岩浆比例必须在 0~0.5 之间');
    if (typeof p.waterRatio === 'number' && typeof p.lavaRatio === 'number' &&
        p.waterRatio >= 0 && p.lavaRatio >= 0 && p.waterRatio + p.lavaRatio > 0.8) {
      errors.push('水域与岩浆比例之和不能超过 0.8');
    }
    if (!isInt(p.targetCount) || p.targetCount < 1 || p.targetCount > 20) errors.push('目标点数量必须是 1~20 的整数');
    return errors;
  }
  function rectsOverlap(a, b, gap) {
    return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x &&
           a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
  }

  function placeRooms(rng, p) {
    var rooms = [];
    var attempts = 0;
    while (rooms.length < p.roomCount && attempts < 800) {
      attempts++;
      var w = rng.int(p.minRoomSize, p.maxRoomSize);
      var h = rng.int(p.minRoomSize, p.maxRoomSize);
      var x = rng.int(1, p.width - w - 1);
      var y = rng.int(1, p.height - h - 1);
      var room = { x: x, y: y, w: w, h: h, cx: x + (w >> 1), cy: y + (h >> 1) };
      var ok = true;
      for (var i = 0; i < rooms.length; i++) {
        if (rectsOverlap(room, rooms[i], 1)) { ok = false; break; }
      }
      if (ok) rooms.push(room);
    }
    if (rooms.length < p.roomCount) {
      var err = new Error('地图空间不足：只能放置 ' + rooms.length + '/' + p.roomCount +
        ' 个房间，请减少房间数量、缩小房间尺寸或扩大地图');
      err.validationErrors = [err.message];
      throw err;
    }
    return rooms;
  }

  function carveRoom(grid, width, room) {
    for (var y = room.y; y < room.y + room.h; y++) {
      for (var x = room.x; x < room.x + room.w; x++) grid[y * width + x] = TILE.FLOOR;
    }
  }

  function carveCorridor(grid, width, x1, y1, x2, y2, rng) {
    var x = x1, y = y1;
    function dig(cx, cy) { grid[cy * width + cx] = TILE.FLOOR; }
    if (rng.next() < 0.5) {
      while (x !== x2) { dig(x, y); x += x < x2 ? 1 : -1; }
      while (y !== y2) { dig(x, y); y += y < y2 ? 1 : -1; }
    } else {
      while (y !== y2) { dig(x, y); y += y < y2 ? 1 : -1; }
      while (x !== x2) { dig(x, y); x += x < x2 ? 1 : -1; }
    }
    dig(x2, y2);
  }

  function buildCorridors(rng, rooms, grid, width, extra) {
    var n = rooms.length;
    var inTree = [0];
    var outside = [];
    var i;
    for (i = 1; i < n; i++) outside.push(i);
    var corridors = [];
    while (outside.length) {
      var best = null, bestD = Infinity;
      for (var a = 0; a < inTree.length; a++) {
        for (var b = 0; b < outside.length; b++) {
          var r1 = rooms[inTree[a]], r2 = rooms[outside[b]];
          var d = Math.abs(r1.cx - r2.cx) + Math.abs(r1.cy - r2.cy);
          if (d < bestD) { bestD = d; best = [inTree[a], outside[b]]; }
        }
      }
      carveCorridor(grid, width, rooms[best[0]].cx, rooms[best[0]].cy,
        rooms[best[1]].cx, rooms[best[1]].cy, rng);
      corridors.push({ from: best[0], to: best[1], kind: 'mst' });
      inTree.push(best[1]);
      outside.splice(outside.indexOf(best[1]), 1);
    }
    for (var k = 0; k < extra; k++) {
      var i2 = rng.int(0, n - 1), j2 = rng.int(0, n - 1);
      if (i2 === j2) continue;
      carveCorridor(grid, width, rooms[i2].cx, rooms[i2].cy, rooms[j2].cx, rooms[j2].cy, rng);
      corridors.push({ from: i2, to: j2, kind: 'extra' });
    }
    return corridors;
  }
  function sprinkleTerrain(rng, grid, p, protectedTiles) {
    var floors = [];
    for (var i = 0; i < grid.length; i++) {
      if (grid[i] === TILE.FLOOR && !protectedTiles[i]) floors.push(i);
    }
    rng.shuffle(floors);
    var waterN = Math.round(floors.length * p.waterRatio);
    var lavaN = Math.round(floors.length * p.lavaRatio);
    var idx = 0, t;
    for (var a = 0; a < waterN && idx < floors.length; a++) grid[floors[idx++]] = TILE.WATER;
    for (var b = 0; b < lavaN && idx < floors.length; b++) grid[floors[idx++]] = TILE.LAVA;
    return { water: waterN, lava: lavaN, floorTotal: floors.length };
  }

  function bfs(grid, width, height, start, passable) {
    var seen = new Uint8Array(grid.length);
    var q = [start];
    seen[start] = 1;
    var dx = [1, -1, 0, 0], dy = [0, 0, 1, -1];
    while (q.length) {
      var cur = q.pop();
      var cx = cur % width, cy = (cur / width) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + dx[d], ny = cy + dy[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        var ni = ny * width + nx;
        if (seen[ni] || !passable(grid[ni])) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  }

  function analyze(grid, width, height, spawn, targets) {
    var start = spawn.y * width + spawn.x;
    var reach = bfs(grid, width, height, start, function (t) { return t === TILE.FLOOR; });
    var reachNoWater = bfs(grid, width, height, start, function (t) { return t === TILE.FLOOR || t === TILE.WATER; });
    var reachNoLava = bfs(grid, width, height, start, function (t) { return t === TILE.FLOOR || t === TILE.LAVA; });
    var reachAll = bfs(grid, width, height, start, function (t) { return t !== TILE.WALL; });
    var results = [];
    for (var i = 0; i < targets.length; i++) {
      var idx = targets[i].y * width + targets[i].x;
      var reachable = !!reach[idx];
      var blockedBy = null;
      if (!reachable) {
        if (reachNoWater[idx]) blockedBy = 'water';
        else if (reachNoLava[idx]) blockedBy = 'lava';
        else if (!reachAll[idx]) blockedBy = 'corridor';
        else blockedBy = 'terrain';
      }
      results.push({ id: i + 1, x: targets[i].x, y: targets[i].y, reachable: reachable, blockedBy: blockedBy });
    }
    return { reachableGrid: reach, targets: results };
  }

  function generate(params) {
    var p = {};
    var k;
    for (k in DEFAULTS) p[k] = DEFAULTS[k];
    if (params) for (k in params) if (params[k] !== undefined) p[k] = params[k];
    var errors = validateParams(p);
    if (errors.length) {
      var ve = new Error(errors.join('；'));
      ve.validationErrors = errors;
      throw ve;
    }
    var rng = makeRng(p.seed);
    var grid = new Uint8Array(p.width * p.height);
    var rooms = placeRooms(rng, p);
    for (var r = 0; r < rooms.length; r++) carveRoom(grid, p.width, rooms[r]);
    var corridors = buildCorridors(rng, rooms, grid, p.width, p.extraCorridors);
    var spawn = { x: rooms[0].cx, y: rooms[0].cy };
    var pool = rng.shuffle(rooms.slice(1));
    var targets = [];
    for (var i = 0; i < p.targetCount; i++) {
      var room = pool[i % pool.length];
      targets.push({ x: room.cx, y: room.cy });
    }
    var protectedTiles = {};
    protectedTiles[spawn.y * p.width + spawn.x] = 1;
    for (var t2 = 0; t2 < targets.length; t2++) {
      protectedTiles[targets[t2].y * p.width + targets[t2].x] = 1;
    }
    var terrain = sprinkleTerrain(rng, grid, p, protectedTiles);
    var analysis = analyze(grid, p.width, p.height, spawn, targets);
    var reachableCount = 0;
    for (var t3 = 0; t3 < analysis.targets.length; t3++) {
      if (analysis.targets[t3].reachable) reachableCount++;
    }
    return {
      params: p,
      grid: grid,
      width: p.width,
      height: p.height,
      rooms: rooms,
      corridors: corridors,
      spawn: spawn,
      targets: analysis.targets,
      reachableGrid: analysis.reachableGrid,
      stats: {
        seed: String(p.seed),
        roomCount: rooms.length,
        corridorCount: corridors.length,
        floorTiles: terrain.floorTotal,
        waterTiles: terrain.water,
        lavaTiles: terrain.lava,
        reachableTargets: reachableCount,
        totalTargets: targets.length,
        reachableRatio: targets.length ? reachableCount / targets.length : 0
      }
    };
  }

  return {
    TILE: TILE,
    DEFAULTS: DEFAULTS,
    validateParams: validateParams,
    generate: generate,
    hashSeed: hashSeed
  };
});
