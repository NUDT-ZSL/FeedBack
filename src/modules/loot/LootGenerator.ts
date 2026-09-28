import type { LootItem, ItemQuality } from '@/modules/shared/types'
import { LOOT_DATABASE, BOSS_LIST } from '@/assets/mock/lootDatabase'

export class LootGenerator {
  generateLoot(bossName?: string): LootItem[] {
    const itemCount = Math.floor(Math.random() * 3) + 3
    const loot: LootItem[] = []
    const currentBoss = bossName || this.getRandomBoss()

    for (let i = 0; i < itemCount; i++) {
      const quality = this.rollQuality()
      const availableItems = LOOT_DATABASE.filter(item => item.quality === quality)

      if (availableItems.length === 0) continue

      const randomTemplate = availableItems[Math.floor(Math.random() * availableItems.length)]

      loot.push({
        id: this.generateId(),
        name: randomTemplate.name,
        slot: randomTemplate.slot,
        quality: randomTemplate.quality,
        baseDkp: randomTemplate.baseDkp,
        stats: { ...randomTemplate.stats },
        bossName: currentBoss
      })
    }

    return loot
  }

  private rollQuality(): ItemQuality {
    const roll = Math.random() * 100
    if (roll < 10) return 'epic'
    if (roll < 40) return 'rare'
    return 'uncommon'
  }

  private getRandomBoss(): string {
    return BOSS_LIST[Math.floor(Math.random() * BOSS_LIST.length)]
  }

  private generateId(): string {
    return `loot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

export const lootGenerator = new LootGenerator()
