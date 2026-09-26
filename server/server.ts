import express, { Request, Response } from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import { RECIPES, validateRecipe, Inventory, Equipment, FragmentType } from '../src/modules/craft/CraftRecipe'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

interface GameState {
  inventory: Inventory
  equipment: Equipment | null
}

const gameState: GameState = {
  inventory: {
    red: 0,
    blue: 0,
    green: 0
  },
  equipment: null
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.get('/api/inventory', (_req: Request, res: Response) => {
  res.json(gameState.inventory)
})

app.get('/api/equipment', (_req: Request, res: Response) => {
  res.json(gameState.equipment)
})

app.get('/api/recipes', (_req: Request, res: Response) => {
  res.json(RECIPES)
})

app.post('/api/collect-fragment', (req: Request, res: Response) => {
  const { type } = req.body

  if (!type || !['red', 'blue', 'green'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid fragment type. Must be "red", "blue", or "green"'
    })
  }

  const fragmentType = type as FragmentType
  gameState.inventory[fragmentType]++

  console.log(`Fragment collected: ${type}, inventory:`, gameState.inventory)

  res.json(gameState.inventory)
})

app.post('/api/craft', (req: Request, res: Response) => {
  const { recipeId } = req.body

  if (!recipeId) {
    return res.status(400).json({
      success: false,
      error: 'recipeId is required'
    })
  }

  const recipe = validateRecipe(recipeId)
  if (!recipe) {
    return res.status(404).json({
      success: false,
      error: `Recipe ${recipeId} not found`
    })
  }

  for (const [color, amount] of Object.entries(recipe.required)) {
    if (gameState.inventory[color as FragmentType] < (amount || 0)) {
      return res.status(400).json({
        success: false,
        error: `Insufficient ${color} fragments. Need ${amount}, have ${gameState.inventory[color as FragmentType]}`
      })
    }
  }

  for (const [color, amount] of Object.entries(recipe.required)) {
    gameState.inventory[color as FragmentType] -= amount || 0
  }

  const newEquipment: Equipment = {
    id: uuidv4(),
    ...recipe.result
  }

  gameState.equipment = newEquipment

  console.log(`Crafted: ${recipe.name}, inventory:`, gameState.inventory)

  res.json({
    success: true,
    equipment: newEquipment,
    inventory: gameState.inventory
  })
})

app.post('/api/reset', (_req: Request, res: Response) => {
  gameState.inventory = { red: 0, blue: 0, green: 0 }
  gameState.equipment = null
  console.log('Game state reset')
  res.json({ success: true, inventory: gameState.inventory })
})

app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║                                                            ║
  ║   弹幕射击与符文合成防御 - 后端服务已启动                  ║
  ║                                                            ║
  ║   服务地址: http://localhost:${PORT}                        ║
  ║                                                            ║
  ║   API 端点:                                                ║
  ║   GET  /api/health          - 健康检查                     ║
  ║   GET  /api/inventory       - 获取碎片库存                 ║
  ║   GET  /api/equipment       - 获取当前装备                 ║
  ║   GET  /api/recipes         - 获取所有配方                 ║
  ║   POST /api/collect-fragment - 收集碎片                    ║
  ║   POST /api/craft           - 合成装备                     ║
  ║   POST /api/reset           - 重置游戏状态                 ║
  ║                                                            ║
  ╚════════════════════════════════════════════════════════════╝
  `)
})
