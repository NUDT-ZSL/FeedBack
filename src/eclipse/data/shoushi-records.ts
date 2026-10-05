import type { EclipseKind, EclipseType } from "../types.ts";

export interface HistoricalRecordEntry {
  id: string;
  source: string;
  calendarYear: number;
  kind: EclipseKind;
  type: EclipseType;
  dateISO: string;
  magnitude: number;
}

export const SHOUSHI_RECORDS: readonly HistoricalRecordEntry[] = [
  {
    id: "ss-1311-ri",
    source: "授时历",
    calendarYear: 1311,
    kind: "solar",
    type: "solar-total",
    dateISO: "1311-07-24T18:05:00.000Z",
    magnitude: 1.03,
  },
  {
    id: "ss-1282-ri",
    source: "授时历",
    calendarYear: 1282,
    kind: "solar",
    type: "solar-partial",
    dateISO: "1282-08-12T03:40:00.000Z",
    magnitude: 0.96,
  },
  {
    id: "ss-1319-ri",
    source: "授时历",
    calendarYear: 1319,
    kind: "solar",
    type: "solar-partial",
    dateISO: "1319-03-01T00:45:00.000Z",
    magnitude: 0.01,
  },
  {
    id: "ss-1284-yue",
    source: "授时历",
    calendarYear: 1284,
    kind: "lunar",
    type: "lunar-total",
    dateISO: "1284-01-11T12:30:00.000Z",
    magnitude: 1.68,
  },
  {
    id: "ss-1299-yue",
    source: "授时历",
    calendarYear: 1299,
    kind: "lunar",
    type: "lunar-partial",
    dateISO: "1299-09-18T10:55:00.000Z",
    magnitude: 0.99,
  },
  {
    id: "ss-1286-yue",
    source: "授时历",
    calendarYear: 1286,
    kind: "lunar",
    type: "lunar-partial",
    dateISO: "1286-11-09T22:35:00.000Z",
    magnitude: 0.01,
  },
  {
    id: "ss-1326-ri",
    source: "授时历",
    calendarYear: 1326,
    kind: "solar",
    type: "solar-total",
    dateISO: "1326-10-04T22:50:00.000Z",
    magnitude: 1.02,
  },
  {
    id: "ss-1285-yue",
    source: "授时历",
    calendarYear: 1285,
    kind: "lunar",
    type: "lunar-partial",
    dateISO: "1285-06-25T14:40:00.000Z",
    magnitude: 0.35,
  },
] as const;
