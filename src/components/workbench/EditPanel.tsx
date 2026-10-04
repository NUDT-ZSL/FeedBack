import { useState } from 'react';
import type { BatchInput, TaskDecl } from '@/scheduler/index.ts';

interface Props {
  input: BatchInput;
  onApply: (nextInput: BatchInput, label: string) => void;
}

// 局部修正入口：新增声明 / 更新某任务耗时，都会触发“只重推受影响任务”的增量推演。
export function EditPanel({ input, onApply }: Props) {
  const [taskId, setTaskId] = useState('');
  const [duration, setDuration] = useState('1');
  const [source, setSource] = useState('module:manual');
  const [dependsOn, setDependsOn] = useState('');
  const [note, setNote] = useState('');

  const existingIds = [...new Set((input.declarations ?? []).map((decl) => decl.taskId))].sort();

  const applyAdd = (): void => {
    const id = taskId.trim();
    const value = Number(duration);
    if (!id || !Number.isFinite(value) || value < 0 || !source.trim()) return;
    const decl: TaskDecl = {
      taskId: id,
      duration: value,
      source: source.trim(),
      note: note.trim() || undefined,
      dependsOn: dependsOn.split(',').map((item) => item.trim()).filter(Boolean),
    };
    onApply(
      { ...input, declarations: [...(input.declarations ?? []), decl] },
      `新增声明 ${id}（${decl.source}）`,
    );
    setTaskId('');
    setNote('');
    setDependsOn('');
  };

  const applyDurationUpdate = (id: string, nextDuration: number): void => {
    const declarations = (input.declarations ?? []).map((decl) =>
      decl.taskId === id && decl.source === source.trim()
        ? { ...decl, duration: nextDuration }
        : decl,
    );
    onApply({ ...input, declarations }, `修正 ${id} 耗时为 ${nextDuration}（${source.trim()}）`);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">局部修正（触发增量重推）</h2>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2 text-xs text-slate-500">任务标识</label>
        <input className="col-span-2 rounded border border-slate-300 px-2 py-1" value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="如 lint" />
        <label className="col-span-2 text-xs text-slate-500">耗时 / 来源</label>
        <input className="rounded border border-slate-300 px-2 py-1" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="耗时" />
        <input className="rounded border border-slate-300 px-2 py-1" value={source} onChange={(event) => setSource(event.target.value)} placeholder="来源" />
        <label className="col-span-2 text-xs text-slate-500">前置依赖（逗号分隔，可空）</label>
        <input className="col-span-2 rounded border border-slate-300 px-2 py-1" value={dependsOn} onChange={(event) => setDependsOn(event.target.value)} placeholder="如 fetch, lint" />
        <label className="col-span-2 text-xs text-slate-500">来源说明（可空）</label>
        <input className="col-span-2 rounded border border-slate-300 px-2 py-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="这条声明来自哪里、为什么" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white hover:bg-slate-800" onClick={applyAdd}>新增声明</button>
        {existingIds.length > 0 && (
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            onClick={() => {
              const id = taskId.trim() || existingIds[0];
              const value = Number(duration);
              if (!Number.isFinite(value) || value < 0) return;
              applyDurationUpdate(id, value);
            }}
          >
            更新该来源下任务耗时
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">已有任务：{existingIds.join('、') || '（无）'}</p>
    </section>
  );
}
