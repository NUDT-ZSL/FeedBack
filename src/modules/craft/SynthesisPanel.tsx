import { useState } from 'react'
import axios from 'axios'
import { RECIPES, canCraft, FRAGMENT_COLORS, FRAGMENT_NAMES, Recipe, Inventory, Equipment } from './CraftRecipe'

interface SynthesisPanelProps {
  inventory: Inventory
  onCraftSuccess: (equipment: Equipment, inventory: Inventory) => void
}

const API_BASE = 'http://localhost:3001/api'

export default function SynthesisPanel({ inventory, onCraftSuccess }: SynthesisPanelProps) {
  const [craftingId, setCraftingId] = useState<string | null>(null)

  const handleCraft = async (recipe: Recipe) => {
    if (!canCraft(recipe, inventory) || craftingId) return

    setCraftingId(recipe.id)
    try {
      const res = await axios.post(`${API_BASE}/craft`, { recipeId: recipe.id })
      if (res.data.success) {
        onCraftSuccess(res.data.equipment, res.data.inventory)
      }
    } catch (err) {
      console.error('Craft failed:', err)
      alert('合成失败，请检查后端服务是否启动')
    } finally {
      setCraftingId(null)
    }
  }

  return (
    <div style={{
      width: 220,
      backgroundColor: 'rgba(31, 31, 46, 0.95)',
      borderRadius: 8,
      padding: 16,
      height: '100%',
      overflowY: 'auto',
      boxSizing: 'border-box',
      borderLeft: '1px solid #2a2a3e'
    }}>
      <h2 style={{
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 16,
        paddingBottom: 8,
        borderBottom: '1px solid #3a3a4e'
      }}>
        符文合成
      </h2>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ color: '#aaa', fontSize: 13, marginBottom: 10 }}>碎片库存</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['red', 'blue', 'green'] as const).map(color => (
            <div key={color} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6
            }}>
              <div style={{
                width: 20,
                height: 20,
                backgroundColor: FRAGMENT_COLORS[color],
                borderRadius: 4,
                boxShadow: `0 0 8px ${FRAGMENT_COLORS[color]}`
              }} />
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                {inventory[color]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>可合成配方</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {RECIPES.map(recipe => {
            const craftable = canCraft(recipe, inventory)
            const isCrafting = craftingId === recipe.id

            return (
              <div
                key={recipe.id}
                style={{
                  padding: 12,
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  borderRadius: 8,
                  border: `1px solid ${craftable ? recipe.result.primaryColor : '#333'}`,
                  opacity: craftable ? 1 : 0.6
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8
                }}>
                  <span style={{
                    color: craftable ? recipe.result.primaryColor : '#888',
                    fontWeight: 'bold',
                    fontSize: 14
                  }}>
                    {recipe.name}
                  </span>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: recipe.result.primaryColor,
                    boxShadow: craftable ? `0 0 6px ${recipe.result.primaryColor}` : 'none'
                  }} />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>所需材料：</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(recipe.required).map(([color, amount]) => {
                      const hasEnough = inventory[color as keyof Inventory] >= (amount || 0)
                      return (
                        <div key={color} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 6px',
                          backgroundColor: hasEnough ? 'rgba(0,255,0,0.1)' : 'rgba(255,0,0,0.1)',
                          borderRadius: 4
                        }}>
                          <div style={{
                            width: 14,
                            height: 14,
                            backgroundColor: FRAGMENT_COLORS[color as keyof typeof FRAGMENT_COLORS],
                            borderRadius: 2
                          }} />
                          <span style={{
                            color: hasEnough ? '#44ff44' : '#ff4444',
                            fontSize: 11,
                            fontWeight: 'bold'
                          }}>
                            {FRAGMENT_NAMES[color as keyof typeof FRAGMENT_NAMES]} x{amount}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {recipe.result.specialEffect && (
                  <div style={{
                    color: '#666',
                    fontSize: 10,
                    fontStyle: 'italic',
                    marginBottom: 8
                  }}>
                    特效: {recipe.result.specialEffect}
                  </div>
                )}

                <button
                  onClick={() => handleCraft(recipe)}
                  disabled={!craftable || isCrafting}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: craftable ? '#ff9800' : '#666',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 'bold',
                    cursor: craftable && !isCrafting ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s',
                    boxShadow: craftable ? '0 0 12px rgba(255, 152, 0, 0.5)' : 'none'
                  }}
                >
                  {isCrafting ? '合成中...' : craftable ? '点击合成' : '材料不足'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
