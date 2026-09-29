export type PetType = 'cat' | 'dog' | 'dragon';

export interface PetStatus {
  hunger: number;
  happiness: number;
  cleanliness: number;
  energy: number;
}

export interface PetProfile {
  id: string;
  name: string;
  type: PetType;
  status: PetStatus;
  ownerId: string;
  ownerName: string;
  likes: number;
  isCollapsed: boolean;
  collapseAt: number | null;
  createdAt: number;
  isDead: boolean;
}

export type PetAction =
  | { type: 'FEED' }
  | { type: 'PLAY' }
  | { type: 'CLEAN' }
  | { type: 'DECAY'; elapsed: number }
  | { type: 'COLLAPSE' }
  | { type: 'REVIVE' }
  | { type: 'DIE' }
  | { type: 'SET_PET'; pet: PetProfile }
  | { type: 'SET_ANIMATION'; animation: PetAnimationState };

export type PetAnimationState = 'idle' | 'jump' | 'spin' | 'collapsed' | 'dying' | 'dead';

export function getHealthScore(status: PetStatus): number {
  const avg = (status.hunger + status.happiness + status.cleanliness + status.energy) / 4;
  return Math.max(1, Math.min(5, Math.round(avg / 20)));
}

export function getStatusLabel(key: keyof PetStatus): string {
  const labels: Record<keyof PetStatus, string> = {
    hunger: '饱食度',
    happiness: '快乐度',
    cleanliness: '清洁度',
    energy: '精力值',
  };
  return labels[key];
}

export const STATUS_KEYS: (keyof PetStatus)[] = ['hunger', 'happiness', 'cleanliness', 'energy'];

export const INITIAL_STATUS: PetStatus = {
  hunger: 80,
  happiness: 80,
  cleanliness: 80,
  energy: 80,
};
