import { useState } from 'react';
import {
  SYMPTOMS,
  PULSES,
  TONGUES,
  CONSTITUTIONS,
  HISTORIES,
} from '@/engine/knowledge';
import { useClinicStore, KIND_LABEL } from '@/store/clinicStore';

const panel =
  'rounded border border-[#3a3a3a] bg-[#f5deb3] p-4 shadow-md text-[#3a2a14]';
const btn =
  'rounded border border-[#3a3a3a] bg-[#8b6f47] px-3 py-1.5 text-sm text-[#f5deb3] transition-transform active:scale-95 hover:bg-[#6f5836]';
const select =
  'rounded border border-[#3a3a3a] bg-[#fdf3d8] px-2 py-1.5 text-sm text-[#3a2a14]';

export function IntakePanel() {
  const collect = useClinicStore((s) => s.collect);
  const records = useClinicStore((s) => s.records);
  const [pulse, setPulse] = useState<string>(PULSES[0]);
  const [tongue, setTongue] = useState<string>(TONGUES[0]);
  const [constitution, setConstitution] = useState<string>(CONSTITUTIONS[0]);
  const [history, setHistory] = useState<string>(HISTORIES[0]);

  const collected = (kind: string, key: string, value: string) =>
    records.filter(
      (r) => r.kind === kind && r.key === key && r.value === value && r.status !== 'rejected'
    ).length;

  return (
    <section className={panel}>
      <h2 className="mb-3 text-lg font-bold">四诊采集</h2>

      <h3 className="mb-1 text-sm font-semibold">问诊 · 症状（可重复采集，逐条留痕）</h3>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SYMPTOMS.map((s) => {
          const n = collected('symptom', s.id, 'present');
          return (
            <button
              key={s.id}
              className={`${btn} ${n > 0 ? 'ring-2 ring-[#2ecc71]' : ''}`}
              onClick={() => collect('symptom', s.id, 'present', '问诊')}
            >
              {s.name}
              {n > 0 ? `×${n}` : ''}
            </button>
          );
        })}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="text-sm">
          切诊 · 脉象
          <div className="mt-1 flex gap-1">
            <select className={select} value={pulse} onChange={(e) => setPulse(e.target.value)}>
              {PULSES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button className={btn} onClick={() => collect('pulse', 'pulse', pulse, '切诊')}>
              采集
            </button>
          </div>
        </label>
        <label className="text-sm">
          望诊 · 舌象
          <div className="mt-1 flex gap-1">
            <select className={select} value={tongue} onChange={(e) => setTongue(e.target.value)}>
              {TONGUES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button className={btn} onClick={() => collect('tongue', 'tongue', tongue, '望诊')}>
              采集
            </button>
          </div>
        </label>
        <label className="text-sm">
          体质
          <div className="mt-1 flex gap-1">
            <select
              className={select}
              value={constitution}
              onChange={(e) => setConstitution(e.target.value)}
            >
              {CONSTITUTIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              className={btn}
              onClick={() => collect('constitution', 'constitution', constitution, '问诊')}
            >
              采集
            </button>
          </div>
        </label>
        <label className="text-sm">
          既往病史
          <div className="mt-1 flex gap-1">
            <select className={select} value={history} onChange={(e) => setHistory(e.target.value)}>
              {HISTORIES.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
            <button
              className={btn}
              onClick={() => collect('history', 'history', history, '问诊')}
            >
              采集
            </button>
          </div>
        </label>
      </div>

      <h3 className="mb-1 text-sm font-semibold">采集记录（按来源与时刻留痕）</h3>
      <ul className="max-h-44 space-y-1 overflow-y-auto text-xs">
        {records.length === 0 && <li className="opacity-60">尚未采集</li>}
        {records.map((r) => (
          <li
            key={r.id}
            className={`flex items-center justify-between rounded bg-[#fdf3d8] px-2 py-1 ${
              r.status === 'rejected' ? 'opacity-40 line-through' : ''
            }`}
          >
            <span>
              [{r.source}] {KIND_LABEL[r.kind]}·
              {r.kind === 'symptom'
                ? SYMPTOMS.find((x) => x.id === r.key)?.name ?? r.key
                : r.value === 'present'
                  ? r.key
                  : r.value}
              {r.kind === 'symptom' ? '：有' : ''}
            </span>
            <span className="ml-2 whitespace-nowrap opacity-70">
              #{r.id} t={r.collectedAt}{' '}
              {r.status === 'adjudicated' ? '已采纳' : r.status === 'rejected' ? '已弃用' : '待裁决'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
