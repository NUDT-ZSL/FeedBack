import { describe, expect, it } from 'vitest';
import { CareLog } from './types';
import {
  getPlantStatus,
  getPlantStatusPresentation,
  PLANT_STATUS_PRESENTATION,
} from './plantStatus';

const referenceDate = new Date(Date.UTC(2026, 5, 20, 13, 45, 30));

function waterLog(daysAgo: number): CareLog {
  const date = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate() - daysAgo
    )
  );
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return {
    id: `water-${daysAgo}`,
    date: `${date.getUTCFullYear()}-${month}-${day}`,
    activityType: 'water',
    notes: '',
  };
}

function plantWith(logs: CareLog[]) {
  return { logs };
}

describe('getPlantStatus', () => {
  it('uses whole-day boundaries for every plant status', () => {
    expect(getPlantStatus(plantWith([waterLog(0)]), referenceDate)).toBe('healthy');
    expect(getPlantStatus(plantWith([waterLog(3)]), referenceDate)).toBe('healthy');
    expect(getPlantStatus(plantWith([waterLog(4)]), referenceDate)).toBe('needs-water');
    expect(getPlantStatus(plantWith([waterLog(6)]), referenceDate)).toBe('needs-water');
    expect(getPlantStatus(plantWith([waterLog(7)]), referenceDate)).toBe('wilted');
    expect(getPlantStatus(plantWith([waterLog(8)]), referenceDate)).toBe('wilted');
  });

  it('ignores the reference time because comparisons use calendar days', () => {
    const startOfDay = new Date(Date.UTC(2026, 5, 20, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(2026, 5, 20, 23, 59, 59, 999));

    expect(getPlantStatus(plantWith([waterLog(3)]), startOfDay)).toBe('healthy');
    expect(getPlantStatus(plantWith([waterLog(3)]), endOfDay)).toBe('healthy');
    expect(getPlantStatus(plantWith([waterLog(4)]), startOfDay)).toBe('needs-water');
    expect(getPlantStatus(plantWith([waterLog(4)]), endOfDay)).toBe('needs-water');
    expect(getPlantStatus(plantWith([waterLog(7)]), startOfDay)).toBe('wilted');
    expect(getPlantStatus(plantWith([waterLog(7)]), endOfDay)).toBe('wilted');
  });

  it('returns wilted when there are no watering records', () => {
    expect(getPlantStatus(plantWith([]), referenceDate)).toBe('wilted');
    expect(
      getPlantStatus(
        plantWith([
          {
            id: 'prune-only',
            date: '2026-06-19',
            activityType: 'prune',
            notes: '',
          },
          {
            id: 'fertilize-only',
            date: '2026-06-18',
            activityType: 'fertilize',
            notes: '',
          },
        ]),
        referenceDate
      )
    ).toBe('wilted');
  });

  it('uses the latest valid watering date and ignores invalid dates', () => {
    expect(
      getPlantStatus(
        plantWith([
          { id: 'invalid', date: 'not-a-date', activityType: 'water', notes: '' },
          { id: 'invalid-month', date: '2026-13-01', activityType: 'water', notes: '' },
          waterLog(10),
          waterLog(2),
        ]),
        referenceDate
      )
    ).toBe('healthy');

    expect(
      getPlantStatus(
        plantWith([
          { id: 'invalid', date: '2026-02-31', activityType: 'water', notes: '' },
        ]),
        referenceDate
      )
    ).toBe('wilted');
  });
});

describe('plant status presentation', () => {
  it('maps each status to the exact card label and icon', () => {
    expect(PLANT_STATUS_PRESENTATION.healthy).toEqual({
      label: '健康',
      icon: '🍃',
      title: '健康',
    });
    expect(PLANT_STATUS_PRESENTATION['needs-water']).toEqual({
      label: '需浇水',
      icon: '💧',
      title: '需要浇水',
    });
    expect(PLANT_STATUS_PRESENTATION.wilted).toEqual({
      label: '缺水',
      icon: '🥀',
      title: '缺水',
    });
  });

  it('returns the presentation matching the calculated status', () => {
    expect(getPlantStatusPresentation(plantWith([waterLog(3)]), referenceDate)).toBe(
      PLANT_STATUS_PRESENTATION.healthy
    );
    expect(getPlantStatusPresentation(plantWith([waterLog(5)]), referenceDate)).toBe(
      PLANT_STATUS_PRESENTATION['needs-water']
    );
    expect(getPlantStatusPresentation(plantWith([]), referenceDate)).toBe(
      PLANT_STATUS_PRESENTATION.wilted
    );
  });
});
