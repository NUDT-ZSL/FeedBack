import { useState } from 'react';
import { useClinicStore } from '@/stores/clinicStore';
import { itemLabel, KIND_LABEL, SOURCE_GROUPS, SOURCE_LABEL } from './catalog';
import type { CollectionConflict, CollectionRecord } from '@/diagnosis';

const VALUE_LABEL: Record<string, string> = { true: '有', false: '无', none: '未及' };

function RecordValue({ record }: { record: CollectionRecord }) {
  const [editing, setEditing] = useState(false);
  const correct = useClinicStore((s) => s.correct);
  const text = VALUE_LABEL[record.value] ?? record.value;
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            record.value === 'false' ? 'bg-stone-300 text-stone-700' : 'bg-amber-100 text-amber-900'
          }`}
        >
          {text}
        </span>
        <button
          type="button"
          className="text-xs text-amber-800 underline underline-offset-2 hover:text-amber-600"
          onClick={() => setEditing(true)}
        >
          修正
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex gap-1">
      {['true', 'false'].map((value) => (
        <button
          key={value}
          type="button"
          className="rounded bg-amber-700 px-1.5 py-0.5 text-xs text-amber-50 hover:bg-amber-600"
          onClick={() => {
            correct(record.id, value);
            setEditing(false);
          }}
        >
          改为{VALUE_LABEL[value]}
        </button>
      ))}
    </span>
  );
}

function ConflictRow({ conflict }: { conflict: CollectionConflict }) {
  const adjudicate = useClinicStore((s) => s.adjudicate);
  return (
    <li className="rounded border border-red-700/40 bg-red-950/30 p-2 text-sm">
      <div className="font-semibold text-red-200">
        {itemLabel(conflict.kind, conflict.key)}采集冲突
      </div>
      <p className="mt-0.5 text-xs text-red-100/70">
        {conflict.resolvedRecordId
          ? `已裁决采信 ${conflict.resolvedRecordId}；可重新裁决或忽略该项。`
          : '不同入口/时刻采到不同取值，已全部保留；请裁决后再参与辨证。'}
      </p>
      <ul className="mt-1.5 space-y-1">
        {conflict.records.map((record) => (
          <li key={record.id} className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="radio"
              name={`conflict-${conflict.kind}-${conflict.key}`}
              checked={conflict.resolvedRecordId === record.id}
              onChange={() =>
                adjudicate({ kind: conflict.kind, key: conflict.key, decision: 'pick', recordId: record.id })
              }
            />
            <span className="font-mono">{record.id}</span>
            <span className="rounded bg-stone-700 px-1">{SOURCE_LABEL[record.source]}诊</span>
            <span className="text-stone-300">时刻 {record.recordedAt}</span>
            <span className={record.value === 'false' ? 'text-stone-400' : 'text-amber-200'}>
              {VALUE_LABEL[record.value] ?? record.value}
            </span>
            {record.note ? <span className="text-stone-400">（{record.note}）</span> : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-1.5 text-xs text-red-200 underline underline-offset-2 hover:text-red-100"
        onClick={() => adjudicate({ kind: conflict.kind, key: conflict.key, decision: 'ignore' })}
      >
        忽略此项（不参与辨证）
      </button>
    </li>
  );
}

export default function CollectionPanel() {
  const collect = useClinicStore((s) => s.collect);
  const records = useClinicStore((s) => s.records);
  const conflicts = useClinicStore((s) => s.conflicts);

  const latestValue = new Map<string, string>();
  for (const record of records) latestValue.set(`${record.kind}:${record.key}`, record.value);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2">
        {SOURCE_GROUPS.map((group) => (
          <div key={group.source} className="rounded-lg border border-amber-900/40 bg-[#f5deb3]/95 p-3 text-stone-800">
            <div className="flex items-baseline justify-between">
              <h3 className="font-serif text-lg font-bold text-amber-900">{group.title}</h3>
              <span className="text-xs text-stone-500">{group.subtitle}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const key = `${item.kind}:${item.key}`;
                const value = latestValue.get(key);
                return (
                  <div
                    key={key}
                    className="inline-flex overflow-hidden rounded border border-amber-900/40 text-xs"
                  >
                    <span className="bg-amber-100/70 px-2 py-1">{item.label}</span>
                    <button
                      type="button"
                      className={`px-2 py-1 transition active:scale-95 ${
                        value === 'true' ? 'bg-amber-800 text-amber-50' : 'bg-amber-50 hover:bg-amber-100'
                      }`}
                      onClick={() => collect(item.kind, item.key, 'true', group.source)}
                    >
                      记有
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 transition active:scale-95 ${
                        value === 'false' ? 'bg-stone-700 text-amber-50' : 'bg-amber-50 hover:bg-amber-100'
                      }`}
                      onClick={() => collect(item.kind, item.key, 'false', group.source)}
                    >
                      记无
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-amber-900/40 bg-[#3a2817] p-3 text-stone-200">
        <h3 className="font-serif text-lg font-bold text-amber-200">采集记录与冲突裁决</h3>
        {conflicts.length > 0 && (
          <ul className="mt-2 space-y-2">
            {conflicts.map((conflict) => (
              <ConflictRow key={`${conflict.kind}:${conflict.key}`} conflict={conflict} />
            ))}
          </ul>
        )}
        {records.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">尚无采集记录。点击「记有 / 记无」即追加一条记录，重复采集不会覆盖旧值。</p>
        ) : (
          <ul className="mt-2 max-h-56 space-y-1 overflow-auto pr-1 text-sm">
            {records.map((record) => (
              <li key={record.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-stone-400">{record.id}</span>
                <span className="rounded bg-stone-700 px-1 text-xs">{SOURCE_LABEL[record.source]}诊</span>
                <span className="text-xs text-stone-400">t{record.recordedAt}</span>
                <span>{itemLabel(record.kind, record.key)}</span>
                <span className="text-xs text-stone-500">[{KIND_LABEL[record.kind]}]</span>
                <RecordValue record={record} />
                {record.note ? <span className="text-xs text-stone-500">（{record.note}）</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
