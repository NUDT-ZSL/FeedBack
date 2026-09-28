export interface CareLog {
  id: string;
  date: string;
  activityType: 'water' | 'fertilize' | 'prune';
  notes: string;
}

export interface Plant {
  id: string;
  name: string;
  species: string;
  photoFileName?: string;
  logs: CareLog[];
  createdAt: string;
}
