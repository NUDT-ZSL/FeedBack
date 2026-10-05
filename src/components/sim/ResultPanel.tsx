import type { ScenarioInput, SimulationResult } from '@/simulation';

interface ResultPanelProps {
  result: SimulationResult;
  scenario: ScenarioInput;
  rerunChecksum: string;
  deterministic: boolean;
  error: string | null;
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'alert' }) {
  return (
    <div className="rounded-lg border border-emerald-900/15 bg-white/60 px-3 py-2">
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={`text-lg font-semibold ${tone === 'alert' ? 'text-red-700' : 'text-emerald-900'}`}>{value}</p>
    </div>
  );
}

/** 结论面板：只展示引擎产出的记录与可追溯依据，自身不做任何计算改写 */
export function ResultPanel({ result, scenario, rerunChecksum, deterministic, error }: ResultPanelProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        输入不合法：{error}
      </div>
    );
  }

  const fieldName = new Map(scenario.fields.map((f) => [f.id, f.name]));
  const channelName = new Map(scenario.channels.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-900/15 bg-white/60 px-3 py-2 text-xs">
        <span className="font-semibold text-emerald-900">推演结论校验和</span>
        <code className="rounded bg-stone-800 px-1.5 py-0.5 text-emerald-200">{result.checksum}</code>
        <span className={deterministic ? 'text-emerald-700' : 'text-red-700'}>
          {deterministic ? `✓ 重复推演一致（${rerunChecksum}）` : '✗ 重复推演结果漂移'}
        </span>
        <span className="text-stone-400">同一校验和可与 `npm run simulate` 离线报告逐项对照</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="水车提水总量" value={result.totals.lifted.toFixed(2)} />
        <Metric label="渠道弃水总量" value={result.totals.spilled.toFixed(2)} />
        <Metric label="田块溢水总量" value={result.totals.fieldOverflow.toFixed(2)} />
        <Metric label="缺水田块数" value={String(result.totals.deficitFieldCount)} tone={result.totals.deficitFieldCount > 0 ? 'alert' : 'default'} />
      </div>

      <section className="rounded-lg border border-emerald-900/15 bg-white/60 p-3">
        <h3 className="mb-2 text-sm font-semibold text-emerald-900">作物缺水判定（依据可追溯）</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1 pr-2 font-normal">田块</th>
                <th className="py-1 pr-2 font-normal">期末蓄水</th>
                <th className="py-1 pr-2 font-normal">需水阈值</th>
                <th className="py-1 pr-2 font-normal">缺水 tick</th>
                <th className="py-1 font-normal">结论</th>
              </tr>
            </thead>
            <tbody>
              {result.fieldSummaries.map((summary) => (
                <tr key={summary.fieldId} className="border-t border-stone-200">
                  <td className="py-1 pr-2 font-medium text-stone-800">{fieldName.get(summary.fieldId) ?? summary.fieldId}</td>
                  <td className="py-1 pr-2">{summary.finalStorage.toFixed(2)}</td>
                  <td className="py-1 pr-2">{summary.threshold.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-stone-600">
                    {summary.deficitTicks.length > 0 ? summary.deficitTicks.join(', ') : '无'}
                  </td>
                  <td className="py-1">
                    {summary.deficit ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
                        缺水（{summary.deficitCount}/{result.ticks}）
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">供水充足</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-emerald-900/15 bg-white/60 p-3">
        <h3 className="mb-2 text-sm font-semibold text-emerald-900">渠道分流汇总</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1 pr-2 font-normal">渠道</th>
                <th className="py-1 pr-2 font-normal">分流总量</th>
                <th className="py-1 pr-2 font-normal">提水总量</th>
                <th className="py-1 font-normal">弃水总量</th>
              </tr>
            </thead>
            <tbody>
              {scenario.channels.map((channel) => {
                const records = result.channelRecords.filter((r) => r.channelId === channel.id);
                const allocated = records.reduce((acc, r) => acc + r.allocated, 0);
                const lifted = records.reduce((acc, r) => acc + r.lifted, 0);
                const spilled = records.reduce((acc, r) => acc + r.spilled, 0);
                return (
                  <tr key={channel.id} className="border-t border-stone-200">
                    <td className="py-1 pr-2 font-medium text-stone-800">{channelName.get(channel.id) ?? channel.id}</td>
                    <td className="py-1 pr-2">{allocated.toFixed(2)}</td>
                    <td className="py-1 pr-2">{lifted.toFixed(2)}</td>
                    <td className="py-1 text-stone-600">{spilled.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-emerald-900/15 bg-white/60 p-3">
        <h3 className="mb-2 text-sm font-semibold text-emerald-900">田块蓄水逐 tick 轨迹</h3>
        <div className="space-y-2">
          {scenario.fields.map((field) => {
            const records = result.fieldRecords.filter((r) => r.fieldId === field.id);
            const max = field.capacity;
            return (
              <div key={field.id}>
                <p className="mb-0.5 text-xs text-stone-700">
                  {field.name}
                  <span className="ml-2 text-stone-400">阈值 {field.cropDemandThreshold} / 容量 {field.capacity}</span>
                </p>
                <div className="flex h-4 gap-px overflow-hidden rounded bg-stone-200">
                  {records.map((record) => {
                    const ratio = Math.max(0, Math.min(1, record.storageAfter / max));
                    const thresholdRatio = Math.max(0, Math.min(1, field.cropDemandThreshold / max));
                    const deficit = record.storageAfter < field.cropDemandThreshold;
                    return (
                      <div
                        key={record.tick}
                        title={`tick ${record.tick}: 蓄水 ${record.storageAfter}（入流 ${record.inflow}，蒸散 ${record.evaporation}，溢水 ${record.overflow}），${deficit ? '缺水' : '达标'}`}
                        className="flex-1"
                        style={{
                          backgroundColor: deficit ? '#c0392b' : `rgb(107, ${Math.round(142 - 60 * ratio)}, 35)`,
                          borderLeft: record.tick === 0 ? 'none' : undefined,
                          boxShadow: `inset ${thresholdRatio * 100}% 0 0 rgba(0,0,0,0.12)`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-stone-500">每一格为一个 tick，悬停查看该 tick 的入流、蒸散、溢水与蓄水数值；红色格为缺水 tick。</p>
      </section>
    </div>
  );
}
