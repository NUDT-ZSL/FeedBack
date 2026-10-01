import Phaser from 'phaser';

export interface Mineral {
  id: string;
  name: string;
  basePrice: number;
  color: number;
}

export const MINERALS: Mineral[] = [
  { id: 'iron', name: '铁矿', basePrice: 10, color: 0x808080 },
  { id: 'copper', name: '铜矿', basePrice: 25, color: 0xb87333 },
  { id: 'silver', name: '银矿', basePrice: 60, color: 0xc0c0c0 },
  { id: 'gold', name: '金矿', basePrice: 150, color: 0xffd700 },
  { id: 'platinum', name: '铂金', basePrice: 400, color: 0xe5e4e2 }
];

export interface TradeRecord {
  type: 'sell' | 'buy';
  mineralId: string;
  mineralName: string;
  quantity: number;
  pricePerUnit: number;
  totalValue: number;
  stationName: string;
  timestamp: number;
}

export interface StationInventory {
  [mineralId: string]: number;
}

export interface StationPrices {
  [mineralId: string]: number;
}

export class TradeManager {
  private playerInventory: { [mineralId: string]: number } = {};
  private cargoCapacity: number = 200;
  private stations: Map<string, { inventory: StationInventory; prices: StationPrices; name: string }> = new Map();
  private tradeHistory: TradeRecord[] = [];
  private totalTradeCount: number = 0;
  private totalValue: number = 0;
  private totalMined: number = 0;

  constructor() {
    MINERALS.forEach(m => {
      this.playerInventory[m.id] = 0;
    });
  }

  registerStation(id: string, name: string): void {
    const inventory: StationInventory = {};
    const prices: StationPrices = {};
    MINERALS.forEach(m => {
      inventory[m.id] = Phaser.Math.Between(10, 100);
      prices[m.id] = this.generatePrice(m.basePrice);
    });
    this.stations.set(id, { inventory, prices, name });
  }

  private generatePrice(basePrice: number): number {
    const variance = Phaser.Math.FloatBetween(0.7, 1.4);
    return Math.round(basePrice * variance);
  }

  fluctuatePrices(): void {
    this.stations.forEach(station => {
      MINERALS.forEach(m => {
        const change = Phaser.Math.FloatBetween(0.9, 1.1);
        const newPrice = Math.round(station.prices[m.id] * change);
        const minPrice = Math.round(m.basePrice * 0.5);
        const maxPrice = Math.round(m.basePrice * 2);
        station.prices[m.id] = Phaser.Math.Clamp(newPrice, minPrice, maxPrice);
      });
    });
  }

  addMineral(mineralId: string, amount: number): boolean {
    const currentTotal = this.getTotalCargo();
    const canAdd = Math.min(amount, this.cargoCapacity - currentTotal);
    if (canAdd <= 0) return false;
    this.playerInventory[mineralId] = (this.playerInventory[mineralId] || 0) + canAdd;
    this.totalMined += canAdd;
    return canAdd === amount;
  }

  removeMineral(mineralId: string, amount: number): boolean {
    if ((this.playerInventory[mineralId] || 0) < amount) return false;
    this.playerInventory[mineralId] -= amount;
    return true;
  }

  getPlayerInventory(): { [mineralId: string]: number } {
    return { ...this.playerInventory };
  }

  getTotalCargo(): number {
    return Object.values(this.playerInventory).reduce((sum, v) => sum + v, 0);
  }

  getCargoCapacity(): number {
    return this.cargoCapacity;
  }

  getStationInventory(stationId: string): StationInventory | null {
    const station = this.stations.get(stationId);
    return station ? { ...station.inventory } : null;
  }

  getStationPrices(stationId: string): StationPrices | null {
    const station = this.stations.get(stationId);
    return station ? { ...station.prices } : null;
  }

  getStationName(stationId: string): string | null {
    const station = this.stations.get(stationId);
    return station ? station.name : null;
  }

  sellAll(stationId: string): number {
    const station = this.stations.get(stationId);
    if (!station) return 0;

    let totalEarned = 0;
    MINERALS.forEach(m => {
      const amount = this.playerInventory[m.id] || 0;
      if (amount > 0) {
        const price = station.prices[m.id];
        const value = amount * price;
        totalEarned += value;
        station.inventory[m.id] += amount;
        this.playerInventory[m.id] = 0;
        this.totalTradeCount++;
        this.tradeHistory.unshift({
          type: 'sell',
          mineralId: m.id,
          mineralName: m.name,
          quantity: amount,
          pricePerUnit: price,
          totalValue: value,
          stationName: station.name,
          timestamp: Date.now()
        });
      }
    });

    this.totalValue += totalEarned;
    this.trimHistory();
    return totalEarned;
  }

  buyMineral(stationId: string, mineralId: string, amount: number): number {
    const station = this.stations.get(stationId);
    if (!station) return 0;
    if ((station.inventory[mineralId] || 0) < amount) return 0;

    const space = this.cargoCapacity - this.getTotalCargo();
    const canBuy = Math.min(amount, space);
    if (canBuy <= 0) return 0;

    const price = station.prices[mineralId];
    const cost = canBuy * price;
    station.inventory[mineralId] -= canBuy;
    this.playerInventory[mineralId] = (this.playerInventory[mineralId] || 0) + canBuy;
    this.totalTradeCount++;

    const mineral = MINERALS.find(m => m.id === mineralId)!;
    this.tradeHistory.unshift({
      type: 'buy',
      mineralId,
      mineralName: mineral.name,
      quantity: canBuy,
      pricePerUnit: price,
      totalValue: cost,
      stationName: station.name,
      timestamp: Date.now()
    });

    this.trimHistory();
    return cost;
  }

  private trimHistory(): void {
    if (this.tradeHistory.length > 10) {
      this.tradeHistory = this.tradeHistory.slice(0, 10);
    }
  }

  getTradeHistory(): TradeRecord[] {
    return [...this.tradeHistory];
  }

  getTotalValue(): number {
    return this.totalValue;
  }

  getInventoryValue(): number {
    let value = 0;
    MINERALS.forEach(m => {
      value += (this.playerInventory[m.id] || 0) * m.basePrice;
    });
    return value;
  }

  getTotalMined(): number {
    return this.totalMined;
  }

  getTradeCount(): number {
    return this.totalTradeCount;
  }

  getMostValuableMineral(): { mineralId: string; value: number } | null {
    let best: { mineralId: string; value: number } | null = null;
    MINERALS.forEach(m => {
      const amt = this.playerInventory[m.id] || 0;
      const val = amt * m.basePrice;
      if (amt > 0 && (!best || val > best.value)) {
        best = { mineralId: m.id, value: val };
      }
    });
    return best;
  }

  losePartialMineral(mineralId: string, ratio: number): number {
    const amt = this.playerInventory[mineralId] || 0;
    const lost = Math.floor(amt * ratio);
    this.playerInventory[mineralId] = amt - lost;
    return lost;
  }

  reset(): void {
    MINERALS.forEach(m => {
      this.playerInventory[m.id] = 0;
    });
    this.tradeHistory = [];
    this.totalTradeCount = 0;
    this.totalValue = 0;
    this.totalMined = 0;
    this.stations.forEach(station => {
      MINERALS.forEach(m => {
        station.inventory[m.id] = Phaser.Math.Between(10, 100);
        station.prices[m.id] = this.generatePrice(m.basePrice);
      });
    });
  }
}
