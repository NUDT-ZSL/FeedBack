import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { ShipState, MazeData, Fragment, Storm, InputState } from '../types/game';

const COLORS = {
  background: '#0D0D0D',
  wall: '#2D1B69',
  wallGlow: '#6A0DAD',
  riftStart: '#6A0DAD',
  riftEnd: '#9B59B6',
  ship: '#00FFFF',
  shipGlow: '#00BFFF',
  shipTrailStart: '#00FFFF',
  shipTrailEnd: '#0080FF',
  fragment: '#FFD700',
  fragmentGlow: '#FFA500',
  stormCenter: '#FFFFFF',
  stormGlow: '#FF00FF',
  exit: '#00FF00',
  energyHigh: '#00FF00',
  energyLow: '#FF0000',
  stormBorder: '#8A2BE2',
};

const SHIP_RADIUS = 12;
const WALL_WIDTH = 6;
const RIFT_WIDTH = 30;
const FRAGMENT_RADIUS = 6;
const SHIP_HIT_DURATION = 100;

function drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number
) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = rotation + (Math.PI / 3) * i;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

function drawMaze(ctx: CanvasRenderingContext2D, maze: MazeData) {
  const { grid, cellSize, width, height } = maze;

  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, 0, width * cellSize, height * cellSize);

  ctx.fillStyle = COLORS.background;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 0) {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = WALL_WIDTH;
  ctx.lineCap = 'square';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 1) {
        if (x > 0 && grid[y][x - 1] === 0) {
          ctx.beginPath();
          ctx.moveTo(x * cellSize, y * cellSize);
          ctx.lineTo(x * cellSize, y * cellSize + cellSize);
          ctx.stroke();
        }

        if (x < width - 1 && grid[y][x + 1] === 0) {
          ctx.beginPath();
          ctx.moveTo(x * cellSize + cellSize, y * cellSize);
          ctx.lineTo(x * cellSize + cellSize, y * cellSize + cellSize);
          ctx.stroke();
        }

        if (y > 0 && grid[y - 1][x] === 0) {
          ctx.beginPath();
          ctx.moveTo(x * cellSize, y * cellSize);
          ctx.lineTo(x * cellSize + cellSize, y * cellSize);
          ctx.stroke();
        }

        if (y < height - 1 && grid[y + 1][x] === 0) {
          ctx.beginPath();
          ctx.moveTo(x * cellSize, y * cellSize + cellSize);
          ctx.lineTo(x * cellSize + cellSize, y * cellSize + cellSize);
          ctx.stroke();
        }
      }
    }
  }

  for (const rift of maze.rifts) {
    const rx = rift.x * cellSize + cellSize / 2;
    const ry = rift.y * cellSize + cellSize / 2;

    const gradient = ctx.createRadialGradient(rx, ry, 0, rx, ry, RIFT_WIDTH / 2);
    gradient.addColorStop(0, COLORS.riftEnd);
    gradient.addColorStop(1, COLORS.riftStart);

    ctx.fillStyle = gradient;
    ctx.shadowColor = COLORS.riftEnd;
    ctx.shadowBlur = 15;

    if (rift.direction === 'horizontal') {
      ctx.fillRect(rift.x * cellSize, ry - RIFT_WIDTH / 2, cellSize, RIFT_WIDTH);
    } else {
      ctx.fillRect(rx - RIFT_WIDTH / 2, rift.y * cellSize, RIFT_WIDTH, cellSize);
    }

    ctx.shadowBlur = 0;
  }
}

function drawExit(ctx: CanvasRenderingContext2D, maze: MazeData, time: number) {
  const exitX = maze.exit.gridX * maze.cellSize + maze.cellSize / 2;
  const exitY = maze.exit.gridY * maze.cellSize + maze.cellSize / 2;

  const pulseRadius = maze.cellSize * 0.4 + Math.sin(time * 3) * 5;

  const gradient = ctx.createRadialGradient(exitX, exitY, 0, exitX, exitY, pulseRadius);
  gradient.addColorStop(0, 'rgba(0, 255, 0, 0.8)');
  gradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 255, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(exitX, exitY, pulseRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.exit;
  ctx.shadowColor = COLORS.exit;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(exitX, exitY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawFragments(ctx: CanvasRenderingContext2D, fragments: Fragment[], time: number) {
  for (const fragment of fragments) {
    if (fragment.collected && fragment.collectParticles.length === 0) continue;

    if (!fragment.collected) {
      ctx.save();
      ctx.shadowColor = COLORS.fragment;
      ctx.shadowBlur = 10;
      ctx.fillStyle = COLORS.fragment;
      drawHexagon(ctx, fragment.x, fragment.y, FRAGMENT_RADIUS, fragment.rotation);
      ctx.fill();
      ctx.restore();

      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + time * 2;
        const px = fragment.x + Math.cos(angle) * 15;
        const py = fragment.y + Math.sin(angle) * 15;

        ctx.fillStyle = COLORS.fragmentGlow;
        ctx.shadowColor = COLORS.fragmentGlow;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    for (const particle of fragment.collectParticles) {
      const alpha = particle.life / particle.maxLife;
      ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
      ctx.shadowColor = COLORS.fragment;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function drawShip(ctx: CanvasRenderingContext2D, ship: ShipState, currentTime: number) {
  for (let i = ship.trail.length - 1; i >= 0; i--) {
    const p = ship.trail[i];
    const alpha = p.life * 0.8;
    const size = 3 * (1 - (i / ship.trail.length) * 0.5);

    const r = 0;
    const g = Math.floor(255 * (1 - (i / ship.trail.length) * 0.5));
    const b = 255;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  const isFlashing = ship.isHit && currentTime - ship.hitTime < SHIP_HIT_DURATION;
  const flashProgress = isFlashing
    ? Math.sin(((currentTime - ship.hitTime) / 10) * Math.PI)
    : 0;

  const bodyColor = isFlashing
    ? `rgb(${Math.floor((255 * (1 + flashProgress)) / 2)}, ${Math.floor((255 * (1 - flashProgress)) / 2)}, ${Math.floor((255 * (1 - flashProgress)) / 2)})`
    : COLORS.ship;

  const glowColor = isFlashing ? '#FF0000' : COLORS.shipGlow;

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 15;
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 2;

  drawHexagon(ctx, 0, 0, SHIP_RADIUS, 0);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = glowColor;
  ctx.beginPath();
  ctx.moveTo(SHIP_RADIUS, 0);
  ctx.lineTo(SHIP_RADIUS * 0.3, -SHIP_RADIUS * 0.4);
  ctx.lineTo(SHIP_RADIUS * 0.3, SHIP_RADIUS * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawStorms(ctx: CanvasRenderingContext2D, storms: Storm[]) {
  for (const storm of storms) {
    const alpha = Math.min(1, (storm.lifetime / storm.maxLifetime) * 2);

    const gradient = ctx.createRadialGradient(
      storm.x,
      storm.y,
      0,
      storm.x,
      storm.y,
      storm.radius
    );
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(255, 0, 255, ${alpha * 0.6})`);
    gradient.addColorStop(1, `rgba(255, 0, 255, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(storm.x, storm.y, storm.radius, 0, Math.PI * 2);
    ctx.fill();

    for (const p of storm.particles) {
      const px = storm.x + Math.cos(p.angle) * p.radius;
      const py = storm.y + Math.sin(p.angle) * p.radius;

      ctx.fillStyle = `rgba(255, 0, 255, ${alpha})`;
      ctx.shadowColor = COLORS.stormGlow;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function drawStormBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
) {
  const flashPeriod = 0.3;
  const flashOn = Math.floor(time / flashPeriod) % 2 === 0;
  if (!flashOn) return;

  const borderWidth = 8;
  const alpha = 0.6;

  ctx.strokeStyle = `rgba(138, 43, 226, ${alpha})`;
  ctx.lineWidth = borderWidth;
  ctx.shadowColor = COLORS.stormBorder;
  ctx.shadowBlur = 20;
  ctx.strokeRect(
    borderWidth / 2,
    borderWidth / 2,
    width - borderWidth,
    height - borderWidth
  );
  ctx.shadowBlur = 0;
}

function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const stateRef = useRef<{
    phase: string;
    maze: MazeData | null;
    ship: ShipState;
    storms: Storm[];
    fragments: Fragment[];
    camera: { x: number; y: number; scale: number };
    isStormNearby: boolean;
    input: InputState;
  }>({
    phase: 'start',
    maze: null,
    ship: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      energy: 100,
      maxEnergy: 100,
      isHit: false,
      hitTime: 0,
      trail: [],
    },
    storms: [],
    fragments: [],
    camera: { x: 0, y: 0, scale: 1 },
    isStormNearby: false,
    input: { up: false, down: false, left: false, right: false },
  });

  const update = useGameStore((state) => state.update);

  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state) => {
      stateRef.current.phase = state.phase;
      stateRef.current.maze = state.maze;
      stateRef.current.ship = state.ship;
      stateRef.current.storms = state.storms;
      stateRef.current.fragments = state.fragments;
      stateRef.current.camera = state.camera;
      stateRef.current.isStormNearby = state.isStormNearby;
      stateRef.current.input = state.input;
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      const currentTime = timestamp;
      const state = stateRef.current;

      if (state.phase === 'playing') {
        update(deltaTime, currentTime);
      }

      const width = window.innerWidth;
      const height = window.innerHeight;

      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, width, height);

      if (state.maze && state.phase !== 'start') {
        const mazePixelWidth = state.maze.width * state.maze.cellSize;
        const mazePixelHeight = state.maze.height * state.maze.cellSize;

        const scaleX = width / mazePixelWidth;
        const scaleY = height / mazePixelHeight;
        const scale = Math.min(scaleX, scaleY);

        const offsetX = (width - mazePixelWidth * scale) / 2;
        const offsetY = (height - mazePixelHeight * scale) / 2;

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        drawMaze(ctx, state.maze);
        drawExit(ctx, state.maze, currentTime / 1000);
        drawFragments(ctx, state.fragments, currentTime / 1000);
        drawStorms(ctx, state.storms);

        if (
          state.phase === 'playing' ||
          state.phase === 'victory' ||
          state.phase === 'gameover'
        ) {
          drawShip(ctx, state.ship, currentTime);
        }

        ctx.restore();

        if (state.isStormNearby && state.phase === 'playing') {
          drawStormBorder(ctx, width, height, currentTime / 1000);
        }
      }

      animationRef.current = requestAnimationFrame(gameLoop);
    };

    animationRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [update]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    />
  );
}

export default GameCanvas;
