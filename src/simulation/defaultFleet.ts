/** 默认船队：gameStore 与离线场景共用，避免两份初始条件漂移 */
import type { ShipData } from './types.ts'

export const DEFAULT_SHIPS: ShipData[] = [
  { id: 'ship1', name: '太平号', type: 'cargo', color: '#c4a35a', cargo: '江南稻米', cargoWeight: 120, draft: 2.8, speed: 1.2, progress: 0.1, navigationStatus: 'normal' },
  { id: 'ship2', name: '春风号', type: 'passenger', color: '#e07b3a', cargo: '商旅旅客', cargoWeight: 45, draft: 1.8, speed: 1.8, progress: 0.3, navigationStatus: 'normal' },
  { id: 'ship3', name: '渔家乐', type: 'fishing', color: '#6b8e6b', cargo: '鲜活水产', cargoWeight: 25, draft: 1.2, speed: 2.2, progress: 0.5, navigationStatus: 'normal' },
  { id: 'ship4', name: '锦绣舫', type: 'pleasure', color: '#c41e3a', cargo: '文人雅集', cargoWeight: 15, draft: 1.5, speed: 0.8, progress: 0.7, navigationStatus: 'normal' },
  { id: 'ship5', name: '广济号', type: 'cargo', color: '#b8956b', cargo: '青瓷瓷器', cargoWeight: 95, draft: 2.5, speed: 1.0, progress: 0.2, navigationStatus: 'normal' },
  { id: 'ship6', name: '顺安号', type: 'passenger', color: '#d6612e', cargo: '赴京学子', cargoWeight: 38, draft: 1.6, speed: 1.5, progress: 0.85, navigationStatus: 'normal' },
]
