import { Tool } from '@/types';

export const tools: Tool[] = [
  {
    id: 'tool-brush',
    type: 'brush',
    name: '毛刷',
    description: '用于清理鼎身表面的铜绿锈迹，轻扫即可去除绿色氧化层',
    color: '#c0a080',
    applicableRegions: ['patina'],
  },
  {
    id: 'tool-chisel',
    type: 'chisel',
    name: '刻刀',
    description: '用于摹刻缺失的纹饰线条，重现兽面纹的精细图案',
    color: '#a0a0a0',
    applicableRegions: ['engraving'],
  },
  {
    id: 'tool-putty',
    type: 'putty',
    name: '补土',
    description: '用于填补鼎身的残缺缺口，修复破损的部位',
    color: '#d2b48c',
    applicableRegions: ['missing'],
  },
  {
    id: 'tool-sandpaper',
    type: 'sandpaper',
    name: '细砂纸',
    description: '用于打磨锈蚀严重的区域，去除顽固的褐色锈斑',
    color: '#9e8c6c',
    applicableRegions: ['rust'],
  },
];

export const getToolName = (type: string): string => {
  const tool = tools.find(t => t.type === type);
  return tool?.name || type;
};

export const getRegionTypeName = (type: string): string => {
  const names: Record<string, string> = {
    patina: '铜绿层',
    engraving: '纹饰区',
    missing: '残缺处',
    rust: '锈蚀区',
  };
  return names[type] || type;
};
