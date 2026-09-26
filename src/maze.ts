export interface WallData {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  isVertical: boolean;
}

export interface GemData {
  x: number;
  z: number;
  color: string;
  noteIndex: number;
}

export interface MazeData {
  walls: WallData[];
  gems: GemData[];
  gridSize: number;
  cellSize: number;
  startX: number;
  startZ: number;
  exitX: number;
  exitZ: number;
}

interface Cell {
  x: number;
  z: number;
  walls: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  visited: boolean;
}

const GEM_COLORS = [
  '#ff4757',
  '#ffa502',
  '#ffd32a',
  '#2ed573',
  '#1e90ff',
  '#a55eea'
];

const GEM_NOTES = [0, 1, 2, 3, 4, 5];

export function generateMaze(gridSize: number = 5, cellSize: number = 4): MazeData {
  const cells: Cell[][] = [];

  for (let z = 0; z < gridSize; z++) {
    cells[z] = [];
    for (let x = 0; x < gridSize; x++) {
      cells[z][x] = {
        x,
        z,
        walls: { top: true, right: true, bottom: true, left: true },
        visited: false
      };
    }
  }

  const stack: Cell[] = [];
  const startCell = cells[0][0];
  startCell.visited = true;
  stack.push(startCell);

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = getUnvisitedNeighbors(cells, current, gridSize);

    if (neighbors.length === 0) {
      stack.pop();
    } else {
      const next = neighbors[Math.floor(Math.random() * neighbors.length)];
      removeWall(current, next);
      next.visited = true;
      stack.push(next);
    }
  }

  const walls: WallData[] = [];
  const wallHeight = 3;
  const wallThickness = 1;
  const halfCell = cellSize / 2;
  const offsetX = -(gridSize * cellSize) / 2;
  const offsetZ = -(gridSize * cellSize) / 2;

  for (let z = 0; z < gridSize; z++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = cells[z][x];
      const cx = offsetX + x * cellSize + halfCell;
      const cz = offsetZ + z * cellSize + halfCell;

      if (cell.walls.top) {
        walls.push({
          x: cx,
          y: wallHeight / 2,
          z: cz - halfCell,
          width: cellSize + wallThickness,
          height: wallHeight,
          depth: wallThickness,
          isVertical: false
        });
      }

      if (cell.walls.bottom) {
        walls.push({
          x: cx,
          y: wallHeight / 2,
          z: cz + halfCell,
          width: cellSize + wallThickness,
          height: wallHeight,
          depth: wallThickness,
          isVertical: false
        });
      }

      if (cell.walls.left) {
        walls.push({
          x: cx - halfCell,
          y: wallHeight / 2,
          z: cz,
          width: wallThickness,
          height: wallHeight,
          depth: cellSize + wallThickness,
          isVertical: true
        });
      }

      if (cell.walls.right) {
        walls.push({
          x: cx + halfCell,
          y: wallHeight / 2,
          z: cz,
          width: wallThickness,
          height: wallHeight,
          depth: cellSize + wallThickness,
          isVertical: true
        });
      }
    }
  }

  const gems: GemData[] = [];
  const gemPositions = selectGemPositions(cells, gridSize);
  
  gemPositions.forEach((pos, index) => {
    const gx = offsetX + pos.x * cellSize + halfCell;
    const gz = offsetZ + pos.z * cellSize + halfCell;
    gems.push({
      x: gx,
      z: gz,
      color: GEM_COLORS[index % GEM_COLORS.length],
      noteIndex: GEM_NOTES[index % GEM_NOTES.length]
    });
  });

  const startX = offsetX + halfCell;
  const startZ = offsetZ + halfCell;
  const exitX = offsetX + (gridSize - 1) * cellSize + halfCell;
  const exitZ = offsetZ + (gridSize - 1) * cellSize + halfCell;

  return {
    walls,
    gems,
    gridSize,
    cellSize,
    startX,
    startZ,
    exitX,
    exitZ
  };
}

function getUnvisitedNeighbors(cells: Cell[][], cell: Cell, gridSize: number): Cell[] {
  const neighbors: Cell[] = [];
  const { x, z } = cell;

  if (z > 0 && !cells[z - 1][x].visited) neighbors.push(cells[z - 1][x]);
  if (z < gridSize - 1 && !cells[z + 1][x].visited) neighbors.push(cells[z + 1][x]);
  if (x > 0 && !cells[z][x - 1].visited) neighbors.push(cells[z][x - 1]);
  if (x < gridSize - 1 && !cells[z][x + 1].visited) neighbors.push(cells[z][x + 1]);

  return neighbors;
}

function removeWall(current: Cell, next: Cell): void {
  const dx = next.x - current.x;
  const dz = next.z - current.z;

  if (dx === 1) {
    current.walls.right = false;
    next.walls.left = false;
  } else if (dx === -1) {
    current.walls.left = false;
    next.walls.right = false;
  } else if (dz === 1) {
    current.walls.bottom = false;
    next.walls.top = false;
  } else if (dz === -1) {
    current.walls.top = false;
    next.walls.bottom = false;
  }
}

function selectGemPositions(cells: Cell[][], gridSize: number): { x: number; z: number }[] {
  const positions: { x: number; z: number }[] = [];
  const totalCells = gridSize * gridSize;
  const gemCount = 6;

  const allPositions: { x: number; z: number }[] = [];
  for (let z = 0; z < gridSize; z++) {
    for (let x = 0; x < gridSize; x++) {
      if (!(x === 0 && z === 0) && !(x === gridSize - 1 && z === gridSize - 1)) {
        allPositions.push({ x, z });
      }
    }
  }

  for (let i = allPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allPositions[i], allPositions[j]] = [allPositions[j], allPositions[i]];
  }

  for (let i = 0; i < Math.min(gemCount, allPositions.length); i++) {
    positions.push(allPositions[i]);
  }

  return positions;
}
