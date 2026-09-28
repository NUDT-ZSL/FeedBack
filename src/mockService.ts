import { PetProfile, PetType, PetStatus, INITIAL_STATUS, getHealthScore } from './modules/pet/types';

const PET_NAMES: Record<PetType, string[]> = {
  cat: ['小橘', '咪咪', '雪球', '花花', '布丁', '年糕'],
  dog: ['旺财', '豆豆', '球球', '毛毛', '大黄', '可乐'],
  dragon: ['小火', '烈焰', '龙宝', '焰焰', '赤鳞', '金角'],
};

const OWNER_NAMES = [
  '星尘旅人', '月光猫奴', '晨曦牧者', '暖阳使者',
  '微风守护', '彩虹伙伴', '极光驯养', '云朵玩家',
  '雨露照料', '霜花之友', '雷霆主人', '海浪陪伴',
  '林间守望', '山谷领主', '溪流守护', '花田饲主',
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateInitialPet(type: PetType, name: string, ownerName: string): PetProfile {
  return {
    id: `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type,
    status: { ...INITIAL_STATUS },
    ownerId: `user-${Date.now()}`,
    ownerName,
    likes: 0,
    isCollapsed: false,
    collapseAt: null,
    createdAt: Date.now(),
    isDead: false,
  };
}

export function generateMockPets(count: number = 36): PetProfile[] {
  const types: PetType[] = ['cat', 'dog', 'dragon'];
  const pets: PetProfile[] = [];

  for (let i = 0; i < count; i++) {
    const type = types[i % 3];
    const name = randomPick(PET_NAMES[type]);
    const ownerName = randomPick(OWNER_NAMES);
    const status: PetStatus = {
      hunger: Math.floor(Math.random() * 80) + 20,
      happiness: Math.floor(Math.random() * 80) + 20,
      cleanliness: Math.floor(Math.random() * 80) + 20,
      energy: Math.floor(Math.random() * 80) + 20,
    };

    pets.push({
      id: `mock-pet-${i}`,
      name: `${name}${i > 2 ? i : ''}`,
      type,
      status,
      ownerId: `mock-owner-${i}`,
      ownerName: `${ownerName}${i > 2 ? i : ''}`,
      likes: Math.floor(Math.random() * 50),
      isCollapsed: false,
      collapseAt: null,
      createdAt: Date.now() - Math.floor(Math.random() * 86400000),
      isDead: false,
    });
  }

  return pets;
}

export function calculateDecay(elapsedMinutes: number): number {
  const baseRate = 2;
  const acceleration = 0.5;
  const hoursElapsed = Math.floor(elapsedMinutes / 60);
  return Math.max(1, Math.round(baseRate * (1 + acceleration * hoursElapsed)));
}

export function applyDecay(status: PetStatus, elapsedMinutes: number): PetStatus {
  const decay = calculateDecay(elapsedMinutes);
  return {
    hunger: Math.max(0, status.hunger - decay),
    happiness: Math.max(0, status.happiness - decay),
    cleanliness: Math.max(0, status.cleanliness - decay),
    energy: Math.max(0, status.energy - decay),
  };
}

export function petToCardData(pet: PetProfile) {
  return {
    id: pet.id,
    name: pet.name,
    type: pet.type,
    ownerName: pet.ownerName,
    healthScore: getHealthScore(pet.status),
    likes: pet.likes,
  };
}

export const PIXEL_ART: Record<PetType, string[]> = {
  cat: [
    '    ee    ',
    '   e..e   ',
    '   ....   ',
    '  ..oo..  ',
    '  .====.  ',
    '   ....   ',
    ' ww....ww ',
    ' ww....ww ',
    '   w..w   ',
    '   w..w   ',
    '   ww.ww  ',
    '    ....  ',
    '   ..  .. ',
    '  ..    ..',
  ],
  dog: [
    '  ee    ee ',
    '  e..  e.. ',
    '  .........',
    ' ..oo......',
    ' .====.....',
    '  ........ ',
    ' ww......ww',
    ' ww......ww',
    '   w....w  ',
    '   w....w  ',
    '   ww..ww  ',
    '    w..w   ',
    '   ..  ..  ',
    '  ..    .. ',
  ],
  dragon: [
    '    aa      ',
    '   a..a     ',
    '  a....a    ',
    ' a..oo..a   ',
    ' a.====.aa  ',
    '  a......a  ',
    '   a....a   ',
    '  aa....aa  ',
    ' aa......aa ',
    '  a......a  ',
    '  a..aa..a  ',
    '   a....a   ',
    '    a..a    ',
    '   a.  .a   ',
    '  a.    .a  ',
    '  ..    ..  ',
  ],
};

export const PET_COLORS: Record<PetType, { primary: string; secondary: string; eye: string; accent: string }> = {
  cat: { primary: '#FF8C42', secondary: '#FFB380', eye: '#333333', accent: '#FF6B1A' },
  dog: { primary: '#C4956A', secondary: '#DDB892', eye: '#333333', accent: '#A0724B' },
  dragon: { primary: '#4CAF50', secondary: '#81C784', eye: '#FF5722', accent: '#2E7D32' },
};

export const PET_EMOJI: Record<PetType, string> = {
  cat: '🐱',
  dog: '🐶',
  dragon: '🐉',
};
