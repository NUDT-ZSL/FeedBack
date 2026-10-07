export interface Material {
  id: string;
  name: string;
  color: string;
  gradient: string;
  description: string;
  ratio: number;
}

export interface InkIngot {
  id: string;
  materials: Material[];
  poundingCount: number;
  moldType: MoldType;
  dryingProgress: number;
  isCompleted: boolean;
  createdAt: number;
  dryingStartTime?: number;
}

export type MoldType = 'circle' | 'rectangle' | 'ruyi' | 'dragon';

export type Stage = 'material' | 'pounding' | 'molding' | 'drying';

export interface Store {
  materials: Material[];
  poundingCount: number;
  selectedMold: MoldType | null;
  currentStage: Stage;
  inkIngots: InkIngot[];
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
}

export const MATERIALS_DATA: Omit<Material, 'ratio'>[] = [
  {
    id: 'pine',
    name: '松烟',
    color: '#2a2a2a',
    gradient: 'linear-gradient(135deg, #2a2a2a 0%, #4a4a4a 100%)',
    description: '松木烧制之烟，色黑质轻'
  },
  {
    id: 'tung',
    name: '桐油',
    color: '#c8a96a',
    gradient: 'linear-gradient(135deg, #c8a96a 0%, #e8c98a 100%)',
    description: '桐树籽榨取之油，增亮固色'
  },
  {
    id: 'musk',
    name: '麝香',
    color: '#8b4513',
    gradient: 'linear-gradient(135deg, #8b4513 0%, #a0522d 100%)',
    description: '名贵香料，香气持久'
  },
  {
    id: 'borneol',
    name: '冰片',
    color: '#e0e0e0',
    gradient: 'linear-gradient(135deg, #e0e0e0 0%, #ffffff 100%)',
    description: '龙脑香，清凉提神'
  },
  {
    id: 'glue',
    name: '牛皮胶',
    color: '#d2b48c',
    gradient: 'linear-gradient(135deg, #d2b48c 0%, #deb887 100%)',
    description: '牛皮熬制之胶，黏合固形'
  }
];

export const MOLDS_DATA: { id: MoldType; name: string; shape: string }[] = [
  { id: 'circle', name: '圆形墨锭', shape: '◯' },
  { id: 'rectangle', name: '长方形墨锭', shape: '▢' },
  { id: 'ruyi', name: '如意形', shape: '♡' },
  { id: 'dragon', name: '龙纹形', shape: '🐉' }
];
