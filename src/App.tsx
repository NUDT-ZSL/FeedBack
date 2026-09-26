import { useState, useEffect, useCallback } from 'react'
import GameScene from './modules/battle/GameScene'
import SynthesisPanel from './modules/craft/SynthesisPanel'
import axios from 'axios'

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

const API_BASE = 'http://localhost:3001/api'

function App() {
  const [inventory, setInventory] = useState<Inventory>({ red: 0, blue: 0, green: 0 })
  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [health, setHealth] = useState(100)

  const fetchInventory = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/inventory`)
      setInventory(res.data)
    } catch (err) {
      console.error('Failed to fetch inventory:', err)
    }
  }, [])

  useEffect(() => {
    fetchInventory()
    const interval = setInterval(fetchInventory, 1000)
    return () => clearInterval(interval)
  }, [fetchInventory])

  const handleCraftSuccess = useCallback((newEquipment: Equipment, newInventory: Inventory) => {
    setEquipment(newEquipment)
    setInventory(newInventory)
  }, [])

  const handleDamage = useCallback(() => {
    setHealth(prev => {
      const newHealth = Math.max(0, prev - 10)
      if (newHealth === 0) {
        setTimeout(() => {
          alert('游戏结束！重新开始...')
          setHealth(100)
        }, 100)
      }
      return newHealth
    })
  }, [])

  const healthPercent = (health / 100) * 100
  const healthColor = healthPercent > 50 ? '#00ff00' : healthPercent > 25 ? '#ffff00' : '#ff0000'

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', backgroundColor: '#0b0c10' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <GameScene
          equipment={equipment}
          onDamage={handleDamage}
          onCollectFragment={fetchInventory}
        />
        
        <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>
          <div style={{ color: '#fff', marginBottom: 6, fontSize: 14, fontWeight: 'bold' }}>生命值</div>
          <div style={{
            width: 200,
            height: 12,
            backgroundColor: '#333',
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid #444'
          }}>
            <div style={{
              width: `${healthPercent}%`,
              height: '100%',
              background: `linear-gradient(to right, #00ff00, ${healthColor})`,
              transition: 'width 0.2s ease'
            }} />
          </div>
          <div style={{ color: '#fff', marginTop: 4, fontSize: 12 }}>{health}/100</div>
        </div>

        {equipment && (
          <div style={{ position: 'absolute', top: 20, left: 250, zIndex: 10 }}>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 6 }}>当前装备</div>
            <div style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(31, 31, 46, 0.9)',
              borderRadius: 8,
              border: `2px solid ${equipment.primaryColor}`,
              color: '#fff',
              fontSize: 13
            }}>
              <div style={{ color: equipment.primaryColor, fontWeight: 'bold' }}>{equipment.name}</div>
              <div style={{ fontSize: 11, marginTop: 2, color: '#aaa' }}>
                伤害: {equipment.damage} | 射速: {equipment.fireRate}ms
              </div>
            </div>
          </div>
        )}
      </div>
      
      <SynthesisPanel
        inventory={inventory}
        onCraftSuccess={handleCraftSuccess}
      />
    </div>
  )
}

export default App
