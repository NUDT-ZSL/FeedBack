import { readFileSync } from 'node:fs';

import { verificationPath } from '../paths';
import { runSuite } from '../harness';
import { computeEclipse } from '../../src/lib/astronomy/engine';
import {
  HistoricalRecord,
  compareAgainstRecords,
  compareWithRecord,
  ComparisonResult,
} from '../../src/lib/astronomy/history';

interface RecordCase {
  id: string;
  note: string;
  input: {
    year: number;
    month: number;
    day: number;
    kind: 'solar' | 'lunar' | 'auto';
    observer: {
      latitudeDeg: number;
      longitudeDeg: number;
      timezoneOffsetHours: number;
    };
  };
  expectedVerdict: 'match' | 'deviation' | 'no_record';
  expectedRecordId?: string;
}

interface RecordFixture {
  records: HistoricalRecord[];
  cases: RecordCase[];
}

export function recordsSuite() {
  return runSuite('records-历代记录比对', (t) => {
    const fixture = JSON.parse(
      readFileSync(verificationPath('fixtures', 'historical-records.json'), 'utf8'),
    ) as RecordFixture;
    t.check('历史记录库非空', fixture.records.length > 0, `${fixture.records.length} 条记录`);

    for (const c of fixture.cases) {
      t.step(`[${c.id}] ${c.note}`, () => {
        const result = computeEclipse(c.input);
        const comp = compareAgainstRecords(result, fixture.records);
        t.check('比对结论一致', comp.verdict === c.expectedVerdict,
          `${comp.verdict} vs ${c.expectedVerdict}`);
        if (c.expectedRecordId !== undefined) {
          t.check('命中记录一致', comp.recordId === c.expectedRecordId,
            `${comp.recordId} vs ${c.expectedRecordId}`);
        } else {
          t.check('无命中记录', comp.recordId === null);
        }
      });
    }

    t.step('偏差量与结论阈值自洽', () => {
      for (const record of fixture.records) {
        const result = computeEclipse({
          year: record.year,
          month: record.month,
          day: record.day,
          kind: record.kind,
          observer: { latitudeDeg: 39.9, longitudeDeg: 116.4, timezoneOffsetHours: 8 },
        });
        const comp = compareWithRecord(result, record);
        assertCompConsistency(t, comp, record.id);
      }
    });

    t.step('无食推演不会误命中历史记录', () => {
      const result = computeEclipse({
        year: 1300,
        month: 1,
        day: 10,
        kind: 'solar',
        observer: { latitudeDeg: 39.9, longitudeDeg: 116.4, timezoneOffsetHours: 8 },
      });
      const comp = compareAgainstRecords(result, fixture.records);
      t.check('无食时结论为 no_record 或偏差而非吻合', comp.verdict !== 'match');
    });
  });
}

function assertCompConsistency(
  t: { check: (n: string, ok: boolean, d?: string) => void },
  comp: ComparisonResult,
  id: string,
) {
  if (comp.verdict === 'match') {
    t.check(`[${id}] 吻合: 时间偏差<=2h`,
      comp.timeDeviationHours === null || comp.timeDeviationHours <= 2 + 1e-9,
      `h=${comp.timeDeviationHours}`);
    t.check(`[${id}] 吻合: 食分偏差<=0.1`,
      comp.magnitudeDeviation === null || comp.magnitudeDeviation <= 0.1 + 1e-9,
      `m=${comp.magnitudeDeviation}`);
  }
  if (comp.verdict === 'deviation') {
    const over =
      (comp.timeDeviationHours !== null && comp.timeDeviationHours > 2) ||
      (comp.magnitudeDeviation !== null && comp.magnitudeDeviation > 0.1);
    t.check(`[${id}] 偏差: 至少一项超阈`, over);
  }
  if (comp.timeDeviationHours !== null) {
    t.check(`[${id}] 时间偏差百分比如实换算`,
      Math.abs(comp.timeDeviationPercent! - (comp.timeDeviationHours / 24) * 100) < 1e-9);
  }
}
