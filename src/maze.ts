import { MazeCellType, Position, Treasure, Trap } from './types';

const MAZE_SIZE = 10;
const TREASURE_COUNT = 5;
const TRAP_COUNT = 3;

interface WFCCell {
  possible: boolean[];
  entropy: number;
  collapsed: boolean;
}

function createWFCCell(numStates: number): WFCCell {
  return {
    possible: new Array(numStates).fill(true),
    entropy: numStates,
    collapsed: false
  };
}

function cloneWFCCell(cell: WFCCell): WFCCell {
  return {
    possible: [...cell.possible],
    entropy: cell.entropy,
    collapsed: cell.collapsed
  };
}

function getCellState(cell: WFCCell): number {
  for (let i = 0; i < cell.possible.length; i++) {
    if (cell.possible[i]) return i;
  }
  return -1;
}

function collapseCell(cell: WFCCell, state: number): void {
  cell.possible.fill(false);
  cell.possible[state] = true;
  cell.entropy = 1;
  cell.collapsed = true;
}

function propagate(grid: WFCCell[][], width: number, height: number): boolean {
  const stack: Position[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x].collapsed) {
        stack.push({ x, y });
      }
    }
  }
  
  while (stack.length > 0) {
    const pos = stack.pop()!;
    const cell = grid[pos.y][pos.x];
    const state = getCellState(cell);
    
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];
    
    for (const dir of directions) {
      const nx = pos.x + dir.dx;
      const ny = pos.y + dir.dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const neighbor = grid[ny][nx];
      if (neighbor.collapsed) continue;
      
      let changed = false;
      
      if (state === MazeCellType.WALL) {
        // Wall can be adjacent to anything, no constraint
      } else {
        // Path can be adjacent to path - no constraint, walls are just walls
      }
      
      if (changed) {
        neighbor.entropy = neighbor.possible.filter(p => p).length;
        if (neighbor.entropy === 0) {
          return false;
        }
        stack.push({ x: nx, y: ny });
      }
    }
  }
  
  return true;
}

function findLowestEntropy(grid: WFCCell[][], width: number, height: number): Position | null {
  let minEntropy = Infinity;
  let candidates: Position[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (cell.collapsed) continue;
      
      if (cell.entropy < minEntropy) {
        minEntropy = cell.entropy;
        candidates = [{ x, y }];
      } else if (cell.entropy === minEntropy) {
        candidates.push({ x, y });
      }
    }
  }
  
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function runWFC(width: number, height: number, fixedCells: { x: number; y: number; state: MazeCellType }[] = []): MazeCellType[][] | null {
  const grid: WFCCell[][] = [];
  const numStates = 2;
  
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = createWFCCell(numStates);
    }
  }
  
  for (const fixed of fixedCells) {
    collapseCell(grid[fixed.y][fixed.x], fixed.state);
  }
  
  if (!propagate(grid, width, height)) {
    return null;
  }
  
  while (true) {
    const pos = findLowestEntropy(grid, width, height);
    if (!pos) break;
    
    const cell = grid[pos.y][pos.x];
    const possibleStates: number[] = [];
    for (let i = 0; i < numStates; i++) {
      if (cell.possible[i]) possibleStates.push(i);
    }
    
    if (possibleStates.length === 0) {
      return null;
    }
    
    const chosenState = possibleStates[Math.floor(Math.random() * possibleStates.length)];
    
    const gridCopy: WFCCell[][] = grid.map(row => row.map(cell => cloneWFCCell(cell)));
    
    collapseCell(grid[pos.y][pos.x], chosenState);
    const success = propagate(grid, width, height);
    
    if (!success) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          grid[y][x] = gridCopy[y][x];
        }
      }
      
      const otherStates = possibleStates.filter(s => s !== chosenState);
      if (otherStates.length === 0) {
        return null;
      }
      collapseCell(grid[pos.y][pos.x], otherStates[0]);
      if (!propagate(grid, width, height)) {
        return null;
      }
    }
  }
  
  const result: MazeCellType[][] = [];
  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      result[y][x] = getCellState(grid[y][x]) as MazeCellType;
    }
  }
  
  return result;
}

function bfsConnectivity(maze: MazeCellType[][], start: Position, end: Position): boolean {
  const height = maze.length;
  const width = maze[0].length;
  const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
  const queue: Position[] = [start];
  visited[start.y][start.x] = true;
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.x === end.x && current.y === end.y) {
      return true;
    }
    
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];
    
    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited[ny][nx]) continue;
      if (maze[ny][nx] === MazeCellType.WALL) continue;
      
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  
  return false;
}

function ensurePathWidth(maze: MazeCellType[][], start: Position, end: Position): void {
  const height = maze.length;
  const width = maze[0].length;
  
  const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
  const parent: (Position | null)[][] = Array.from({ length: height }, () => Array(width).fill(null));
  const queue: Position[] = [start];
  visited[start.y][start.x] = true;
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.x === end.x && current.y === end.y) {
      break;
    }
    
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];
    
    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited[ny][nx]) continue;
      if (maze[ny][nx] === MazeCellType.WALL) continue;
      
      visited[ny][nx] = true;
      parent[ny][nx] = current;
      queue.push({ x: nx, y: ny });
    }
  }
  
  const path: Position[] = [];
  let current: Position | null = end;
  while (current) {
    path.unshift(current);
    current = parent[current.y][current.x];
  }
  
  for (const pos of path) {
    const dirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];
    for (const dir of dirs) {
      const nx = pos.x + dir.dx;
      const ny = pos.y + dir.dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (!(nx === start.x && ny === start.y) && !(nx === end.x && ny === end.y)) {
          // Only widen if the adjacent cell is not already part of the main path
        }
      }
    }
  }
  
  // Widen the path by setting adjacent cells to path if they're walls
  // But only if they don't create new issues
  for (const pos of path) {
    const directions = [
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 }
    ];
    for (const dir of directions) {
      const nx = pos.x + dir.dx;
      const ny = pos.y + dir.dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (maze[ny][nx] === MazeCellType.WALL) {
          maze[ny][nx] = MazeCellType.PATH;
        }
      }
    }
  }
}

export class Maze {
  size: number;
  grid: MazeCellType[][];
  start: Position;
  end: Position;
  treasures: Treasure[];
  traps: Trap[];
  reconstructRegion: { x: number; y: number; size: number } | null;

  constructor(size: number = MAZE_SIZE) {
    this.size = size;
    this.start = { x: 0, y: 0 };
    this.end = { x: size - 1, y: size - 1 };
    this.grid = [];
    this.treasures = [];
    this.traps = [];
    this.reconstructRegion = null;
    this.generate();
  }

  generate(): void {
    let maze: MazeCellType[][] | null = null;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!maze && attempts < maxAttempts) {
      maze = runWFC(this.size, this.size, [
        { x: this.start.x, y: this.start.y, state: MazeCellType.PATH },
        { x: this.end.x, y: this.end.y, state: MazeCellType.PATH }
      ]);
      
      if (maze) {
        ensurePathWidth(maze, this.start, this.end);
        
        if (!bfsConnectivity(maze, this.start, this.end)) {
          maze = null;
        }
      }
      
      attempts++;
    }
    
    if (!maze) {
      this.generateSimpleMaze();
    } else {
      this.grid = maze;
    }
    
    this.placeTreasures();
    this.placeTraps();
  }

  generateSimpleMaze(): void {
    this.grid = [];
    for (let y = 0; y < this.size; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.size; x++) {
        this.grid[y][x] = Math.random() > 0.35 ? MazeCellType.PATH : MazeCellType.WALL;
      }
    }
    
    this.grid[0][0] = MazeCellType.PATH;
    this.grid[this.size - 1][this.size - 1] = MazeCellType.PATH;
    
    let x = 0;
    let y = 0;
    while (x < this.size - 1 || y < this.size - 1) {
      if (x < this.size - 1 && (y === this.size - 1 || Math.random() > 0.5)) {
        x++;
      } else if (y < this.size - 1) {
        y++;
      }
      this.grid[y][x] = MazeCellType.PATH;
      if (x + 1 < this.size) this.grid[y][x + 1] = MazeCellType.PATH;
      if (y + 1 < this.size) this.grid[y + 1][x] = MazeCellType.PATH;
    }
    
    ensurePathWidth(this.grid, this.start, this.end);
  }

  isWall(x: number, y: number): boolean {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) {
      return true;
    }
    return this.grid[y][x] === MazeCellType.WALL;
  }

  isPath(x: number, y: number): boolean {
    return !this.isWall(x, y);
  }

  canMoveTo(x: number, y: number): boolean {
    return this.isPath(x, y);
  }

  getPathCells(): Position[] {
    const cells: Position[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.grid[y][x] === MazeCellType.PATH) {
          cells.push({ x, y });
        }
      }
    }
    return cells;
  }

  placeTreasures(): void {
    this.treasures = [];
    const pathCells = this.getPathCells().filter(c => 
      !(c.x === this.start.x && c.y === this.start.y) &&
      !(c.x === this.end.x && c.y === this.end.y)
    );
    
    const shuffled = pathCells.sort(() => Math.random() - 0.5);
    const count = Math.min(TREASURE_COUNT, shuffled.length);
    
    for (let i = 0; i < count; i++) {
      this.treasures.push({
        x: shuffled[i].x,
        y: shuffled[i].y,
        collected: false,
        pulsePhase: Math.random() * Math.PI * 2
      });
    }
  }

  placeTraps(): void {
    this.traps = [];
    const pathCells = this.getPathCells().filter(c => 
      !(c.x === this.start.x && c.y === this.start.y) &&
      !(c.x === this.end.x && c.y === this.end.y) &&
      !this.treasures.some(t => t.x === c.x && t.y === c.y)
    );
    
    const shuffled = pathCells.sort(() => Math.random() - 0.5);
    const count = Math.min(TRAP_COUNT, shuffled.length);
    
    for (let i = 0; i < count; i++) {
      this.traps.push({
        x: shuffled[i].x,
        y: shuffled[i].y,
        triggered: false
      });
    }
  }

  reconstructRegion3x3(playerX: number, playerY: number): { 
    oldMaze: MazeCellType[][]; 
    newMaze: MazeCellType[][];
    regionX: number;
    regionY: number;
  } | null {
    const regionSize = 3;
    let attempts = 0;
    const maxAttempts = 50;
    
    while (attempts < maxAttempts) {
      const regionX = Math.floor(Math.random() * (this.size - regionSize + 1));
      const regionY = Math.floor(Math.random() * (this.size - regionSize + 1));
      
      const hasStart = regionX <= this.start.x && this.start.x < regionX + regionSize &&
                       regionY <= this.start.y && this.start.y < regionY + regionSize;
      const hasEnd = regionX <= this.end.x && this.end.x < regionX + regionSize &&
                     regionY <= this.end.y && this.end.y < regionY + regionSize;
      
      if (hasStart || hasEnd) {
        attempts++;
        continue;
      }
      
      const playerInRegion = regionX <= playerX && playerX < regionX + regionSize &&
                             regionY <= playerY && playerY < regionY + regionSize;
      
      if (playerInRegion) {
        attempts++;
        continue;
      }
      
      const oldMaze = this.grid.map(row => [...row]);
      
      const fixedCells: { x: number; y: number; state: MazeCellType }[] = [];
      
      for (let i = 0; i < regionSize; i++) {
        if (regionY > 0) {
          fixedCells.push({ 
            x: regionX + i, 
            y: regionY, 
            state: this.grid[regionY][regionX + i] 
          });
        }
        if (regionY + regionSize < this.size) {
          fixedCells.push({ 
            x: regionX + i, 
            y: regionY + regionSize - 1, 
            state: this.grid[regionY + regionSize - 1][regionX + i] 
          });
        }
      }
      for (let i = 0; i < regionSize; i++) {
        if (regionX > 0) {
          fixedCells.push({ 
            x: regionX, 
            y: regionY + i, 
            state: this.grid[regionY + i][regionX] 
          });
        }
        if (regionX + regionSize < this.size) {
          fixedCells.push({ 
            x: regionX + regionSize - 1, 
            y: regionY + i, 
            state: this.grid[regionY + i][regionX + regionSize - 1] 
          });
        }
      }
      
      const newRegion = runWFC(regionSize, regionSize, fixedCells.map(f => ({
        x: f.x - regionX,
        y: f.y - regionY,
        state: f.state
      })));
      
      if (!newRegion) {
        attempts++;
        continue;
      }
      
      const testMaze = this.grid.map(row => [...row]);
      for (let y = 0; y < regionSize; y++) {
        for (let x = 0; x < regionSize; x++) {
          testMaze[regionY + y][regionX + x] = newRegion[y][x];
        }
      }
      
      if (!bfsConnectivity(testMaze, this.start, this.end)) {
        attempts++;
        continue;
      }
      
      for (let y = 0; y < regionSize; y++) {
        for (let x = 0; x < regionSize; x++) {
          this.grid[regionY + y][regionX + x] = newRegion[y][x];
        }
      }
      
      this.updateTreasuresAndTrapsAfterReconstruct(regionX, regionY, regionSize);
      
      this.reconstructRegion = { x: regionX, y: regionY, size: regionSize };
      
      return {
        oldMaze,
        newMaze: this.grid.map(row => [...row]),
        regionX,
        regionY
      };
    }
    
    return null;
  }

  updateTreasuresAndTrapsAfterReconstruct(regionX: number, regionY: number, regionSize: number): void {
    this.treasures = this.treasures.filter(t => {
      const inRegion = t.x >= regionX && t.x < regionX + regionSize &&
                       t.y >= regionY && t.y < regionY + regionSize;
      if (inRegion) return false;
      if (this.isWall(t.x, t.y)) return false;
      return !t.collected;
    });
    
    this.traps = this.traps.filter(t => {
      const inRegion = t.x >= regionX && t.x < regionX + regionSize &&
                       t.y >= regionY && t.y < regionY + regionSize;
      if (inRegion) return false;
      if (this.isWall(t.x, t.y)) return false;
      return !t.triggered;
    });
    
    const pathCellsInRegion: Position[] = [];
    for (let y = regionY; y < regionY + regionSize && y < this.size; y++) {
      for (let x = regionX; x < regionX + regionSize && x < this.size; x++) {
        if (this.grid[y][x] === MazeCellType.PATH) {
          if (!(x === this.start.x && y === this.start.y) &&
              !(x === this.end.x && y === this.end.y)) {
            pathCellsInRegion.push({ x, y });
          }
        }
      }
    }
    
    const shuffled = pathCellsInRegion.sort(() => Math.random() - 0.5);
    
    const treasuresToAdd = Math.min(2, shuffled.length);
    for (let i = 0; i < treasuresToAdd && this.treasures.length < TREASURE_COUNT; i++) {
      const pos = shuffled.pop();
      if (pos) {
        this.treasures.push({
          x: pos.x,
          y: pos.y,
          collected: false,
          pulsePhase: Math.random() * Math.PI * 2
        });
      }
    }
    
    const trapsToAdd = Math.min(1, shuffled.length);
    for (let i = 0; i < trapsToAdd && this.traps.length < TRAP_COUNT; i++) {
      const pos = shuffled.pop();
      if (pos) {
        this.traps.push({
          x: pos.x,
          y: pos.y,
          triggered: false
        });
      }
    }
  }

  collectTreasure(x: number, y: number): boolean {
    const treasure = this.treasures.find(t => t.x === x && t.y === y && !t.collected);
    if (treasure) {
      treasure.collected = true;
      return true;
    }
    return false;
  }

  triggerTrap(x: number, y: number): boolean {
    const trap = this.traps.find(t => t.x === x && t.y === y && !t.triggered);
    if (trap) {
      trap.triggered = true;
      return true;
    }
    return false;
  }

  getTreasureCount(): number {
    return this.treasures.filter(t => !t.collected).length;
  }

  getTotalTreasureCount(): number {
    return this.treasures.length;
  }
}
