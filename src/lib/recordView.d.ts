import type {
  EscapeRecord,
  FilterState,
  Stats,
  ThemeType,
} from '../types';

export const THEME_ORDER: ThemeType[];

export interface RecordGroup {
  theme: ThemeType;
  records: EscapeRecord[];
}

export interface RecordView {
  records: EscapeRecord[];
  stats: Stats;
  groups: RecordGroup[];
}

export function matchesFilter(
  record: EscapeRecord,
  filter: FilterState,
): boolean;

export function getFilteredRecords(
  records: EscapeRecord[],
  filter: FilterState,
): EscapeRecord[];

export function getStats(records: EscapeRecord[]): Stats;

export function getRecordGroups(records: EscapeRecord[]): RecordGroup[];

export function getRecordView(
  records: EscapeRecord[],
  filter: FilterState,
): RecordView;
