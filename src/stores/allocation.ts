import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Player, LootItem, AllocationRecord, Bid, AllocationMode, PlayerClass } from '@/modules/shared/types'
import { playerManager } from '@/modules/player/PlayerManager'
import { lootGenerator } from '@/modules/loot/LootGenerator'
import { dkpAllocator } from '@/modules/dkp/DkpAllocator'
import { PLAYER_CLASS_COLORS } from '@/modules/shared/types'

export const useAllocationStore = defineStore('allocation', () => {
  const players = ref<Player[]>([])
  const currentLoot = ref<LootItem[]>([])
  const currentBoss = ref('')
  const allocationHistory = ref<AllocationRecord[]>([])
  const allocationMode = ref<AllocationMode>('rolling')
  const selectedItem = ref<LootItem | null>(null)
  const bids = ref<Bid[]>([])
  const showResultModal = ref(false)
  const lastAllocationResult = ref<{
    success: boolean
    winner?: Player
    dkpSpent?: number
    roll?: number
    item?: LootItem
  } | null>(null)
  const showHistoryPanel = ref(false)
  const rolls = ref<Array<{ playerId: string; roll: number }>>([])

  const classDkpStats = computed(() => {
    const stats: Record<string, number> = {}
    players.value.forEach(player => {
      if (!stats[player.playerClass]) {
        stats[player.playerClass] = 0
      }
      stats[player.playerClass] += player.dkp
    })
    return stats
  })

  const chartData = computed(() => {
    const labels = Object.keys(classDkpStats.value)
    const data = Object.values(classDkpStats.value)
    const colors = labels.map(cls => PLAYER_CLASS_COLORS[cls as PlayerClass] || '#888888')

    return {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#16213e',
        hoverOffset: 8
      }]
    }
  })

  function addPlayer(name: string, playerClass: PlayerClass, initialDkp: number) {
    const player = playerManager.addPlayer(name, playerClass, initialDkp)
    players.value = playerManager.getPlayers()
    return player
  }

  function updatePlayer(id: string, updates: Partial<Pick<Player, 'name' | 'playerClass' | 'dkp'>>) {
    const success = playerManager.updatePlayer(id, updates)
    if (success) {
      players.value = playerManager.getPlayers()
    }
    return success
  }

  function removePlayer(id: string) {
    const success = playerManager.removePlayer(id)
    if (success) {
      players.value = playerManager.getPlayers()
    }
    return success
  }

  function startRaid(bossName?: string) {
    currentBoss.value = bossName || ''
    currentLoot.value = lootGenerator.generateLoot(bossName)
    if (currentLoot.value.length > 0) {
      currentBoss.value = currentLoot.value[0].bossName
    }
    selectedItem.value = null
    bids.value = []
    rolls.value = []
  }

  function selectItem(item: LootItem) {
    selectedItem.value = item
    bids.value = []
    rolls.value = []
  }

  function setBid(playerId: string, amount: number) {
    const existingIndex = bids.value.findIndex(b => b.playerId === playerId)
    if (existingIndex >= 0) {
      bids.value[existingIndex].amount = amount
    } else {
      bids.value.push({ playerId, amount })
    }
  }

  function allocateBidding() {
    if (!selectedItem.value) return { success: false }

    const result = dkpAllocator.allocateByBidding(selectedItem.value, bids.value, players.value)

    if (result.success && result.winner) {
      players.value = playerManager.getPlayers()
      allocationHistory.value = dkpAllocator.getHistory()
      lastAllocationResult.value = {
        success: true,
        winner: result.winner,
        dkpSpent: result.dkpSpent,
        item: selectedItem.value
      }
      showResultModal.value = true

      const index = currentLoot.value.findIndex(i => i.id === selectedItem.value!.id)
      if (index >= 0) {
        currentLoot.value.splice(index, 1)
      }
      selectedItem.value = null
      bids.value = []
    }

    return result
  }

  function allocateRolling() {
    if (!selectedItem.value) return { success: false }

    const eligiblePlayers = players.value.filter(p => p.dkp >= selectedItem.value!.baseDkp)
    const result = dkpAllocator.allocateByRoll(selectedItem.value, eligiblePlayers)

    if (result.success && result.winner) {
      players.value = playerManager.getPlayers()
      allocationHistory.value = dkpAllocator.getHistory()
      rolls.value = result.rolls || []
      lastAllocationResult.value = {
        success: true,
        winner: result.winner,
        dkpSpent: result.dkpSpent,
        roll: result.roll,
        item: selectedItem.value
      }
      showResultModal.value = true

      const index = currentLoot.value.findIndex(i => i.id === selectedItem.value!.id)
      if (index >= 0) {
        currentLoot.value.splice(index, 1)
      }
      selectedItem.value = null
      rolls.value = []
    }

    return result
  }

  function closeResultModal() {
    showResultModal.value = false
    lastAllocationResult.value = null
  }

  function toggleHistoryPanel() {
    showHistoryPanel.value = !showHistoryPanel.value
  }

  function exportHistoryCSV() {
    return dkpAllocator.exportToCSV()
  }

  function filterHistory(playerClass?: string, startDate?: number, endDate?: number) {
    return dkpAllocator.filterHistory(playerClass, startDate, endDate)
  }

  function setAllocationMode(mode: AllocationMode) {
    allocationMode.value = mode
    bids.value = []
    rolls.value = []
  }

  return {
    players,
    currentLoot,
    currentBoss,
    allocationHistory,
    allocationMode,
    selectedItem,
    bids,
    showResultModal,
    lastAllocationResult,
    showHistoryPanel,
    rolls,
    classDkpStats,
    chartData,
    addPlayer,
    updatePlayer,
    removePlayer,
    startRaid,
    selectItem,
    setBid,
    allocateBidding,
    allocateRolling,
    closeResultModal,
    toggleHistoryPanel,
    exportHistoryCSV,
    filterHistory,
    setAllocationMode
  }
})
