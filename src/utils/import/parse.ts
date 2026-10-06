import type { RawRecord } from './types.ts';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): RawRecord[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const records: RawRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const rec: RawRecord = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = (cells[idx] ?? '').trim();
    });
    records.push(rec);
  }
  return records;
}

export function parseJson(text: string): unknown[] {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['movies', 'items', 'list', 'records', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    return [obj];
  }
  throw new Error('JSON 内容不是可导入的片单结构');
}

export function parseImportText(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('内容为空');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJson(trimmed);
  }
  return parseCsv(trimmed);
}
