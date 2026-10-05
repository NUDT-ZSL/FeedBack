import { Observer } from '../src/lib/astronomy/visibility';

export interface GoldenCaseInput {
  year: number;
  month: number;
  day: number;
  kind?: 'solar' | 'lunar' | 'auto';
  observer: Observer;
}

export interface GoldenExpected {
  kind: 'solar' | 'lunar';
  type: string;
  typeLabel: string;
  magnitude: number;
  phases: Record<string, number>;
  visible: boolean;
  visibilityReason: string;
}

export interface GoldenCase {
  id: string;
  note: string;
  input: GoldenCaseInput;
  expected?: GoldenExpected;
}
