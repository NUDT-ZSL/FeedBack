import type { MaterialType, QualityGrade, QualityResult } from '../types';
import {
  MATERIAL_TYPES,
  clamp,
  calculateConcentration,
  gradeForScore,
} from './engine.ts';

const QUALITY_GRADES: QualityGrade[] = ['excellent', 'good', 'medium', 'poor'];

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 将任意来源的历史记录条目规整化为 QualityResult。
 * 旧版本记录缺少字段或字段越界时按默认规则补齐，无法辨认的条目返回 null。
 */
export function normalizeHistoryRecord(raw: unknown, index = 0): QualityResult | null {
  if (!isRecord(raw)) return null;

  const materials = {} as Record<MaterialType, number>;
  const rawMaterials = isRecord(raw.materials) ? raw.materials : {};
  for (const type of MATERIAL_TYPES) {
    const value = toFiniteNumber(rawMaterials[type]);
    materials[type] = value === null ? 0 : clamp(value, 0, 50);
  }

  const rawConcentration = toFiniteNumber(raw.concentration);
  const concentration =
    rawConcentration === null ? calculateConcentration(materials) : clamp(rawConcentration, 0, 100);

  const rawUniformity = toFiniteNumber(raw.uniformity);
  const uniformity = rawUniformity === null ? 0 : clamp(rawUniformity, 0, 100);

  const rawDryness = toFiniteNumber(raw.dryness);
  const dryness = rawDryness === null ? 0 : clamp(rawDryness, 0, 100);

  const rawPressLevel = toFiniteNumber(raw.pressLevel);
  const pressLevel = rawPressLevel === null ? 0 : clamp(rawPressLevel, 0, 100);

  const rawScore = toFiniteNumber(raw.score);
  const score = rawScore === null ? 0 : clamp(Math.round(rawScore), 0, 100);

  const grade = QUALITY_GRADES.includes(raw.grade as QualityGrade)
    ? (raw.grade as QualityGrade)
    : gradeForScore(score);

  const rawTimestamp = toFiniteNumber(raw.timestamp);
  const timestamp = rawTimestamp === null ? 0 : rawTimestamp;

  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `legacy-${timestamp}-${index}`;

  return {
    id,
    timestamp,
    materials,
    concentration,
    uniformity,
    dryness,
    pressLevel,
    score,
    grade,
  };
}

/** 解析持久化载荷（JSON 解析后的值），丢弃无法辨认的条目，保证旧数据可读。 */
export function parseHistoryPayload(payload: unknown): QualityResult[] {
  if (!Array.isArray(payload)) return [];
  const records: QualityResult[] = [];
  payload.forEach((item, index) => {
    const record = normalizeHistoryRecord(item, index);
    if (record) records.push(record);
  });
  return records;
}
