import { useReducer, useRef, useState, type ReactNode } from 'react';
import { buildDemoStore, type CrossSessionConflict } from '@/orchestration';

const RESOURCE_KINDS = ['vessel', 'cutlery', 'tray', 'ritual'];
const KIND_LABEL: Record<string, string> = {
  vessel: '酒器',
  cutlery: '食具',
  tray: '盛器',
  ritual: '礼器',
};

export default function Home() {
  const [store] = useState(buildDemoStore);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const act = (fn: () => void) => {
    fn();
    bump();
  };

  const sessions = store.listSessions();
  const activeId = store.getActiveSessionId();
  const active = activeId ? store.getSessionState(activeId) : undefined;
  const participants = store.getParticipants();
  const resources = store.getResources();
  const crossConflicts = store.getCrossSessionConflicts();
  const activeCross: CrossSessionConflict[] = activeId ? crossConflicts.get(activeId) ?? [] : [];
  const seqRef = useRef(100);

  const addSession = () => {
    const id = `s${seqRef.current++}`;
    const firstParticipant = Object.values(participants)[0];
    const firstResource = Object.values(resources)[0];
    store.addSession(
      { id, name: `场次 ${id}` },
      [{ id: `${id}-slot`, sessionId: id, start: 0, end: 60, label: '辰时' }],
      firstParticipant && firstResource
        ? [
            {
              id: `${id}-q`,
              sessionId: id,
              participantId: firstParticipant.id,
              resourceId: firstResource.id,
              slotId: `${id}-slot`,
              priority: 0,
            },
          ]
        : [],
    );
    store.switchSession(id);
    bump();
  };

  return (
    <div className="min-h-screen bg-[#1a0f0a] text-amber-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6 flex items-end justify-between border-b border-[#b8860b]/40 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-wide text-[#ffd700]">多场次编排台</h1>
            <p className="mt-1 text-sm text-amber-200/70">
              场次各自持有参与者引用、资源项占用与时段分配；切换场次不重排，共享池改动仅重推受影响场次。
            </p>
          </div>
          <button
            onClick={() => act(addSession)}
            className="rounded border border-[#b8860b] px-3 py-1.5 text-sm text-[#ffd700] hover:bg-[#b8860b]/20"
          >
            ＋ 新增场次
          </button>
        </header>

        {/* 场次切换栏 */}
        <div className="mb-6 flex flex-wrap gap-2">
          {sessions.map(({ session, runVersion, result }) => {
            const isActive = session.id === activeId;
            const conflictCount = result.conflicts.length + (crossConflicts.get(session.id)?.length ?? 0);
            return (
              <div
                key={session.id}
                className={`group flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                  isActive
                    ? 'border-[#ffd700] bg-[#ffd700]/15 text-[#ffd700]'
                    : 'border-[#6d4c41] text-amber-200/80 hover:border-[#b8860b]'
                }`}
              >
                <button onClick={() => act(() => store.switchSession(session.id))}>
                  {session.name}
                  <span className="ml-2 rounded bg-black/30 px-1.5 py-0.5 text-xs">重推 {runVersion}</span>
                  {conflictCount > 0 && (
                    <span className="ml-1 rounded bg-red-800/70 px-1.5 py-0.5 text-xs">冲突 {conflictCount}</span>
                  )}
                </button>
                <button
                  title="删除场次"
                  onClick={() => act(() => store.removeSession(session.id))}
                  className="text-amber-200/40 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {sessions.length === 0 && <p className="text-sm text-amber-200/50">暂无场次，点击右上角新增。</p>}
        </div>

        {active ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            {/* 当前场次编排结果 */}
            <section className="space-y-5">
              <Panel title={`编排结果 · ${active.session.name}`} hint={`digest ${active.result.digest}`}>
                {active.result.assignments.length === 0 ? (
                  <Empty text="该场次尚无有效分配" />
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-amber-200/60">
                        <th className="py-1 pr-2 font-normal">序</th>
                        <th className="py-1 pr-2 font-normal">时段</th>
                        <th className="py-1 pr-2 font-normal">参与者</th>
                        <th className="py-1 font-normal">资源项</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.result.assignments.map((assignment) => {
                        const slot = active.slots.find((s) => s.id === assignment.slotId);
                        return (
                          <tr key={assignment.id} className="border-t border-[#3e2723]">
                            <td className="py-1.5 pr-2 text-amber-200/60">{assignment.order}</td>
                            <td className="py-1.5 pr-2">
                              {slot?.label ?? assignment.slotId}
                              <span className="ml-1 text-xs text-amber-200/40">
                                {slot ? `${slot.start}-${slot.end}` : ''}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2">{participants[assignment.participantId]?.name ?? '—'}</td>
                            <td className="py-1.5">{resources[assignment.resourceId]?.name ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Panel>

              <Panel title="场内冲突">
                {active.result.conflicts.length === 0 ? (
                  <Empty text="无场内冲突" />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {active.result.conflicts.map((conflict) => (
                      <li key={conflict.id} className="text-red-300">
                        {conflict.type === 'resource-overlap' ? '资源项并发超限' : '参与者时段重叠'}：
                        {resources[conflict.entityId]?.name ?? participants[conflict.entityId]?.name ?? conflict.entityId}
                        ，涉及时段 [{conflict.slotIds.join(', ')}]
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="跨场次占用冲突（按本场归属呈现）">
                {activeCross.length === 0 ? (
                  <Empty text="无跨场次冲突" />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {activeCross.map((conflict) => (
                      <li key={`${conflict.id}-${conflict.attributedTo}`} className="text-orange-300">
                        {resources[conflict.resourceId]?.name ?? conflict.resourceId} 与场次
                        {conflict.sessionIds.filter((id) => id !== active.session.id).map((id) => store.getSessionState(id)?.session.name ?? id).join('、')}
                        同时占用，重叠区间 [{conflict.interval.start}, {conflict.interval.end})
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {active.result.rejections.length > 0 && (
                <Panel title="失效与被拒请求">
                  <ul className="space-y-1 text-sm">
                    {active.result.rejections.map((rejection) => (
                      <li key={rejection.requestId} className="text-amber-300/80">
                        {rejection.requestId} · {rejection.reason} · {rejection.detail}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </section>

            {/* 跨场次共享池 */}
            <section className="space-y-5">
              <Panel title="共享参与者池">
                <ul className="space-y-1.5 text-sm">
                  {Object.values(participants).map((participant) => (
                    <li key={participant.id} className="flex items-center justify-between gap-2">
                      <span>
                        {participant.name}
                        <span className="ml-2 text-xs text-amber-200/40">{participant.roles.join('/')}</span>
                      </span>
                      <button
                        onClick={() => act(() => store.removeParticipant(participant.id))}
                        className="rounded border border-[#6d4c41] px-2 py-0.5 text-xs text-amber-200/70 hover:border-red-500 hover:text-red-300"
                      >
                        移除
                      </button>
                    </li>
                  ))}
                  {Object.keys(participants).length === 0 && <Empty text="共享池为空" />}
                </ul>
              </Panel>

              <Panel title="共享资源池">
                <ul className="space-y-1.5 text-sm">
                  {Object.values(resources).map((resource) => {
                    const nextKind =
                      RESOURCE_KINDS[(RESOURCE_KINDS.indexOf(resource.kind) + 1) % RESOURCE_KINDS.length];
                    return (
                      <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {resource.name}
                          <span className="ml-2 text-xs text-amber-200/40">
                            {KIND_LABEL[resource.kind] ?? resource.kind} · 容量 {resource.capacity}
                          </span>
                        </span>
                        <span className="flex gap-1">
                          <button
                            onClick={() =>
                              act(() =>
                                store.upsertResource({
                                  ...resource,
                                  capacity: Math.max(1, resource.capacity - 1),
                                }),
                              )
                            }
                            className="rounded border border-[#6d4c41] px-1.5 py-0.5 text-xs text-amber-200/70 hover:border-[#b8860b]"
                          >
                            容量-
                          </button>
                          <button
                            onClick={() =>
                              act(() =>
                                store.upsertResource({
                                  ...resource,
                                  capacity: resource.capacity + 1,
                                }),
                              )
                            }
                            className="rounded border border-[#6d4c41] px-1.5 py-0.5 text-xs text-amber-200/70 hover:border-[#b8860b]"
                          >
                            容量+
                          </button>
                          <button
                            onClick={() => act(() => store.upsertResource({ ...resource, kind: nextKind }))}
                            className="rounded border border-[#6d4c41] px-1.5 py-0.5 text-xs text-amber-200/70 hover:border-[#b8860b]"
                          >
                            改类型
                          </button>
                          <button
                            onClick={() => act(() => store.removeResource(resource.id))}
                            className="rounded border border-[#6d4c41] px-1.5 py-0.5 text-xs text-amber-200/70 hover:border-red-500 hover:text-red-300"
                          >
                            移除
                          </button>
                        </span>
                      </li>
                    );
                  })}
                  {Object.keys(resources).length === 0 && <Empty text="共享池为空" />}
                </ul>
              </Panel>
            </section>
          </div>
        ) : (
          <Empty text="请选择或新增一个场次" />
        )}
      </div>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#3e2723] bg-[#2a1a12]/80 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-amber-100">{title}</h2>
        {hint && <span className="text-xs text-amber-200/40">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-1 text-sm text-amber-200/40">{text}</p>;
}
