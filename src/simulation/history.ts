import type { MaterialType, QualityGrade, QualityResult } from '../types';
import { DEFAULT_MATERIALS } from './engine';

const GRADES: QualityGrade[] = ['excellent', 'good', 'medium', 'poor'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * 容错解析历史记录：
 * - 兼容旧版本缺少 concentration/uniformity/dryness/pressLevel 字段的记录
 * - 兼容单条记录损坏或整条不是数组的情况，坏记录被跳过而非整体失败
 * - 不删除旧记录中可能存在的额外字段
 */
export function parseHistoryRecords(raw: unknown): QualityResult[] {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const records: QualityResult[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;

    const hasMaterials = isRecord(item.materials);
    const hasScore = typeof item.score === 'number' || typeof item.score === 'string';
    const hasGrade = GRADES.includes(item.grade as QualityGrade);
    // 完全没有任何可识别字段的对象视为坏记录，跳过而非补默认值
    if (!hasMaterials && !hasScore && !hasGrade) continue;

    const materialsRaw = hasMaterials ? (item.materials as Record<string, unknown>) : {};
    const materials: Record<MaterialType, number> = {
      chuPi: toFiniteNumber(materialsRaw.chuPi, DEFAULT_MATERIALS.chuPi),
      sangPi: toFiniteNumber(materialsRaw.sangPi, DEFAULT_MATERIALS.sangPi),
      maXianWei: toFiniteNumber(
        materialsRaw.maXianWei,
        DEFAULT_MATERIALS.maXianWei
      ),
    };

    const concentration = toFiniteNumber(
      item.concentration,
      materials.chuPi + materials.sangPi + materials.maXianWei
    );

    const score = toFiniteNumber(item.score, 0);
    const grade: QualityGrade = GRADES.includes(item.grade as QualityGrade)
      ? (item.grade as QualityGrade)
      : fallbackGrade(score);

    records.push({
      id: typeof item.id === 'string' ? item.id : `legacy-${records.length}`,
      timestamp: toFiniteNumber(item.timestamp, 0),
      materials,
      concentration,
      uniformity: toFiniteNumber(item.uniformity, 0),
      dryness: toFiniteNumber(item.dryness, 0),
      pressLevel: toFiniteNumber(item.pressLevel, 0),
      score,
      grade,
    });
  }
  return records;
}

function fallbackGrade(score: number): QualityGrade {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'medium';
  return 'poor';
}
