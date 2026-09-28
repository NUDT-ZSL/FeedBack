import type { Player, PlayerClass } from '@/modules/shared/types'

export class PlayerManager {
  private players: Player[] = []

  addPlayer(name: string, playerClass: PlayerClass, initialDkp: number): Player {
    const player: Player = {
      id: this.generateId(),
      name,
      playerClass,
      dkp: initialDkp,
      gearScore: Math.floor(Math.random() * 30) + 70,
      demandHistory: []
    }
    this.players.push(player)
    return player
  }

  updatePlayer(id: string, updates: Partial<Pick<Player, 'name' | 'playerClass' | 'dkp'>>): boolean {
    const player = this.players.find(p => p.id === id)
    if (!player) return false

    if (updates.name !== undefined) player.name = updates.name
    if (updates.playerClass !== undefined) player.playerClass = updates.playerClass
    if (updates.dkp !== undefined) player.dkp = updates.dkp

    return true
  }

  removePlayer(id: string): boolean {
    const index = this.players.findIndex(p => p.id === id)
    if (index === -1) return false
    this.players.splice(index, 1)
    return true
  }

  getPlayers(): Player[] {
    return [...this.players]
  }

  getPlayerById(id: string): Player | undefined {
    return this.players.find(p => p.id === id)
  }

  addDemandRecord(playerId: string, itemName: string): boolean {
    const player = this.players.find(p => p.id === playerId)
    if (!player) return false
    player.demandHistory.push(itemName)
    return true
  }

  adjustDkp(playerId: string, amount: number): boolean {
    const player = this.players.find(p => p.id === playerId)
    if (!player) return false
    player.dkp = Math.max(0, player.dkp + amount)
    return true
  }

  setPlayers(players: Player[]): void {
    this.players = [...players]
  }

  private generateId(): string {
    return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

export const playerManager = new PlayerManager()
