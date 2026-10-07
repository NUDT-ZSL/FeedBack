export interface EnergyData {
  frequency: number;
  amplitude: number;
  resonance: number;
  historicalKeys: string[];
}

export interface ArtifactItem {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  currentPrice: number;
  category: 'bronze' | 'porcelain' | 'coin' | 'jade' | 'painting';
  colorTheme: string;
  energyData: EnergyData;
  backgroundStories: string[];
  createdAt: string;
}

export interface BidRecord {
  id: string;
  itemId: string;
  userId: string;
  username: string;
  amount: number;
  timestamp: string;
}

export interface AuctionState {
  itemId: string;
  endTime: string;
  isActive: boolean;
  winnerId: string | null;
  bids: BidRecord[];
}
