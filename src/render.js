import { TILE } from "./dungeon.js";

export const TILE_COLORS = Object.freeze({
  [TILE.WALL]: "#111827",
  [TILE.FLOOR]: "#d6c7a8",
  [TILE.GRASS]: "#7abf6a",
  [TILE.WATER]: "#3b82f6",
  [TILE.SPAWN]: "#f8fafc",
  [TILE.TARGET]: "#facc15",
});

export function clearMap(canvas) {
  const ctx = canvas.getContext("2d");
  canvas.width = 960;
  canvas.height = 600;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("参数不合法，地图已清空", canvas.width / 2, canvas.height / 2);
}

export function renderDungeon(canvas, dungeon) {
  const padding = 16;
  const cell = Math.max(
    3,
    Math.floor(Math.min(
      (canvas.clientWidth - padding * 2) / dungeon.width,
      (620 - padding * 2) / dungeon.height
    ))
  );
  canvas.width = dungeon.width * cell + padding * 2;
  canvas.height = dungeon.height * cell + padding * 2;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < dungeon.height; y++) {
    for (let x = 0; x < dungeon.width; x++) {
      ctx.fillStyle = TILE_COLORS[dungeon.tiles[y][x]];
      ctx.fillRect(padding + x * cell, padding + y * cell, cell, cell);
    }
  }

  ctx.fillStyle = "rgba(239, 68, 68, 0.62)";
  for (const { x, y } of dungeon.unreachableTiles) {
    ctx.fillRect(padding + x * cell, padding + y * cell, cell, cell);
  }

  const drawMarker = ({ x, y }, color, label) => {
    const cx = padding + x * cell + cell / 2;
    const cy = padding + y * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(4, cell * 0.42), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#111827";
    ctx.stroke();
    if (cell >= 10) {
      ctx.fillStyle = "#111827";
      ctx.font = `${Math.max(9, cell * 0.52)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy + 0.5);
    }
  };
  drawMarker(dungeon.spawn, "#22c55e", "S");
  dungeon.targets.forEach((target) => {
    drawMarker(target, target.reachable ? "#facc15" : "#ef4444", target.id.slice(1));
  });
}
