import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { RepairState, RepairRegion, RepairRecord, ToolType } from '@/types';
import {
  initialRepairRegions,
  calculateCompletionRate,
  REPAIR_DURATION_SECONDS,
  COMPLETE_THRESHOLD,
} from '@/utils/repairRegions';
import { getToolName, getRegionTypeName } from '@/utils/tools';

interface RepairActions {
  setSelectedTool: (tool: ToolType | null) => void;
  startDrag: () => void;
  endDrag: () => void;
  setDragPosition: (pos: { x: number; y: number } | null) => void;
  setShowScrollViewer: (show: boolean) => void;
  pressRegion: (regionId: string) => void;
  enterRegion: (regionId: string) => void;
  advanceRegion: (regionId: string, deltaSeconds: number) => void;
  settleRegion: (regionId: string) => void;
  addRepairRecord: (region: RepairRegion, toolType: ToolType) => void;
  resetRepair: () => void;
}

const generateRepairDescription = (region: RepairRegion, toolType: ToolType): string => {
  const toolName = getToolName(toolType);
  const regionTypeName = getRegionTypeName(region.type);
  const descriptions: Record<string, string[]> = {
    patina: [
      `手执${toolName}，轻拂${region.description}，千年铜绿渐次剥落，青铜本色重现光华。`,
      `以${toolName}扫去${regionTypeName}，岁月沉淀的绿色氧化层随风而逝，鼎身初露古朴色泽。`,
    ],
    rust: [
      `以${toolName}打磨${region.description}，褐色锈斑层层脱落，金属质感逐渐显露。`,
      `${toolName}轻磨${regionTypeName}，锈蚀尽去，鼎耳恢复古朴庄重之气。`,
    ],
    engraving: [
      `执${toolName}摹刻${region.description}，线条婉转流畅，兽面纹神韵重现。`,
      `以${toolName}复刻${regionTypeName}，一笔一画皆遵古法，纹饰精严古朴。`,
    ],
    missing: [
      `调${toolName}填补${region.description}，残缺之处渐趋完整，鼎身恢复旧观。`,
      `以${toolName}修补${regionTypeName}，工艺精细，天衣无缝，古器重焕光彩。`,
    ],
  };
  const options = descriptions[region.type] || [`使用${toolName}修复${region.description}。`];
  return options[Math.floor(Math.random() * options.length)];
};

let errorTimer: ReturnType<typeof setTimeout> | null = null;
let glowTimer: ReturnType<typeof setTimeout> | null = null;

export const useRepairStore = create<RepairState & RepairActions>((set, get) => ({
  regions: initialRepairRegions,
  records: [],
  selectedTool: null,
  isDragging: false,
  dragPosition: null,
  showScrollViewer: false,
  completionRate: 0,
  errorRegionId: null,
  glowRegionId: null,

  setSelectedTool: (tool) => {
    if (get().isDragging) return;
    set({ selectedTool: tool });
  },

  startDrag: () => set(state => (state.isDragging ? {} : { isDragging: true })),

  endDrag: () => {
    const { regions, isDragging } = get();
    if (!isDragging) return;
    regions
      .filter(r => r.status === 'in-progress')
      .forEach(r => get().settleRegion(r.id));
    set({ isDragging: false, dragPosition: null });
  },

  setDragPosition: (pos) => set({ dragPosition: pos }),
  setShowScrollViewer: (show) => set({ showScrollViewer: show }),

  pressRegion: (regionId) => {
    if (!get().selectedTool) return;
    get().startDrag();
    get().enterRegion(regionId);
  },

  enterRegion: (regionId) => {
    const { regions, isDragging, selectedTool } = get();
    const region = regions.find(r => r.id === regionId);
    if (!isDragging || !selectedTool || !region || region.status !== 'pending') return;

    if (region.requiredTool === selectedTool) {
      const updatedRegions = regions.map(r =>
        r.id === regionId ? { ...r, status: 'in-progress' as const } : r
      );
      set({ regions: updatedRegions });
      return;
    }

    if (errorTimer) clearTimeout(errorTimer);
    set({ errorRegionId: regionId });
    errorTimer = setTimeout(() => set({ errorRegionId: null }), 1000);
  },

  advanceRegion: (regionId, deltaSeconds) => {
    const { regions } = get();
    const region = regions.find(r => r.id === regionId);
    if (!region || region.status !== 'in-progress') return;

    const progress = Math.min(1, region.progress + deltaSeconds / REPAIR_DURATION_SECONDS);
    const updatedRegions = regions.map(r =>
      r.id === regionId ? { ...r, progress } : r
    );
    set({
      regions: updatedRegions,
      completionRate: calculateCompletionRate(updatedRegions),
    });
  },

  settleRegion: (regionId) => {
    const { regions, selectedTool } = get();
    const region = regions.find(r => r.id === regionId);
    if (!region || region.status !== 'in-progress') return;

    const completed = region.progress >= COMPLETE_THRESHOLD;
    const updatedRegions = regions.map(r =>
      r.id === regionId
        ? completed
          ? { ...r, status: 'completed' as const, progress: 1 }
          : { ...r, status: 'pending' as const, progress: 0 }
        : r
    );
    set({
      regions: updatedRegions,
      completionRate: calculateCompletionRate(updatedRegions),
    });

    if (completed && selectedTool) {
      const completedRegion = { ...region, status: 'completed' as const, progress: 1 };
      get().addRepairRecord(completedRegion, selectedTool);

      if (glowTimer) clearTimeout(glowTimer);
      set({ glowRegionId: regionId });
      glowTimer = setTimeout(() => set({ glowRegionId: null }), 1000);
    }
  },

  addRepairRecord: (region, toolType) => {
    const record: RepairRecord = {
      id: uuidv4(),
      timestamp: Date.now(),
      toolType,
      regionId: region.id,
      regionType: region.type,
      description: generateRepairDescription(region, toolType),
    };

    set(state => ({
      records: [...state.records, record],
    }));
  },

  resetRepair: () => {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    if (glowTimer) {
      clearTimeout(glowTimer);
      glowTimer = null;
    }
    set({
    regions: initialRepairRegions.map(r => ({ ...r, status: 'pending' as const, progress: 0 })),
    records: [],
    selectedTool: null,
    isDragging: false,
    dragPosition: null,
    showScrollViewer: false,
    completionRate: 0,
    errorRegionId: null,
    glowRegionId: null,
    });
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __repairStore?: typeof useRepairStore }).__repairStore = useRepairStore;
}
