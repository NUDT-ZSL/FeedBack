export type MemberRole = 'leader' | 'finance' | 'member';

export type SplitType = 'equal' | 'proportional';

export type PackingCategory = 'documents' | 'clothing' | 'medicine' | 'electronics' | 'toiletries' | 'other';

export interface TravelProject {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverImage: string;
  createdAt: string;
}

export interface Member {
  id: string;
  projectId: string;
  name: string;
  avatar: string;
  role: MemberRole;
}

export interface ItineraryItem {
  id: string;
  projectId: string;
  date: string;
  time: string;
  location: string;
  description: string;
  budget: number;
  order: number;
}

export interface BudgetSplit {
  id: string;
  projectId: string;
  description: string;
  totalAmount: number;
  splitType: SplitType;
  proportions: Record<string, number>;
  participantIds: string[];
  createdAt: string;
}

export interface PackingItem {
  id: string;
  projectId: string;
  category: PackingCategory;
  name: string;
  isChecked: boolean;
  checkedBy?: string;
  isCustom: boolean;
  order: number;
}

export interface TravelData {
  projects: TravelProject[];
  members: Member[];
  itineraryItems: ItineraryItem[];
  budgetSplits: BudgetSplit[];
  packingItems: PackingItem[];
}
