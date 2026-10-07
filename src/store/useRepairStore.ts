import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { RepairState, RepairRegion, RepairRecord, ToolType } from '@/types';
import { initialRepairRegions, calculateCompletionRate } from '@/utils/repairRegions';
import { getToolName, getRegionTypeName } from '@/utils/tools';

interface RepairActions {
  setSelectedTool: (tool: ToolType | null) => void;
  setIsDragging: (dragging: boolean) => void;
  setDragPosition: (pos: { x: number; y: number } | null) => void;
  setShowScrollViewer: (show: boolean) => void;
  setErrorRegionId: (id: string | null) => void;
  setGlowRegionId: (id: string | null) => void;
  completeRegion: (regionId: string, toolType: ToolType) => void;
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

  setSelectedTool: (tool) => set({ selectedTool: tool }),
  setIsDragging: (dragging) => set({ isDragging: dragging }),
  setDragPosition: (pos) => set({ dragPosition: pos }),
  setShowScrollViewer: (show) => set({ showScrollViewer: show }),
  setErrorRegionId: (id) => set({ errorRegionId: id }),
  setGlowRegionId: (id) => set({ glowRegionId: id }),

  completeRegion: (regionId, toolType) => {
    const { regions } = get();
    const region = regions.find(r => r.id === regionId);
    if (!region || region.status === 'completed') return;

    const updatedRegions = regions.map(r =>
      r.id === regionId ? { ...r, status: 'completed' as const } : r
    );

    set({
      regions: updatedRegions,
      completionRate: calculateCompletionRate(updatedRegions),
    });

    get().addRepairRecord(region, toolType);
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

  resetRepair: () => set({
    regions: initialRepairRegions.map(r => ({ ...r, status: 'pending' as const })),
    records: [],
    selectedTool: null,
    isDragging: false,
    dragPosition: null,
    showScrollViewer: false,
    completionRate: 0,
    errorRegionId: null,
    glowRegionId: null,
  }),
}));
