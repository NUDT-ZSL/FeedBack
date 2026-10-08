import { RepairRegion } from '@/types';

export const REPAIR_THRESHOLD = 1;
export const REPAIR_RATE_PER_SECOND = 0.8;

export const initialRepairRegions: RepairRegion[] = [
  {
    id: 'region-1',
    type: 'patina',
    position: [0, 0.5, 0.8],
    radius: 0.35,
    status: 'pending',
    progress: 0,
    requiredTool: 'brush',
    description: '鼎腹正面铜绿覆盖区',
  },
  {
    id: 'region-2',
    type: 'patina',
    position: [0, 0.5, -0.8],
    radius: 0.35,
    status: 'pending',
    progress: 0,
    requiredTool: 'brush',
    description: '鼎腹背面铜绿覆盖区',
  },
  {
    id: 'region-3',
    type: 'rust',
    position: [0.55, 0.85, 0],
    radius: 0.25,
    status: 'pending',
    progress: 0,
    requiredTool: 'sandpaper',
    description: '右鼎耳锈蚀区域',
  },
  {
    id: 'region-4',
    type: 'rust',
    position: [-0.55, 0.85, 0],
    radius: 0.25,
    status: 'pending',
    progress: 0,
    requiredTool: 'sandpaper',
    description: '左鼎耳锈蚀区域',
  },
  {
    id: 'region-5',
    type: 'engraving',
    position: [0.3, 0.55, 0.82],
    radius: 0.28,
    status: 'pending',
    progress: 0,
    requiredTool: 'chisel',
    description: '兽面纹右侧缺失',
  },
  {
    id: 'region-6',
    type: 'engraving',
    position: [-0.3, 0.55, 0.82],
    radius: 0.28,
    status: 'pending',
    progress: 0,
    requiredTool: 'chisel',
    description: '兽面纹左侧缺失',
  },
  {
    id: 'region-7',
    type: 'missing',
    position: [0.55, -0.1, 0],
    radius: 0.2,
    status: 'pending',
    progress: 0,
    requiredTool: 'putty',
    description: '右鼎足缺口修复',
  },
  {
    id: 'region-8',
    type: 'missing',
    position: [-0.55, -0.1, 0],
    radius: 0.2,
    status: 'pending',
    progress: 0,
    requiredTool: 'putty',
    description: '左鼎足缺口修复',
  },
];

export const calculateCompletionRate = (regions: RepairRegion[]): number => {
  if (regions.length === 0) return 0;
  const total = regions.reduce(
    (sum, region) => sum + (region.status === 'completed' ? 1 : region.progress),
    0,
  );
  return Math.round((total / regions.length) * 100);
};
