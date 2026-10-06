import React, { useState, useCallback, useMemo } from 'react';
import Timeline from './Timeline';
import EventEditor from './EventEditor';
import { TimelineEvent, TimelineBranch, EventDependency, ViewportState, EventCategory } from './types';
import {
  deriveTimeline,
  computeEventDeletionImpact,
  computeBranchDeletionImpact,
  diffDays,
  DeriveIssue,
} from './lib/derive';

const genId = () => Math.random().toString(36).substring(2, 11);

const today = new Date();
const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const createSampleEvents = (): TimelineEvent[] => {
  const base = new Date(today);
  const events: { title: string; offsetMonths: number; offsetDays: number; category: EventCategory; desc: string }[] = [
    { title: '项目启动会议', offsetMonths: -2, offsetDays: 5, category: 'work', desc: '讨论新项目的整体规划和目标设定' },
    { title: '技术选型调研', offsetMonths: -1, offsetDays: 12, category: 'study', desc: '研究各种技术方案的优劣' },
    { title: '设计初稿评审', offsetMonths: 0, offsetDays: -8, category: 'work', desc: '评审UI/UX设计初稿' },
    { title: '团队建设活动', offsetMonths: 0, offsetDays: 3, category: 'personal', desc: '户外团建活动' },
    { title: '春节假期', offsetMonths: 1, offsetDays: 15, category: 'travel', desc: '回老家过年' },
    { title: '产品原型测试', offsetMonths: 2, offsetDays: -5, category: 'work', desc: '邀请用户进行原型可用性测试' },
  ];

  return events.map((e) => {
    const d = new Date(base);
    d.setMonth(d.getMonth() + e.offsetMonths);
    d.setDate(d.getDate() + e.offsetDays);
    return {
      id: genId(),
      title: e.title,
      date: formatDate(d),
      description: e.desc,
      category: e.category,
      createdAt: Date.now(),
      isNew: true,
    };
  });
};

const App: React.FC = () => {
  const [events, setEvents] = useState<TimelineEvent[]>(createSampleEvents);
  const [branches, setBranches] = useState<TimelineBranch[]>([]);
  const [dependencies, setDependencies] = useState<EventDependency[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewport, setViewport] = useState<ViewportState>({
    centerDate: new Date(today),
    monthsVisible: 12,
    zoom: 1,
    panX: 0,
  });

  // 单一事实来源：所有展示数据都由同一次全量推导产生，
  // 任何局部变更后界面都与全量重推结果一致。
  const derived = useMemo(
    () => deriveTimeline(events, branches, dependencies),
    [events, branches, dependencies]
  );

  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return derived.events;
    const q = searchQuery.toLowerCase();
    return derived.events.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
    );
  }, [derived.events, searchQuery]);

  const selectedEvent = useMemo(
    () => derived.events.find((e) => e.id === selectedEventId) || null,
    [derived.events, selectedEventId]
  );

  const handleAddEvent = useCallback(() => {
    const now = new Date();
    const newEvent: TimelineEvent = {
      id: genId(),
      title: '新事件',
      date: formatDate(now),
      description: '',
      category: 'work',
      createdAt: Date.now(),
      isNew: true,
    };
    setEvents((prev) => [...prev, newEvent]);
    setSelectedEventId(newEvent.id);
  }, []);

  const handleUpdateEvent = useCallback((updated: TimelineEvent) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === updated.id ? { ...updated, isNew: false } : e))
    );
  }, []);

  const handleDeleteEvent = useCallback((id: string) => {
    const impact = computeEventDeletionImpact(events, branches, dependencies, id);
    setEvents((prev) =>
      prev.map((e) => (impact.removedEventIds.has(e.id) ? { ...e, isDeleting: true } : e))
    );

    setTimeout(() => {
      setEvents((prev) => prev.filter((e) => !impact.removedEventIds.has(e.id)));
      setBranches((prev) => prev.filter((b) => !impact.removedBranchIds.has(b.id)));
      // 依赖不随删除清理：变为悬空依赖，由推导层上报、人工裁决
    }, 200);

    if (selectedEventId && impact.removedEventIds.has(selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, branches, dependencies, selectedEventId]);

  const handleEventDateChange = useCallback((id: string, date: string) => {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        // 手动拖拽分支事件：脱离偏移模式，不再被主事件重排覆盖
        if (e.branchId) return { ...e, date, offsetDays: null };
        return { ...e, date };
      })
    );
  }, []);

  const handleAddBranch = useCallback((parentEventId: string) => {
    const parentEvent = derived.events.find((e) => e.id === parentEventId);
    if (!parentEvent) return;

    const existingBranches = branches.filter((b) => b.parentEventId === parentEventId);
    if (existingBranches.length >= 3) return;

    const newBranch: TimelineBranch = {
      id: genId(),
      name: `分支 ${existingBranches.length + 1}`,
      parentEventId,
    };

    const branchEvent: TimelineEvent = {
      id: genId(),
      title: '分支事件',
      date: parentEvent.date,
      description: '',
      category: parentEvent.category,
      branchId: newBranch.id,
      parentId: parentEventId,
      offsetDays: 7,
      createdAt: Date.now(),
      isNew: true,
    };

    setBranches((prev) => [...prev, newBranch]);
    setEvents((prev) => [...prev, branchEvent]);
  }, [derived.events, branches]);

  const handleRemoveBranch = useCallback((branchId: string) => {
    const impact = computeBranchDeletionImpact(events, dependencies, branchId);
    setEvents((prev) => prev.filter((e) => !impact.removedEventIds.has(e.id)));
    setBranches((prev) => prev.filter((b) => b.id !== branchId));
    if (selectedEventId && impact.removedEventIds.has(selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, dependencies, selectedEventId]);

  const handleAddDependency = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setDependencies((prev) => {
      const exists = prev.some(
        (d) => d.fromId === fromId && d.toId === toId
      );
      if (exists) return prev;
      return [...prev, { id: genId(), fromId, toId }];
    });
  }, []);

  const handleRemoveDependency = useCallback((dependencyId: string) => {
    setDependencies((prev) => prev.filter((d) => d.id !== dependencyId));
  }, []);

  const handleReattach = useCallback((eventId: string) => {
    setEvents((prev) => {
      const target = prev.find((e) => e.id === eventId);
      if (!target || !target.branchId) return prev;
      const branch = branches.find((b) => b.id === target.branchId);
      const parent = branch && prev.find((e) => e.id === branch.parentEventId);
      if (!parent) return prev;
      // 以当前推导出的日期为基准重新计算偏移，挂回偏移模式
      const derivedTarget = derived.events.find((e) => e.id === eventId);
      const offset = diffDays(parent.date, (derivedTarget || target).date);
      return prev.map((e) => (e.id === eventId ? { ...e, offsetDays: offset } : e));
    });
  }, [branches, derived.events]);

  const handleLocateEvent = useCallback((eventId: string) => {
    const target = derived.events.find((e) => e.id === eventId);
    setSelectedEventId(eventId);
    if (target) {
      setViewport((v) => ({ ...v, centerDate: new Date(target.date), panX: 0 }));
    }
  }, [derived.events]);

  const describeIssue = useCallback((issue: DeriveIssue): string => {
    const titleOf = (id: string) =>
      derived.events.find((e) => e.id === id)?.title || '已删除事件';
    if (issue.type === 'cycle') {
      const names = issue.eventIds.map(titleOf).join(' → ');
      return `依赖成环：${names}`;
    }
    if (issue.type === 'dangling') {
      return `悬空依赖：「${titleOf(issue.anchorEventId)}」的约束指向已删除事件`;
    }
    const event = derived.events.find((e) => e.id === issue.eventId);
    return `孤立事件：「${event?.title || issue.eventId}」失去所属${issue.reason === 'missing-branch' ? '分支' : '主事件'}`;
  }, [derived.events]);

  return (
    <div className="app-container">
      <div className="timeline-section">
        <div className="timeline-toolbar">
          <input
            type="text"
            className="search-input"
            placeholder="搜索事件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="add-event-btn" onClick={handleAddEvent}>
            + 添加事件
          </button>
        </div>
        {derived.issues.length > 0 && (
          <div className="issue-panel">
            <div className="issue-panel-title">
              ⚠ 约束问题（{derived.issues.length}）
            </div>
            {derived.issues.map((issue) => (
              <div key={issue.id} className={`issue-item issue-${issue.type}`}>
                <span className="issue-text">{describeIssue(issue)}</span>
                <span className="issue-actions">
                  {issue.type === 'cycle' &&
                    issue.eventIds.map((id) => (
                      <button
                        key={id}
                        className="issue-locate-btn"
                        onClick={() => handleLocateEvent(id)}
                      >
                        定位「{derived.events.find((e) => e.id === id)?.title || id}」
                      </button>
                    ))}
                  {issue.type === 'dangling' && (
                    <>
                      <button
                        className="issue-locate-btn"
                        onClick={() => handleLocateEvent(issue.anchorEventId)}
                      >
                        定位
                      </button>
                      <button
                        className="issue-remove-btn"
                        onClick={() => handleRemoveDependency(issue.dependencyId)}
                      >
                        移除约束
                      </button>
                    </>
                  )}
                  {issue.type === 'orphan' && (
                    <button
                      className="issue-locate-btn"
                      onClick={() => handleLocateEvent(issue.eventId)}
                    >
                      定位
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="timeline-container">
          <Timeline
            events={filteredEvents}
            branches={branches}
            dependencies={dependencies}
            invalidDependencyIds={derived.invalidDependencyIds}
            issueEventIds={derived.issueEventIds}
            viewport={viewport}
            onViewportChange={setViewport}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            onEventDateChange={handleEventDateChange}
          />
        </div>
      </div>
      <EventEditor
        event={selectedEvent}
        events={derived.events}
        branches={branches}
        dependencies={dependencies}
        invalidDependencyIds={derived.invalidDependencyIds}
        branchEventCounts={derived.branchEventCounts}
        onChange={handleUpdateEvent}
        onDelete={handleDeleteEvent}
        onAddBranch={handleAddBranch}
        onRemoveBranch={handleRemoveBranch}
        onAddDependency={handleAddDependency}
        onRemoveDependency={handleRemoveDependency}
        onReattach={handleReattach}
      />
    </div>
  );
};

export default App;
