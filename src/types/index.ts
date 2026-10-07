export type ToolType = 'brush' | 'chisel' | 'putty' | 'sandpaper';

export type RegionType = 'patina' | 'engraving' | 'missing' | 'rust';

export type RepairStatus = 'pending' | 'in-progress' | 'completed';

export interface Tool {
  id: string;
  type: ToolType;
  name: string;
  description: string;
  color: string;
  applicableRegions: RegionType[];
}

export interface RepairRegion {
  id: string;
  type: RegionType;
  position: [number, number, number];
  radius: number;
  status: RepairStatus;
  requiredTool: ToolType;
  description: string;
}

export interface RepairRecord {
  id: string;
  timestamp: number;
  toolType: ToolType;
  regionId: string;
  regionType: RegionType;
  description: string;
  beforeImage?: string;
  afterImage?: string;
}

export interface RepairState {
  regions: RepairRegion[];
  records: RepairRecord[];
  selectedTool: ToolType | null;
  isDragging: boolean;
  dragPosition: { x: number; y: number } | null;
  showScrollViewer: boolean;
  completionRate: number;
  errorRegionId: string | null;
  glowRegionId: string | null;
}

export interface AnimationState {
  type: 'repair' | 'glow' | 'error' | null;
  regionId: string | null;
  progress: number;
}
