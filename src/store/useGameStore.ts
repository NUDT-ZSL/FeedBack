import { create } from 'zustand';
import type {
  GameState,
  GamePhase,
  ShipState,
  Fragment,
  Storm,
  InputState,
} from '../types/game';
import { generateMaze, getSpawnPosition, getExitPosition } from '../game/MazeGenerator';
import { createInitialShip, updateShipPhysics, getShipRadius } from '../game/ShipPhysics';
import {
  spawnStorm,
  updateStorms,
  checkStormCollision,
  getStormEnergyDrain,
  generateStormSpawnTime,
} from '../game/StormSystem';

interface GameStore extends GameState {
  input: InputState;
  stormSpawnTimer: number;
  nextStormSpawn: number;
  setInput: (input: Partial<InputState>) => void;
  startGame: () => void;
  update: (deltaTime: number, currentTime: number) => void;
  resetGame: () => void;
}

const initialShip: ShipState = {
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
};

const initialState: GameState = {
  phase: 'start',
  maze: null,
  ship: initialShip,
  storms: [],
  fragments: [],
  collectedFragments: 0,
  startTime: 0,
  elapsedTime: 0,
  camera: { x: 0, y: 0, scale: 1 },
  isStormNearby: false,
  stormBorderTime: 0,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,
  input: { up: false, down: false, left: false, right: false },
  stormSpawnTimer: 0,
  nextStormSpawn: generateStormSpawnTime(),

  setInput: (input) => {
    set((state) => ({
      input: { ...state.input, ...input },
    }));
  },

  startGame: () => {
    const { maze, fragments } = generateMaze();
    const spawnPos = getSpawnPosition(maze.cellSize);
    const ship = createInitialShip(spawnPos.x, spawnPos.y);

    set({
      phase: 'playing',
      maze,
      ship,
      storms: [],
      fragments,
      collectedFragments: 0,
      startTime: performance.now(),
      elapsedTime: 0,
      camera: { x: spawnPos.x, y: spawnPos.y, scale: 1 },
      isStormNearby: false,
      stormBorderTime: 0,
      stormSpawnTimer: 0,
      nextStormSpawn: generateStormSpawnTime(),
    });
  },

  update: (deltaTime: number, currentTime: number) => {
    const state = get();
    if (state.phase !== 'playing' || !state.maze) return;

    const maze = state.maze;
    const ship = updateShipPhysics(state.ship, state.input, maze, deltaTime, currentTime);

    let energy = ship.energy;
    const storms = updateStorms(state.storms, maze, deltaTime);
    const isStormNearby = checkStormCollision(ship.x, ship.y, storms);

    if (isStormNearby) {
      energy = Math.max(0, energy - getStormEnergyDrain() * deltaTime);
    }

    let stormSpawnTimer = state.stormSpawnTimer + deltaTime;
    let nextStormSpawn = state.nextStormSpawn;
    let newStorms = storms;

    if (stormSpawnTimer >= nextStormSpawn) {
      const storm = spawnStorm(maze);
      if (storm) {
        newStorms = [...storms, storm];
      }
      stormSpawnTimer = 0;
      nextStormSpawn = generateStormSpawnTime();
    }

    let collectedFragments = state.collectedFragments;
    const shipRadius = getShipRadius();
    const collectDistance = 20;

    const newFragments = state.fragments.map((fragment) => {
      if (fragment.collected) return fragment;

      const dx = ship.x - fragment.x;
      const dy = ship.y - fragment.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < collectDistance + shipRadius) {
        collectedFragments++;
        energy = Math.min(ship.maxEnergy, energy + 20);

        const particles = [];
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10;
          const speed = 80;
          particles.push({
            x: fragment.x,
            y: fragment.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            maxLife: 1,
          });
        }

        return {
          ...fragment,
          collected: true,
          collectParticles: particles,
        };
      }

      return {
        ...fragment,
        rotation: fragment.rotation + deltaTime * Math.PI,
      };
    });

    const updatedFragments = newFragments.map((fragment) => {
      if (fragment.collectParticles.length === 0) return fragment;

      const updatedParticles = fragment.collectParticles
        .map((p) => ({
          ...p,
          x: p.x + p.vx * deltaTime,
          y: p.y + p.vy * deltaTime,
          life: p.life - deltaTime,
        }))
        .filter((p) => p.life > 0);

      return { ...fragment, collectParticles: updatedParticles };
    });

    const exitPos = getExitPosition(maze);
    const exitDist = Math.sqrt(
      Math.pow(ship.x - exitPos.x, 2) + Math.pow(ship.y - exitPos.y, 2)
    );

    let phase: GamePhase = 'playing';
    if (energy <= 0) {
      phase = 'gameover';
    } else if (exitDist < maze.cellSize / 2) {
      phase = 'victory';
    }

    const elapsedTime = (currentTime - state.startTime) / 1000;

    const targetCamX = ship.x;
    const targetCamY = ship.y;
    const smoothFactor = 0.1;
    const camera = {
      x: state.camera.x + (targetCamX - state.camera.x) * smoothFactor,
      y: state.camera.y + (targetCamY - state.camera.y) * smoothFactor,
      scale: state.camera.scale,
    };

    const stormBorderTime = isStormNearby
      ? state.stormBorderTime + deltaTime
      : 0;

    set({
      ship: { ...ship, energy },
      storms: newStorms,
      fragments: updatedFragments,
      collectedFragments,
      phase,
      elapsedTime,
      camera,
      isStormNearby,
      stormBorderTime,
      stormSpawnTimer,
      nextStormSpawn,
    });
  },

  resetGame: () => {
    set({
      ...initialState,
      input: { up: false, down: false, left: false, right: false },
      stormSpawnTimer: 0,
      nextStormSpawn: generateStormSpawnTime(),
    });
  },
}));
