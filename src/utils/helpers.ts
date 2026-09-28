export interface KeyResult {
  id: string;
  title: string;
  weight: number;
  progress: number;
}

export interface Task {
  id: string;
  krId: string;
  title: string;
  estimatedHours: number;
  deadline: string;
  completed: boolean;
  assignee?: string;
  order: number;
}

export interface OKR {
  id: string;
  title: string;
  quarter: string;
  deadline: string;
  keyResults: KeyResult[];
  tasks: Task[];
}

export interface RadarDimension {
  name: string;
  value: number;
  fullMark: number;
}

export function calculateWeightedProgress(keyResults: KeyResult[]): number {
  if (keyResults.length === 0) return 0;
  const totalWeight = keyResults.reduce((sum, kr) => sum + kr.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = keyResults.reduce((sum, kr) => sum + kr.progress * kr.weight, 0);
  return Math.round(weightedSum / totalWeight);
}

export function normalizeWeights(keyResults: KeyResult[]): KeyResult[] {
  if (keyResults.length === 0) return keyResults;
  const totalWeight = keyResults.reduce((sum, kr) => sum + kr.weight, 0);
  if (totalWeight === 100) return keyResults;
  return keyResults.map(kr => ({
    ...kr,
    weight: Math.round((kr.weight / totalWeight) * 100)
  }));
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDaysRemaining(deadline: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(deadline);
  deadlineDate.setHours(0, 0, 0, 0);
  const diffTime = deadlineDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export function calculateKRProgressFromTasks(krId: string, tasks: Task[]): number {
  const krTasks = tasks.filter(t => t.krId === krId);
  if (krTasks.length === 0) return 0;
  const totalHours = krTasks.reduce((sum, t) => sum + t.estimatedHours, 0);
  if (totalHours === 0) return 0;
  const completedHours = krTasks
    .filter(t => t.completed)
    .reduce((sum, t) => sum + t.estimatedHours, 0);
  return Math.round((completedHours / totalHours) * 100);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
