export type FragmentType = 'red' | 'blue' | 'green'

export interface Inventory {
  red: number
  blue: number
  green: number
}

export interface Equipment {
  id: string
  type: string
  name: string
  primaryColor: string
  attackColor: string
  damage: number
  fireRate: number
  specialEffect?: string
}

export interface Recipe {
  id: string
  name: string
  equipmentType: string
  required: Partial<Inventory>
  result: Omit<Equipment, 'id'>
}

export const RECIPES: Recipe[] = [
  {
    id: 'fire_cannon',
    name: '火焰炮',
    equipmentType: 'fire_cannon',
    required: { red: 3 },
    result: {
      type: 'fire_cannon',
      name: '火焰炮',
      primaryColor: '#ff4444',
      attackColor: '#ff6600',
      damage: 25,
      fireRate: 200,
      specialEffect: '高伤害，子弹附带灼烧'
    }
  },
  {
    id: 'frost_shield',
    name: '冰霜护盾',
    equipmentType: 'frost_shield',
    required: { blue: 2, green: 1 },
    result: {
      type: 'frost_shield',
      name: '冰霜护盾',
      primaryColor: '#4488ff',
      attackColor: '#88ccff',
      damage: 15,
      fireRate: 300,
      specialEffect: '减速敌人弹幕，增加防御'
    }
  },
  {
    id: 'thrust_engine',
    name: '推进引擎',
    equipmentType: 'thrust_engine',
    required: { green: 2, red: 1 },
    result: {
      type: 'thrust_engine',
      name: '推进引擎',
      primaryColor: '#44ff44',
      attackColor: '#aaff44',
      damage: 18,
      fireRate: 120,
      specialEffect: '提升移动速度和射速'
    }
  },
  {
    id: 'plasma_blade',
    name: '等离子刃',
    equipmentType: 'plasma_blade',
    required: { red: 2, blue: 2 },
    result: {
      type: 'plasma_blade',
      name: '等离子刃',
      primaryColor: '#ff44ff',
      attackColor: '#ff88ff',
      damage: 30,
      fireRate: 250,
      specialEffect: '发射穿透型子弹'
    }
  }
]

export function canCraft(recipe: Recipe, inventory: Inventory): boolean {
  return Object.entries(recipe.required).every(([color, amount]) => {
    return inventory[color as FragmentType] >= (amount || 0)
  })
}

export function validateRecipe(recipeId: string): Recipe | undefined {
  return RECIPES.find(r => r.id === recipeId)
}

export const FRAGMENT_COLORS: Record<FragmentType, string> = {
  red: '#ff4444',
  blue: '#4488ff',
  green: '#44ff44'
}

export const FRAGMENT_NAMES: Record<FragmentType, string> = {
  red: '红色',
  blue: '蓝色',
  green: '绿色'
}
