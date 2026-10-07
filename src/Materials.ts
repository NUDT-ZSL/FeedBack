import { v4 as uuidv4 } from 'uuid'

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
    id: uuidv4(),
    name: '直纹紫檀',
    texture: 'straight',
    color: '#4a1c0e',
    weight: 85,
    hardness: 92,
    toughness: 78,
    selected: false
  },
  {
    id: uuidv4(),
    name: '水波纹紫檀',
    texture: 'wave',
    color: '#5c2313',
    weight: 88,
    hardness: 88,
    toughness: 85,
    selected: false
  },
  {
    id: uuidv4(),
    name: '牛毛纹紫檀',
    texture: 'oxhair',
    color: '#6b2a16',
    weight: 90,
    hardness: 95,
    toughness: 80,
    selected: false
  },
  {
    id: uuidv4(),
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

export function selectMaterial(id: string): WoodMaterial | null {
  woodMaterials.forEach(m => m.selected = false)
  const material = woodMaterials.find(m => m.id === id)
  if (material) {
    material.selected = true
    return { ...material }
  }
  return null
}

export function getSelectedMaterial(): WoodMaterial | null {
  return woodMaterials.find(m => m.selected) || null
}

export function clearSelection(): void {
  woodMaterials.forEach(m => m.selected = false)
}
