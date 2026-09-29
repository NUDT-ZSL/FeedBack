import type { GameRecord } from '../src/gameEngine';

const STORAGE_KEY = 'tic_tac_toe_history';

export class DataManager {
  private records: GameRecord[];

  constructor() {
    this.records = this.loadFromStorage();
  }

  private loadFromStorage(): GameRecord[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load game history:', e);
    }
    return [];
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch (e) {
      console.error('Failed to save game history:', e);
    }
  }

  public addRecord(record: GameRecord): void {
    this.records.unshift(record);
    if (this.records.length > 100) {
      this.records = this.records.slice(0, 100);
    }
    this.saveToStorage();
  }

  public getRecords(): GameRecord[] {
    return [...this.records];
  }

  public getRecordById(id: string): GameRecord | undefined {
    return this.records.find(r => r.id === id);
  }

  public getRecordsByPlayer(playerName: string): GameRecord[] {
    return this.records.filter(
      r => r.player1 === playerName || r.player2 === playerName
    );
  }

  public getRecordsSortedByDate(ascending: boolean = false): GameRecord[] {
    const sorted = [...this.records].sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    return ascending ? sorted : sorted.reverse();
  }

  public getWinRate(playerName: string): { wins: number; total: number; rate: number } {
    const playerRecords = this.getRecordsByPlayer(playerName);
    let wins = 0;

    for (const record of playerRecords) {
      if (record.winner === 'draw') continue;
      const winnerName = record.winner === 'red' ? record.player1 : record.player2;
      if (winnerName === playerName) {
        wins++;
      }
    }

    return {
      wins,
      total: playerRecords.length,
      rate: playerRecords.length > 0 ? wins / playerRecords.length : 0
    };
  }

  public clearAllRecords(): void {
    this.records = [];
    this.saveToStorage();
  }

  public deleteRecord(id: string): boolean {
    const index = this.records.findIndex(r => r.id === id);
    if (index !== -1) {
      this.records.splice(index, 1);
      this.saveToStorage();
      return true;
    }
    return false;
  }
}

export const dataManager = new DataManager();
