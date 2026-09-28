import { CareLog } from './types';
import {
  calendarDayDiff,
  normalizeReferenceDate,
  parseCalendarDate,
} from './date';

export type PlantStatus = 'healthy' | 'needs-water' | 'wilted';

export interface PlantLike {
  logs: CareLog[];
}

export interface PlantStatusPresentation {
  label: string;
  icon: string;
  title: string;
}

export const PLANT_STATUS_PRESENTATION: Record<
  PlantStatus,
  PlantStatusPresentation
> = {
  healthy: { label: '健康', icon: '🍃', title: '健康' },
  'needs-water': { label: '需浇水', icon: '💧', title: '需要浇水' },
  wilted: { label: '缺水', icon: '🥀', title: '缺水' },
};

export function getPlantStatus(
  plant: PlantLike,
  referenceDate: Date = new Date()
): PlantStatus {
  const reference = normalizeReferenceDate(referenceDate);
  let latestWatering: Date | null = null;

  for (const log of plant.logs) {
    if (log.activityType !== 'water') continue;
    const logDate = parseCalendarDate(log.date);
    if (!logDate) continue;

    if (!latestWatering || logDate > latestWatering) {
      latestWatering = logDate;
    }
  }

  if (!latestWatering) return 'wilted';

  const ageInDays = calendarDayDiff(reference, latestWatering);
  if (ageInDays >= 7) return 'wilted';
  if (ageInDays >= 4) return 'needs-water';
  return 'healthy';
}

export function getPlantStatusPresentation(
  plant: PlantLike,
  referenceDate: Date = new Date()
): PlantStatusPresentation {
  return PLANT_STATUS_PRESENTATION[getPlantStatus(plant, referenceDate)];
}
