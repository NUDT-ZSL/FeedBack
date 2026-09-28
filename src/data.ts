import { v4 as uuidv4 } from 'uuid';
import type { Plant, User, WateringRecord, Task } from './types';

export const plantSpecies = [
  { name: '绿萝', icon: '🌿' },
  { name: '多肉', icon: '🌵' },
  { name: '吊兰', icon: '🌱' },
  { name: '龟背竹', icon: '🍃' },
  { name: '橡皮树', icon: '🌴' },
  { name: '虎皮兰', icon: '🪴' },
  { name: '发财树', icon: '🌳' },
  { name: '仙人掌', icon: '🌵' },
];

export const plantImages = [
  'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1509423350716-97f9360b4e09?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1463320726281-696a485928c7?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1545241047-6083a3684587?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1512428813834-c702c7702b78?w=400&h=400&fit=crop',
];

export const samplePhotos = [
  'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=200&h=200&fit=crop',
  'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=200&h=200&fit=crop',
  'https://images.unsplash.com/photo-1509423350716-97f9360b4e09?w=200&h=200&fit=crop',
];

export const initialPlants: Plant[] = [
  {
    id: uuidv4(),
    name: '小绿',
    species: '绿萝',
    icon: '🌿',
    image: plantImages[0],
    status: 'needs_water',
    addedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    lastWateredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuidv4(),
    name: '肉包',
    species: '多肉',
    icon: '🌵',
    image: plantImages[1],
    status: 'watered',
    addedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    lastWateredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuidv4(),
    name: '吊吊',
    species: '吊兰',
    icon: '🌱',
    image: plantImages[2],
    status: 'needs_water',
    addedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    lastWateredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuidv4(),
    name: '背背',
    species: '龟背竹',
    icon: '🍃',
    image: plantImages[3],
    status: 'watered',
    addedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    lastWateredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuidv4(),
    name: '橡皮',
    species: '橡皮树',
    icon: '🌴',
    image: plantImages[4],
    status: 'needs_water',
    addedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    lastWateredAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuidv4(),
    name: '虎虎',
    species: '虎皮兰',
    icon: '🪴',
    image: plantImages[5],
    status: 'watered',
    addedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    lastWateredAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
];

export const initialNeighbors: User[] = [
  { id: uuidv4(), name: '小明', avatar: '👨', creditScore: 98, distance: 0.2 },
  { id: uuidv4(), name: '小红', avatar: '👩', creditScore: 95, distance: 0.3 },
  { id: uuidv4(), name: '老王', avatar: '🧔', creditScore: 92, distance: 0.5 },
  { id: uuidv4(), name: '阿花', avatar: '👧', creditScore: 88, distance: 0.7 },
  { id: uuidv4(), name: '大刘', avatar: '👨‍🦱', creditScore: 85, distance: 1.0 },
];

function daysAgo(days: number, hours: number = 0): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000).toISOString();
}

export const initialWateringRecords: WateringRecord[] = [
  { id: uuidv4(), plantId: initialPlants[0].id, type: 'water', operatorName: '小明', photos: [samplePhotos[0]], note: '浇透了，土壤湿润', timestamp: daysAgo(3) },
  { id: uuidv4(), plantId: initialPlants[0].id, type: 'fertilize', operatorName: '我', photos: [], note: '施了缓释肥', timestamp: daysAgo(10) },
  { id: uuidv4(), plantId: initialPlants[0].id, type: 'water', operatorName: '我', photos: [samplePhotos[1]], note: '正常浇水', timestamp: daysAgo(7) },
  { id: uuidv4(), plantId: initialPlants[1].id, type: 'water', operatorName: '我', photos: [samplePhotos[2]], note: '少量浇水', timestamp: daysAgo(1) },
  { id: uuidv4(), plantId: initialPlants[1].id, type: 'repot', operatorName: '我', photos: [samplePhotos[0], samplePhotos[1]], note: '换了新盆和营养土', timestamp: daysAgo(15) },
  { id: uuidv4(), plantId: initialPlants[2].id, type: 'water', operatorName: '小红', photos: [], note: '浇水完毕', timestamp: daysAgo(5) },
  { id: uuidv4(), plantId: initialPlants[2].id, type: 'water', operatorName: '我', photos: [samplePhotos[2]], note: '', timestamp: daysAgo(10) },
  { id: uuidv4(), plantId: initialPlants[3].id, type: 'water', operatorName: '老王', photos: [samplePhotos[0], samplePhotos[1], samplePhotos[2]], note: '叶子擦干净了', timestamp: daysAgo(2) },
  { id: uuidv4(), plantId: initialPlants[3].id, type: 'fertilize', operatorName: '我', photos: [], note: '液肥稀释浇灌', timestamp: daysAgo(12) },
  { id: uuidv4(), plantId: initialPlants[4].id, type: 'water', operatorName: '我', photos: [samplePhotos[1]], note: '', timestamp: daysAgo(4) },
  { id: uuidv4(), plantId: initialPlants[4].id, type: 'water', operatorName: '阿花', photos: [], note: '浇了约200ml', timestamp: daysAgo(8) },
  { id: uuidv4(), plantId: initialPlants[5].id, type: 'water', operatorName: '我', photos: [samplePhotos[0]], note: '', timestamp: daysAgo(0, 12) },
  { id: uuidv4(), plantId: initialPlants[5].id, type: 'repot', operatorName: '我', photos: [samplePhotos[2], samplePhotos[1]], note: '分株了两棵小苗', timestamp: daysAgo(20) },
];

const now = new Date();
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

export const initialTasks: Task[] = [
  {
    id: uuidv4(),
    plantId: initialPlants[0].id,
    requesterId: 'me',
    requesterName: '我',
    accepterId: initialNeighbors[0].id,
    accepterName: initialNeighbors[0].name,
    startDate: tomorrow.toISOString().split('T')[0],
    endDate: nextWeek.toISOString().split('T')[0],
    status: 'accepted',
    createdAt: now.toISOString(),
  },
];
