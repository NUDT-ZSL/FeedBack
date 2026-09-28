import type { Player, LootItem, AllocationRecord, Bid, AllocationResult, AllocationMode } from '@/modules/shared/types'

export class DkpAllocator {
  private allocationHistory: AllocationRecord[] = []

  allocateByBidding(item: LootItem, bids: Bid[], players: Player[]): AllocationResult & { record?: AllocationRecord } {
    const validBids = bids.filter(b => {
      const player = players.find(p => p.id === b.playerId)
      return player && player.dkp >= b.amount && b.amount > 0
    })

    if (validBids.length === 0) {
      return { success: false }
    }

    const winnerBid = validBids.reduce((max, curr) =>
      curr.amount > max.amount ? curr : max
    )

    const winner = players.find(p => p.id === winnerBid.playerId)!
    winner.dkp -= winnerBid.amount

    const record: AllocationRecord = {
      id: this.generateId(),
      timestamp: Date.now(),
      bossName: item.bossName,
      item: { ...item },
      winner: { ...winner },
      mode: 'bidding',
      bidAmount: winnerBid.amount
    }

    this.allocationHistory.unshift(record)

    return {
      success: true,
      winner,
      dkpSpent: winnerBid.amount,
      record
    }
  }

  allocateByRoll(item: LootItem, eligiblePlayers: Player[]): AllocationResult & { record?: AllocationRecord; rolls?: Array<{ playerId: string; roll: number }> } {
    if (eligiblePlayers.length === 0) {
      return { success: false }
    }

    const rolls = eligiblePlayers.map(p => ({
      playerId: p.id,
      roll: Math.floor(Math.random() * 100) + 1
    }))

    const winnerRoll = rolls.reduce((max, curr) =>
      curr.roll > max.roll ? curr : max
    )

    const winner = eligiblePlayers.find(p => p.id === winnerRoll.playerId)!
    winner.dkp = Math.max(0, winner.dkp - item.baseDkp)

    const record: AllocationRecord = {
      id: this.generateId(),
      timestamp: Date.now(),
      bossName: item.bossName,
      item: { ...item },
      winner: { ...winner },
      mode: 'rolling',
      rollAmount: winnerRoll.roll
    }

    this.allocationHistory.unshift(record)

    return {
      success: true,
      winner,
      dkpSpent: item.baseDkp,
      roll: winnerRoll.roll,
      rolls,
      record
    }
  }

  getHistory(): AllocationRecord[] {
    return [...this.allocationHistory]
  }

  filterHistory(playerClass?: string, startDate?: number, endDate?: number): AllocationRecord[] {
    return this.allocationHistory.filter(record => {
      if (playerClass && record.winner.playerClass !== playerClass) return false
      if (startDate && record.timestamp < startDate) return false
      if (endDate && record.timestamp > endDate) return false
      return true
    })
  }

  exportToCSV(records?: AllocationRecord[]): string {
    const data = records || this.allocationHistory
    const headers = ['日期', 'Boss', '物品', '品质', '中标者', '职业', '分配模式', '出价/点数', '消耗DKP']

    const rows = data.map(record => {
      const date = new Date(record.timestamp).toLocaleString('zh-CN')
      const mode = record.mode === 'bidding' ? '竞价' : 'Roll点'
      const amount = record.mode === 'bidding' ? record.bidAmount : record.rollAmount
      return [
        date,
        record.bossName,
        record.item.name,
        record.item.quality,
        record.winner.name,
        record.winner.playerClass,
        mode,
        amount,
        record.mode === 'bidding' ? record.bidAmount : record.item.baseDkp
      ].join(',')
    })

    return [headers.join(','), ...rows].join('\n')
  }

  setHistory(history: AllocationRecord[]): void {
    this.allocationHistory = [...history]
  }

  private generateId(): string {
    return `record_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

export const dkpAllocator = new DkpAllocator()
