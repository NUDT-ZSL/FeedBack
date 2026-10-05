import { useMemo } from 'react';
import {
  runScenario,
  verifyIncrementalConsistency,
  type ScenarioInput,
  type SimulationCache,
} from '@/simulation';

interface IncrementalCheckProps {
  scenario: ScenarioInput;
}

interface CheckRow {
  name: string;
  consistent: boolean;
  recomputedChannels: string[];
  recomputedFields: string[];
  reusedFields: string[];
}

/** 在当前输入上施加五类局部调整，验证“只重算受影响部分”与整体重算一致 */
export function IncrementalCheck({ scenario }: IncrementalCheckProps) {
  const rows = useMemo<CheckRow[]>(() => {
    let cache: SimulationCache;
    try {
      cache = { input: scenario, result: runScenario(scenario) };
    } catch {
      return [];
    }
    const mutations: Array<{ name: string; mutate: (draft: ScenarioInput) => void }> = [
      {
        name: '渠道分流比例 ±0.15',
        mutate: (draft) => {
          if (draft.channels.length >= 2) {
            draft.channels[0].shareRatio = Math.min(1, draft.channels[0].shareRatio + 0.15);
            draft.channels[1].shareRatio = Math.max(0, draft.channels[1].shareRatio - 0.15);
          }
        },
      },
      {
        name: '上游来水量 ×0.6',
        mutate: (draft) => {
          draft.upstreamInflow = Math.round(draft.upstreamInflow * 0.6 * 100) / 100;
        },
      },
      {
        name: '首块田容量 −20',
        mutate: (draft) => {
          if (draft.fields.length > 0) {
            draft.fields[0].capacity = Math.max(1, draft.fields[0].capacity - 20);
          }
        },
      },
      {
        name: '末块田作物阈值 +15',
        mutate: (draft) => {
          if (draft.fields.length > 0) {
            const last = draft.fields[draft.fields.length - 1];
            last.cropDemandThreshold += 15;
          }
        },
      },
      {
        name: '首台水车开度 +20',
        mutate: (draft) => {
          if (draft.wheels.length > 0) {
            draft.wheels[0].gateOpening = Math.min(100, draft.wheels[0].gateOpening + 20);
          }
        },
      },
    ];

    return mutations.map(({ name, mutate }) => {
      try {
        const check = verifyIncrementalConsistency(cache, mutate);
        return {
          name,
          consistent: check.consistent,
          recomputedChannels: check.report.recomputedChannels,
          recomputedFields: check.report.recomputedFields,
          reusedFields: check.report.reusedFields,
        };
      } catch {
        return { name, consistent: false, recomputedChannels: [], recomputedFields: [], reusedFields: [] };
      }
    });
  }, [scenario]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-stone-300 bg-stone-50 p-3 text-xs text-stone-600">
        当前输入不合法，无法执行增量自检。
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-emerald-900/15 bg-white/60 p-3">
      <h3 className="mb-2 text-sm font-semibold text-emerald-900">增量重算自检（局部调整 vs 整体重算）</h3>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.name} className="flex flex-wrap items-center gap-2 text-xs">
            <span className={row.consistent ? 'text-emerald-700' : 'text-red-700'}>
              {row.consistent ? '✓ 一致' : '✗ 不一致'}
            </span>
            <span className="font-medium text-stone-800">{row.name}</span>
            <span className="text-stone-500">
              重算田块 [{row.recomputedFields.join(', ') || '无'}]，复用 [{row.reusedFields.join(', ') || '无'}]
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
