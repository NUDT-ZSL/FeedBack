import { Color, Vector3 } from 'three'

export type LanternType = 'blessing' | 'message' | 'celebration' | 'love' | 'peace'

export interface LanternConfig {
  type: LanternType
  name: string
  color: string
  maxHeight: number
  glowRadius: number
  loadCapacity: number
}

export interface LanternInstance {
  id: string
  type: LanternType
  position: Vector3
  targetHeight: number
  currentHeight: number
  state: 'idle' | 'hovering' | 'ignited' | 'rising' | 'floating' | 'falling' | 'fallen'
  igniteTime: number | null
  fallTime: number | null
  glowIntensity: number
  swayOffset: number
}

export interface LampData {
  id: string
  position: Vector3
  color: Color
  glowRadius: number
}

export const LANTERN_CONFIGS: Record<LanternType, LanternConfig> = {
  blessing: {
    type: 'blessing',
    name: '祈福灯',
    color: '#ff4444',
    maxHeight: 8,
    glowRadius: 2,
    loadCapacity: 8,
  },
  message: {
    type: 'message',
    name: '传讯灯',
    color: '#ffcc00',
    maxHeight: 10,
    glowRadius: 1.8,
    loadCapacity: 10,
  },
  celebration: {
    type: 'celebration',
    name: '庆贺灯',
    color: '#4488ff',
    maxHeight: 9,
    glowRadius: 2.2,
    loadCapacity: 9,
  },
  love: {
    type: 'love',
    name: '姻缘灯',
    color: '#ff88cc',
    maxHeight: 7,
    glowRadius: 2.5,
    loadCapacity: 7,
  },
  peace: {
    type: 'peace',
    name: '平安灯',
    color: '#ffffff',
    maxHeight: 9.5,
    glowRadius: 1.5,
    loadCapacity: 9.5,
  },
}
