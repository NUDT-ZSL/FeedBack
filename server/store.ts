import type { MoodType, MoodRecord, MoodStats, ThresholdConfig, AlertEvent } from './types';
import { generateMockData } from './utils/mock';

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const MOOD_TYPES: MoodType[] = ['happy', 'calm', 'anxious', 'tired', 'angry'];

function calculateStats(records: MoodRecord[], date: string): MoodStats {
  const distribution: Record<MoodType, number> = {
    happy: 0,
    calm: 0,
    anxious: 0,
    tired: 0,
    angry: 0,
  };

  records.forEach(record => {
    distribution[record.mood]++;
  });

  const total = records.length;
  const percentages: Record<MoodType, number> = {
    happy: 0,
    calm: 0,
    anxious: 0,
    tired: 0,
    angry: 0,
  };

  if (total > 0) {
    MOOD_TYPES.forEach(mood => {
      percentages[mood] = Math.round((distribution[mood] / total) * 100);
    });
  }

  return {
    date,
    total,
    distribution,
    percentages,
  };
}

export class MemoryStore {
  private moodRecords: MoodRecord[] = [];
  private thresholdConfigs: ThresholdConfig[] = [];
  private alertEvents: AlertEvent[] = [];

  constructor() {
    this.moodRecords = generateMockData(30);
    this.thresholdConfigs = [
      { mood: 'happy', threshold: 30, enabled: false },
      { mood: 'calm', threshold: 30, enabled: false },
      { mood: 'anxious', threshold: 30, enabled: true },
      { mood: 'tired', threshold: 30, enabled: true },
      { mood: 'angry', threshold: 20, enabled: true },
    ];
  }

  addMood(mood: MoodType): MoodRecord {
    const now = new Date();
    const record: MoodRecord = {
      id: generateId(),
      mood,
      timestamp: now.getTime(),
      date: formatDate(now),
    };
    this.moodRecords.unshift(record);
    return record;
  }

  getTodayStats(): MoodStats {
    const today = formatDate(new Date());
    const todayRecords = this.moodRecords.filter(r => r.date === today);
    return calculateStats(todayRecords, today);
  }

  getRangeStats(startDate: string, endDate: string): MoodStats[] {
    const result: MoodStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = formatDate(d);
      const dayRecords = this.moodRecords.filter(r => r.date === dateStr);
      result.push(calculateStats(dayRecords, dateStr));
    }

    return result;
  }

  getThresholds(): ThresholdConfig[] {
    return [...this.thresholdConfigs];
  }

  setThreshold(config: ThresholdConfig): ThresholdConfig {
    const index = this.thresholdConfigs.findIndex(t => t.mood === config.mood);
    if (index >= 0) {
      this.thresholdConfigs[index] = { ...config };
    } else {
      this.thresholdConfigs.push({ ...config });
    }
    return { ...config };
  }

  getAlerts(): AlertEvent[] {
    return [...this.alertEvents].sort((a, b) => b.timestamp - a.timestamp);
  }

  checkThresholds(): AlertEvent[] {
    const todayStats = this.getTodayStats();
    const triggeredAlerts: AlertEvent[] = [];
    const now = new Date();

    this.thresholdConfigs.forEach(config => {
      if (!config.enabled) return;

      const percentage = todayStats.percentages[config.mood];
      if (percentage >= config.threshold) {
        const recentAlert = this.alertEvents.find(
          a => a.mood === config.mood && a.date === todayStats.date
        );

        if (!recentAlert) {
          const alert: AlertEvent = {
            id: generateId(),
            mood: config.mood,
            percentage,
            threshold: config.threshold,
            timestamp: now.getTime(),
            date: todayStats.date,
          };
          this.alertEvents.push(alert);
          triggeredAlerts.push(alert);
        }
      }
    });

    return triggeredAlerts;
  }

  addAlert(event: AlertEvent): void {
    this.alertEvents.push(event);
  }
}

export const store = new MemoryStore();
