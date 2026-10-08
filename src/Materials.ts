import { createId } from './lib/id.ts'
import { resetAssembly } from './Assembly.ts'

export interface WoodMaterial {
  id: string
  name: string
  texture: 'straight' | 'wave' | 'oxhair' | 'gold'
  color: string
  weight: number
  hardness: number
  toughness: number
  selected: boolean
}

const woodMaterials: WoodMaterial[] = [
  {
    id: createId(),
    name: '直纹紫檀',
    texture: 'straight',
    color: '#4a1c0e',
    weight: 85,
    hardness: 92,
    toughness: 78,
    selected: false
  },
  {
    id: createId(),
    name: '水波纹紫檀',
    texture: 'wave',
    color: '#5c2313',
    weight: 88,
    hardness: 88,
    toughness: 85,
    selected: false
  },
  {
    id: createId(),
    name: '牛毛纹紫檀',
    texture: 'oxhair',
    color: '#6b2a16',
    weight: 90,
    hardness: 95,
    toughness: 80,
    selected: false
  },
  {
    id: createId(),
    name: '金星纹紫檀',
    texture: 'gold',
    color: '#7a2c14',
    weight: 92,
    hardness: 90,
    toughness: 82,
    selected: false
  }
]

export function getMaterials(): WoodMaterial[] {
  return [...woodMaterials]
}

/**
 * 选择木料。任何成功的重选都视为开始一个新项目：
 * 先清空旧选择并复位加工/组装状态，再标记新木料，
 * 避免上一轮的加工进度与组装结果残留。
 * 传入不存在的 id 时不产生任何副作用。
 */
export function selectMaterial(id: string): WoodMaterial | null {
  const material = woodMaterials.find(m => m.id === id)
  if (!material) return null
  resetAssembly()
  woodMaterials.forEach(m => m.selected = false)
  material.selected = true
  return { ...material }
}

export function getSelectedMaterial(): WoodMaterial | null {
  return woodMaterials.find(m => m.selected) || null
}

export function clearSelection(): void {
  woodMaterials.forEach(m => m.selected = false)
}
