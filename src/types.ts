export interface User {
  id: string;
  name: string;
  avatar: string;
  creditScore: number;
  distance: number;
}

export interface Plant {
  id: string;
  name: string;
  species: string;
  icon: string;
  image: string;
  status: 'needs_water' | 'watered';
  addedAt: string;
  lastWateredAt: string | null;
}

export interface Task {
  id: string;
  plantId: string;
  requesterId: string;
  requesterName: string;
  accepterId: string | null;
  accepterName: string | null;
  startDate: string;
  endDate: string;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  createdAt: string;
}

export type WateringType = 'water' | 'fertilize' | 'repot';

export interface WateringRecord {
  id: string;
  plantId: string;
  type: WateringType;
  operatorName: string;
  photos: string[];
  note: string;
  timestamp: string;
}

export interface PlantCreate {
  name: string;
  species: string;
  icon: string;
  image: string;
}

export interface TaskCreate {
  plantId: string;
  requesterId: string;
  requesterName: string;
  startDate: string;
  endDate: string;
}

export interface TaskUpdate {
  status?: 'accepted' | 'completed' | 'cancelled';
  accepterId?: string;
  accepterName?: string;
}

export interface WateringRecordCreate {
  plantId: string;
  type: WateringType;
  operatorName: string;
  photos?: string[];
  note?: string;
}
