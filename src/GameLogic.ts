import seedrandom from 'seedrandom';
import {
  Position,
  Catapult,
  WallSegment,
  Soldier,
  Particle,
  Crack,
  GameState,
  GRID_WIDTH,
  WALL_ROW,
  MAX_CATAPULTS,
  CATAPULT_MOVE_RANGE,
  CATAPULT_ATTACK_RANGE,
  GRAIN_CONSUMPTION_PER_TURN,
  MAX_MORALE,
  GRAIN_PER_PILE,
  ARROWS_PER_QUIVER,
  INITIAL_GRAIN,
  INITIAL_ARROWS,
  INITIAL_MORALE,
  INITIAL_WALL_DURABILITY,
  SOLDIER_MOVE_RANGE
} from './types';

const rng = seedrandom('hangzhou-siege-2024');

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const getDistance = (a: Position, b: Position): number => {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
};

export const isOnWall = (pos: Position): boolean => {
  return pos.y === WALL_ROW;
};

export const isOnPlain = (pos: Position): boolean => {
  return pos.y > WALL_ROW;
};

export const isInCity = (pos: Position): boolean => {
  return pos.y < WALL_ROW;
};

export const generateCrackClipPath = (size: number): string => {
  const points: string[] = [];
  const centerX = 50;
  const centerY = 50;
  const numPoints = 6 + Math.floor(size * 1.5);
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2 + rng() * 0.5;
    const dist = 10 + size * 8 + rng() * size * 5;
    const x = centerX + Math.cos(angle) * dist;
    const y = centerY + Math.sin(angle) * dist;
    points.push(`${x}% ${y}%`);
  }
  
  return `polygon(${points.join(', ')})`;
};

export const createInitialWall = (): WallSegment[] => {
  const segments: WallSegment[] = [];
  const gateX = Math.floor(GRID_WIDTH / 2);
  
  for (let x = 0; x < GRID_WIDTH; x++) {
    segments.push({
      id: `wall-${x}`,
      position: { x, y: WALL_ROW },
      durability: x === gateX ? 80 : 100,
      cracks: [],
      isGate: x === gateX
    });
  }
  
  return segments;
};

export const createInitialCatapult = (position: Position): Catapult => ({
  id: generateId(),
  position,
  health: 100,
  hasActed: false,
  isStunned: false,
  stunTurns: 0
});

export const createSoldier = (side: 'rebels' | 'imperial', position: Position): Soldier => ({
  id: generateId(),
  side,
  position,
  health: 100,
  hasMoved: false,
  isDying: false
});

export const createParticle = (
  type: Particle['type'],
  position: { x: number; y: number },
  color: string,
  size: number = 4
): Particle => {
  const angle = rng() * Math.PI * 2;
  const speed = 0.5 + rng() * 2;
  return {
    id: generateId(),
    type,
    position: { ...position },
    velocity: {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed - 1
    },
    life: 30 + rng() * 30,
    maxLife: 60,
    color,
    size
  };
};

export const createCrack = (size: number): Crack => ({
  id: generateId(),
  size,
  clipPath: generateCrackClipPath(size)
});

export const calculateDamage = (
  catapult: Catapult,
  target: Position,
  wallSegments: WallSegment[]
): { damage: number; crackSize: number } => {
  const distance = getDistance(catapult.position, target);
  const wallSeg = wallSegments.find(
    w => w.position.x === target.x && w.position.y === target.y
  );
  
  if (!wallSeg) return { damage: 0, crackSize: 0 };
  
  const baseDamage = 25;
  const distanceFactor = Math.max(0.5, 1 - distance / CATAPULT_ATTACK_RANGE);
  const sizeFactor = wallSeg.isGate ? 1.2 : 1;
  const damage = Math.floor(baseDamage * distanceFactor * sizeFactor * (0.8 + rng() * 0.4));
  const crackSize = Math.min(5, Math.ceil(damage / 10));
  
  return { damage, crackSize };
};

export const canMoveCatapult = (
  catapult: Catapult,
  target: Position,
  catapults: Catapult[],
  oilAreas: { position: Position; turnsLeft: number }[]
): boolean => {
  if (catapult.hasActed || catapult.isStunned) return false;
  
  const distance = getDistance(catapult.position, target);
  if (distance > CATAPULT_MOVE_RANGE) return false;
  if (!isOnPlain(target)) return false;
  
  if (catapults.some(c => c.id !== catapult.id && c.position.x === target.x && c.position.y === target.y)) {
    return false;
  }
  
  if (oilAreas.some(o => o.position.x === target.x && o.position.y === target.y)) {
    return false;
  }
  
  return true;
};

export const canAttackTarget = (
  catapult: Catapult,
  target: Position
): boolean => {
  if (catapult.hasActed || catapult.isStunned) return false;
  
  const distance = getDistance(catapult.position, target);
  if (distance > CATAPULT_ATTACK_RANGE || distance < 2) return false;
  if (!isOnWall(target)) return false;
  
  return true;
};

export const canDeployCatapult = (
  position: Position,
  catapults: Catapult[]
): boolean => {
  if (catapults.length >= MAX_CATAPULTS) return false;
  if (!isOnPlain(position)) return false;
  if (position.y < WALL_ROW + 3) return false;
  
  if (catapults.some(c => c.position.x === position.x && c.position.y === position.y)) {
    return false;
  }
  
  return true;
};

export const getTrajectoryPoints = (
  start: Position,
  end: Position,
  steps: number = 20
): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const height = Math.min(8, getDistance(start, end) * 0.4);
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = start.x + dx * t;
    const y = start.y + dy * t - height * 4 * t * (1 - t);
    points.push({ x, y });
  }
  
  return points;
};

export const createImpactParticles = (
  position: { x: number; y: number },
  type: 'stone' | 'arrow' | 'oil'
): Particle[] => {
  const particles: Particle[] = [];
  const count = type === 'stone' ? 15 : type === 'oil' ? 20 : 8;
  const colors = type === 'stone' 
    ? ['#8b5e3c', '#6b4423', '#a67c52', '#4a2e1b']
    : type === 'oil'
    ? ['#3d2b1f', '#2d1f14', '#4a3525', '#1a1008']
    : ['#c0392b', '#e74c3c', '#ff6b6b', '#8b0000'];
  
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(rng() * colors.length)];
    particles.push(createParticle(
      type === 'stone' ? 'dust' : type === 'oil' ? 'oil' : 'spatter',
      position,
      color,
      type === 'stone' ? 3 + rng() * 4 : 2 + rng() * 3
    ));
  }
  
  return particles;
};

export const imperialTurn = (state: GameState): Partial<GameState> => {
  const newParticles: Particle[] = [...state.particles];
  const newCatapults = [...state.catapults];
  const newProjectiles = [...state.projectiles];
  let newArrows = state.resources.arrows;
  const newOilAreas = [...state.oilAreas];
  const newSoldiers = [...state.soldiers];
  
  const activeCatapults = newCatapults.filter(c => c.health > 0 && !c.isStunned);
  
  activeCatapults.forEach(catapult => {
    if (newArrows <= 0) return;
    
    const distance = getDistance(catapult.position, { x: GRID_WIDTH / 2, y: WALL_ROW });
    
    if (distance <= 3 && rng() > 0.5) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const oilPos = { x: catapult.position.x + dx, y: catapult.position.y + dy };
          if (isOnPlain(oilPos) && !newOilAreas.some(o => o.position.x === oilPos.x && o.position.y === oilPos.y)) {
            newOilAreas.push({ position: oilPos, turnsLeft: 2 });
            
            for (let i = 0; i < 5; i++) {
              newParticles.push(createParticle(
                'oil',
                { x: oilPos.x * 50 + 25, y: oilPos.y * 50 + 25 },
                '#3d2b1f',
                4 + rng() * 3
              ));
            }
          }
        }
      }
      
      const targetCat = newCatapults.find(c => c.id === catapult.id);
      if (targetCat) {
        targetCat.isStunned = true;
        targetCat.stunTurns = 1;
      }
    } else {
      const gateX = Math.floor(GRID_WIDTH / 2);
      const towerPositions = [
        { x: gateX - 4, y: WALL_ROW - 1 },
        { x: gateX + 4, y: WALL_ROW - 1 },
        { x: gateX, y: WALL_ROW - 1 }
      ];
      
      const nearestTower = towerPositions.reduce((nearest, tower) => {
        const distToTower = getDistance(tower, catapult.position);
        const distToNearest = getDistance(nearest, catapult.position);
        return distToTower < distToNearest ? tower : nearest;
      });
      
      if (newArrows > 0) {
        newProjectiles.push({
          id: generateId(),
          startPos: nearestTower,
          endPos: { ...catapult.position },
          progress: 0,
          duration: 600,
          type: 'arrow'
        });
        
        const hitChance = 0.6 - getDistance(nearestTower, catapult.position) * 0.03;
        if (rng() < Math.max(0.2, hitChance)) {
          const damage = 15 + Math.floor(rng() * 15);
          const targetCat = newCatapults.find(c => c.id === catapult.id);
          if (targetCat) {
            targetCat.health = Math.max(0, targetCat.health - damage);
            
            newParticles.push(...createImpactParticles(
              { x: catapult.position.x * 50 + 25, y: catapult.position.y * 50 + 25 },
              'arrow'
            ));
          }
        }
        
        newArrows = Math.max(0, newArrows - 1 / ARROWS_PER_QUIVER);
      }
    }
  });
  
  const rebelSoldiers = newSoldiers.filter(s => s.side === 'rebels' && s.health > 0);
  const imperialSoldiers = newSoldiers.filter(s => s.side === 'imperial' && s.health > 0);
  
  if (state.gateDestroyed && rebelSoldiers.length > 0) {
    rebelSoldiers.forEach(rebel => {
      if (rebel.hasMoved) return;
      
      let target = imperialSoldiers.find(imp => 
        getDistance(imp.position, rebel.position) <= 1
      );
      
      if (!target) {
        let nearest: Soldier | null = null;
        let minDist = Infinity;
        imperialSoldiers.forEach(imp => {
          const dist = getDistance(imp.position, rebel.position);
          if (dist < minDist) {
            minDist = dist;
            nearest = imp;
          }
        });
        
        if (nearest && minDist <= SOLDIER_MOVE_RANGE) {
          const targetRebel = newSoldiers.find(s => s.id === rebel.id);
          if (targetRebel) {
            targetRebel.position = { ...nearest.position };
            targetRebel.hasMoved = true;
          }
          target = nearest;
        }
      }
      
      if (target) {
        const targetImperial = newSoldiers.find(s => s.id === target!.id);
        const targetRebel = newSoldiers.find(s => s.id === rebel.id);
        
        if (targetImperial && targetRebel) {
          targetImperial.health -= 50;
          targetRebel.health -= 30;
          
          if (targetImperial.health <= 0) {
            targetImperial.isDying = true;
            for (let i = 0; i < 10; i++) {
              newParticles.push(createParticle(
                'mist',
                { x: targetImperial.position.x * 50 + 25, y: targetImperial.position.y * 50 + 25 },
                '#c0392b',
                5
              ));
            }
          }
          
          if (targetRebel.health <= 0) {
            targetRebel.isDying = true;
            for (let i = 0; i < 10; i++) {
              newParticles.push(createParticle(
                'mist',
                { x: targetRebel.position.x * 50 + 25, y: targetRebel.position.y * 50 + 25 },
                '#c0392b',
                5
              ));
            }
          }
        }
      }
    });
  }
  
  return {
    catapults: newCatapults,
    soldiers: newSoldiers.filter(s => !s.isDying),
    particles: newParticles,
    projectiles: newProjectiles,
    oilAreas: newOilAreas,
    resources: {
      ...state.resources,
      arrows: newArrows
    }
  };
};

export const endTurn = (state: GameState): Partial<GameState> => {
  const newCatapults = state.catapults
    .filter(c => c.health > 0)
    .map(c => ({
      ...c,
      hasActed: false,
      stunTurns: Math.max(0, c.stunTurns - 1),
      isStunned: c.stunTurns > 1
    }));
  
  const newSoldiers = state.soldiers.map(s => ({
    ...s,
    hasMoved: false
  }));
  
  const newOilAreas = state.oilAreas
    .map(o => ({ ...o, turnsLeft: o.turnsLeft - 1 }))
    .filter(o => o.turnsLeft > 0);
  
  const newGrain = Math.max(0, state.resources.grain - GRAIN_CONSUMPTION_PER_TURN);
  const lostCatapults = state.catapults.filter(c => c.health <= 0).length;
  
  const grainPenalty = state.resources.grain < GRAIN_CONSUMPTION_PER_TURN 
    ? 30 
    : Math.max(0, (GRAIN_CONSUMPTION_PER_TURN * 2 - newGrain) / (GRAIN_CONSUMPTION_PER_TURN * 2) * 20);
  const catapultPenalty = lostCatapults * 5;
  const newMorale = Math.max(0, Math.min(MAX_MORALE, state.resources.morale - grainPenalty - catapultPenalty));
  
  const wallDurability = state.wallSegments.reduce((sum, seg) => sum + seg.durability, 0) / state.wallSegments.length;
  
  const gateSegment = state.wallSegments.find(s => s.isGate);
  const gateDestroyed = state.gateDestroyed || (gateSegment ? gateSegment.durability <= 0 : false);
  
  const newSoldiersWithSpawn = [...newSoldiers];
  if (gateDestroyed && state.turn % 2 === 0) {
    const gateX = Math.floor(GRID_WIDTH / 2);
    newSoldiersWithSpawn.push(createSoldier('rebels', { x: gateX, y: WALL_ROW + 1 }));
    
    if (state.turn % 3 === 0) {
      newSoldiersWithSpawn.push(createSoldier('imperial', { x: gateX, y: WALL_ROW - 1 }));
    }
  }
  
  const rebelSoldiers = newSoldiersWithSpawn.filter(s => s.side === 'rebels' && s.health > 0);
  const imperialSoldiers = newSoldiersWithSpawn.filter(s => s.side === 'imperial' && s.health > 0);
  
  let winner: 'rebels' | 'imperial' | null = null;
  if (gateDestroyed && rebelSoldiers.length > imperialSoldiers.length && rebelSoldiers.length >= 3) {
    winner = 'rebels';
  } else if (newCatapults.length === 0 || newMorale <= 0) {
    winner = 'imperial';
  }
  
  return {
    turn: state.turn + 1,
    phase: 'player',
    winner,
    catapults: newCatapults,
    soldiers: newSoldiersWithSpawn.filter(s => s.health > 0),
    oilAreas: newOilAreas,
    gateDestroyed,
    resources: {
      ...state.resources,
      grain: newGrain,
      morale: newMorale,
      wallDurability
    }
  };
};

export const createInitialState = (): GameState => ({
  turn: 1,
  phase: 'player',
  winner: null,
  catapults: [],
  wallSegments: createInitialWall(),
  soldiers: [],
  resources: {
    grain: INITIAL_GRAIN,
    arrows: INITIAL_ARROWS,
    morale: INITIAL_MORALE,
    wallDurability: INITIAL_WALL_DURABILITY
  },
  particles: [],
  projectiles: [],
  selectedCatapult: null,
  hoveredTile: null,
  maxCatapults: MAX_CATAPULTS,
  gateDestroyed: false,
  oilAreas: []
});

export const playSound = (type: 'attack' | 'hit' | 'victory' | 'defeat' | 'gong' | 'bell') => {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    switch (type) {
      case 'attack':
        oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
        break;
      case 'hit':
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
        break;
      case 'victory':
      case 'gong':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(550, audioContext.currentTime + 0.15);
        oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.8);
        break;
      case 'defeat':
      case 'bell':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(330, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(294, audioContext.currentTime + 0.2);
        oscillator.frequency.setValueAtTime(262, audioContext.currentTime + 0.4);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 1);
        break;
    }
  } catch (e) {
    console.log('Audio not supported');
  }
};
