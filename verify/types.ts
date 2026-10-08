export interface CheckResult {
  module: string;
  name: string;
  ok: boolean;
  detail: string;
}

export interface TeaRow {
  id?: string;
  name: string;
  category: string;
  origin: string;
  year: number;
  scores: number[];
}

export interface SuiteContext {
  baseUrl: string;
  check: (name: string, ok: boolean, detail?: string) => void;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}
