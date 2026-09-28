import { describe, expect, it } from 'vitest';
import { CareLog } from './types';
import {
  generateFertilizeBarData,
  generateWaterTrendData,
} from './chartHelper';

function log(
  id: string,
  date: string,
  activityType: CareLog['activityType']
): CareLog {
  return { id, date, activityType, notes: '' };
}

function expectedDayLabels(referenceDate: Date): string[] {
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(
      Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate() - (29 - index)
      )
    );
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  });
}

describe('generateWaterTrendData', () => {
  const referenceDate = new Date(Date.UTC(2026, 0, 15, 12, 30));

  it('builds the most recent 30 local calendar days in order', () => {
    const result = generateWaterTrendData([], referenceDate);

    expect(result.labels).toHaveLength(30);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].data).toHaveLength(30);
    expect(result.labels).toEqual(expectedDayLabels(referenceDate));
    expect(result.labels[0]).toBe('12/17');
    expect(result.labels[29]).toBe('1/15');
    expect(result.datasets[0].data.every((count) => count === 0)).toBe(true);
  });

  it('counts multiple watering records on the same day and excludes other activities', () => {
    const result = generateWaterTrendData(
      [
        log('water-first', '2026-01-10', 'water'),
        log('water-second', '2026-01-10', 'water'),
        log('water-third', '2026-01-10', 'water'),
        log('fertilize-same-day', '2026-01-10', 'fertilize'),
        log('prune-same-day', '2026-01-10', 'prune'),
        log('water-start', '2025-12-17', 'water'),
        log('water-end', '2026-01-15', 'water'),
      ],
      referenceDate
    );

    expect(result.datasets[0].data[result.labels.indexOf('12/17')]).toBe(1);
    expect(result.datasets[0].data[result.labels.indexOf('1/10')]).toBe(3);
    expect(result.datasets[0].data[result.labels.indexOf('1/15')]).toBe(1);
    expect(
      result.datasets[0].data.reduce((total, count) => total + count, 0)
    ).toBe(5);
  });

  it('ignores invalid dates and records outside the 30-day window', () => {
    const result = generateWaterTrendData(
      [
        log('invalid', 'not-a-date', 'water'),
        log('impossible', '2026-02-30', 'water'),
        log('outside-old', '2025-12-16', 'water'),
        log('outside-future', '2026-01-16', 'water'),
      ],
      referenceDate
    );

    expect(
      result.datasets[0].data.every((count) => count === 0)
    ).toBe(true);
  });
});

describe('generateFertilizeBarData', () => {
  const referenceDate = new Date(Date.UTC(2026, 1, 15, 8, 0));

  it('groups records into the latest six natural months across a year boundary', () => {
    const result = generateFertilizeBarData([], referenceDate);

    expect(result.labels).toEqual([
      '9月',
      '10月',
      '11月',
      '12月',
      '1月',
      '2月',
    ]);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].data).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('counts fertilizing records by month and excludes non-fertilizing records', () => {
    const result = generateFertilizeBarData(
      [
        log('sep-1', '2025-09-01', 'fertilize'),
        log('sep-2', '2025-09-30', 'fertilize'),
        log('sep-water', '2025-09-15', 'water'),
        log('oct-1', '2025-10-20', 'fertilize'),
        log('oct-prune', '2025-10-20', 'prune'),
        log('dec-1', '2025-12-01', 'fertilize'),
        log('jan-1', '2026-01-31', 'fertilize'),
        log('feb-1', '2026-02-01', 'fertilize'),
        log('feb-2', '2026-02-15', 'fertilize'),
      ],
      referenceDate
    );

    expect(result.datasets[0].data).toEqual([2, 1, 0, 1, 1, 2]);
    expect(
      result.datasets[0].data.reduce((total, count) => total + count, 0)
    ).toBe(7);
  });

  it('ignores invalid dates and months outside the six-month window', () => {
    const result = generateFertilizeBarData(
      [
        log('invalid', '2025/09/01', 'fertilize'),
        log('impossible', '2025-13-01', 'fertilize'),
        log('outside-old', '2025-08-31', 'fertilize'),
        log('outside-future', '2026-03-01', 'fertilize'),
      ],
      referenceDate
    );

    expect(result.datasets[0].data).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
