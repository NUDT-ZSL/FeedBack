export type ExpenseCategory = 'transport' | 'accommodation' | 'food' | 'ticket' | 'other';

export interface Activity {
  id: string;
  time: string;
  location: string;
  description: string;
  transport: string;
  cost: number;
  category: ExpenseCategory;
}

export interface DayPlan {
  date: string;
  activities: Activity[];
}

export interface Trip {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  totalBudget: number;
  days: DayPlan[];
  createdAt: string;
}

export interface TripCreateInput {
  destination: string;
  startDate: string;
  endDate: string;
  totalBudget: number;
}

export interface TripReport {
  trip: Trip;
  totalSpent: number;
  categoryBreakdown: Record<ExpenseCategory, number>;
  dailySummary: { date: string; total: number; count: number }[];
}
