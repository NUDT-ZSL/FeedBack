import type { ClearanceGrade } from '@/domain/types';
import { RULING_STATUS_LABEL, type ShipRulingStatus } from '@/domain/status';
import { Badge, type BadgeTone } from './ui';

const GRADE_INFO: Record<ClearanceGrade, { label: string; tone: BadgeTone }> = {
  pass: { label: '准予通关', tone: 'green' },
  review: { label: '补税复核', tone: 'amber' },
  detain: { label: '暂扣候裁', tone: 'red' },
};

const STATUS_INFO: Record<ShipRulingStatus, { tone: BadgeTone }> = {
  none: { tone: 'gray' },
  pending: { tone: 'amber' },
  adjudicated: { tone: 'indigo' },
  overturned: { tone: 'red' },
};

export function GradeBadge({ grade }: { grade: ClearanceGrade | null }) {
  if (!grade) return <Badge tone="gray">未验讫</Badge>;
  const info = GRADE_INFO[grade];
  return <Badge tone={info.tone}>{info.label}</Badge>;
}

export function RulingStatusBadge({ status }: { status: ShipRulingStatus }) {
  return <Badge tone={STATUS_INFO[status].tone}>{RULING_STATUS_LABEL[status]}</Badge>;
}
