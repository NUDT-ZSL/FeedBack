export function generateMaze(size: number): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i < size; i++) {
    grid[i] = [];
    for (let j = 0; j < size; j++) {
      grid[i][j] = 1;
    }
  }

  const directions = [
    [0, -2],
    [0, 2],
    [-2, 0],
    [2, 0],
  ];

  function shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function carve(x: number, y: number) {
    grid[y][x] = 0;

    const shuffledDirs = shuffle([...directions]);

    for (const [dx, dy] of shuffledDirs) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < size && ny >= 0 && ny < size && grid[ny][nx] === 1) {
        grid[y + dy / 2][x + dx / 2] = 0;
        carve(nx, ny);
      }
    }
  }

  carve(0, 0);

  grid[0][0] = 0;
  grid[size - 1][size - 1] = 0;

  if (!hasPath(grid, 0, 0, size - 1, size - 1)) {
    createPath(grid, 0, 0, size - 1, size - 1);
  }

  return grid;
}

function hasPath(
  grid: number[][],
  startX: number,
  startY: number,
  endX: number,
  endY: number
): boolean {
  const size = grid.length;
  const visited: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    visited[i] = new Array(size).fill(false);
  }

  const queue: [number, number][] = [[startX, startY]];
  visited[startY][startX] = true;

  const directions = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;

    if (x === endX && y === endY) {
      return true;
    }

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (
        nx >= 0 &&
        nx < size &&
        ny >= 0 &&
        ny < size &&
        !visited[ny][nx] &&
        grid[ny][nx] === 0
      ) {
        visited[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
  }

  return false;
}

function createPath(
  grid: number[][],
  startX: number,
  startY: number,
  endX: number,
  endY: number
): void {
  let x = startX;
  let y = startY;

  while (x !== endX || y !== endY) {
    grid[y][x] = 0;

    if (x < endX && (y >= endY || Math.random() > 0.5)) {
      x++;
    } else if (x > endX && (y <= endY || Math.random() > 0.5)) {
      x--;
    } else if (y < endY) {
      y++;
    } else if (y > endY) {
      y--;
    }
  }

  grid[endY][endX] = 0;
}
