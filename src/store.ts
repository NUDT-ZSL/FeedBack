import { create } from 'zustand';
import {
  GameState,
  GameAction,
  Position,
  Projectile
} from './types';
import {
  createInitialState,
  createInitialCatapult,
  createCrack,
  calculateDamage,
  canMoveCatapult,
  canAttackTarget,
  canDeployCatapult,
  createImpactParticles,
  imperialTurn,
  endTurn,
  getTrajectoryPoints,
  generateId,
  playSound
} from './GameLogic';

interface GameStore extends GameState {
  dispatch: (action: GameAction) => void;
  projectileTrajectories: Map<string, { x: number; y: number }[]>;
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialState(),
  projectileTrajectories: new Map(),

  dispatch: (action: GameAction) => {
    const state = get();
    
    switch (action.type) {
      case 'SELECT_CATAPULT':
        set({ selectedCatapult: action.id });
        break;

      case 'DEPLOY_CATAPULT': {
        if (!canDeployCatapult(action.position, state.catapults)) return;
        
        const newCatapult = createInitialCatapult(action.position);
        newCatapult.hasActed = true;
        
        set({
          catapults: [...state.catapults, newCatapult],
          selectedCatapult: newCatapult.id
        });
        break;
      }

      case 'MOVE_CATAPULT': {
        const catapult = state.catapults.find(c => c.id === action.id);
        if (!catapult) return;
        if (!canMoveCatapult(catapult, action.position, state.catapults, state.oilAreas)) return;
        
        set({
          catapults: state.catapults.map(c =>
            c.id === action.id
              ? { ...c, position: action.position, hasActed: true }
              : c
          )
        });
        break;
      }

      case 'ATTACK': {
        const catapult = state.catapults.find(c => c.id === action.catapultId);
        if (!catapult) return;
        if (!canAttackTarget(catapult, action.target)) return;
        
        const { damage, crackSize } = calculateDamage(catapult, action.target, state.wallSegments);
        
        const projectile: Projectile = {
          id: generateId(),
          startPos: { ...catapult.position },
          endPos: { ...action.target },
          progress: 0,
          duration: 800,
          type: 'stone'
        };
        
        const trajectory = getTrajectoryPoints(catapult.position, action.target);
        const newTrajectories = new Map(state.projectileTrajectories);
        newTrajectories.set(projectile.id, trajectory);
        
        const newWallSegments = state.wallSegments.map(w => {
          if (w.position.x === action.target.x && w.position.y === action.target.y) {
            const newDurability = Math.max(0, w.durability - damage);
            const newCracks = crackSize > 0 
              ? [...w.cracks, createCrack(crackSize)].slice(-5)
              : w.cracks;
            return { ...w, durability: newDurability, cracks: newCracks };
          }
          return w;
        });
        
        const impactParticles = createImpactParticles(
          { x: action.target.x * 50 + 25, y: action.target.y * 50 + 25 },
          'stone'
        );
        
        playSound('attack');
        setTimeout(() => playSound('hit'), 300);
        
        set({
          catapults: state.catapults.map(c =>
            c.id === action.catapultId ? { ...c, hasActed: true } : c
          ),
          wallSegments: newWallSegments,
          projectiles: [...state.projectiles, projectile],
          projectileTrajectories: newTrajectories,
          particles: [...state.particles, ...impactParticles]
        });
        break;
      }

      case 'END_TURN': {
        set({ phase: 'transition' });
        
        setTimeout(() => {
          const currentState = get();
          const imperialResult = imperialTurn(currentState);
          
          set({ ...imperialResult, phase: 'imperial' });
          
          setTimeout(() => {
            const stateAfterImperial = get();
            const endTurnResult = endTurn(stateAfterImperial);
            
            if (endTurnResult.winner === 'rebels') {
              playSound('victory');
            } else if (endTurnResult.winner === 'imperial') {
              playSound('defeat');
            }
            
            set({ ...endTurnResult, phase: endTurnResult.winner ? 'gameOver' : 'player' });
          }, 1500);
        }, 1000);
        break;
      }

      case 'HOVER_TILE':
        set({ hoveredTile: action.position });
        break;

      case 'RESET_GAME': {
        set({
          ...createInitialState(),
          projectileTrajectories: new Map()
        });
        break;
      }

      case 'UPDATE_PARTICLES': {
        const updatedParticles = state.particles
          .map(p => ({
            ...p,
            position: {
              x: p.position.x + p.velocity.x,
              y: p.position.y + p.velocity.y
            },
            velocity: {
              x: p.velocity.x * 0.98,
              y: p.velocity.y + 0.1
            },
            life: p.life - 1
          }))
          .filter(p => p.life > 0);
        
        if (updatedParticles.length !== state.particles.length || 
            updatedParticles.some((p, i) => 
              p.position.x !== state.particles[i]?.position.x ||
              p.position.y !== state.particles[i]?.position.y
            )) {
          set({ particles: updatedParticles });
        }
        break;
      }

      case 'UPDATE_PROJECTILES': {
        const now = Date.now();
        const updatedProjectiles = state.projectiles
          .map(p => {
            const elapsed = now - (p as Projectile & { startTime?: number }).startTime || 0;
            const progress = Math.min(1, elapsed / p.duration);
            return { ...p, progress };
          })
          .filter(p => p.progress < 1);
        
        const removedIds = state.projectiles
          .filter(p => !updatedProjectiles.find(up => up.id === p.id))
          .map(p => p.id);
        
        if (removedIds.length > 0) {
          const newTrajectories = new Map(state.projectileTrajectories);
          removedIds.forEach(id => newTrajectories.delete(id));
          set({ projectiles: updatedProjectiles, projectileTrajectories: newTrajectories });
        } else if (updatedProjectiles.some((p, i) => p.progress !== state.projectiles[i]?.progress)) {
          set({ projectiles: updatedProjectiles });
        }
        break;
      }
    }
  }
}));
