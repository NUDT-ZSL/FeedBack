import React, { useState, useCallback, useMemo } from 'react';
import Timeline from './Timeline';
import EventEditor from './EventEditor';
import { TimelineEvent, TimelineBranch, ViewportState, EventCategory } from './types';

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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewport, setViewport] = useState<ViewportState>({
    centerDate: new Date(today),
    monthsVisible: 12,
    zoom: 1,
    panX: 0,
  });

  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
    );
  }, [events, searchQuery]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) || null,
    [events, selectedEventId]
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
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, isDeleting: true } : e))
    );
    const relatedBranchIds = branches.filter((b) => b.parentEventId === id).map((b) => b.id);

    setTimeout(() => {
      setEvents((prev) => prev.filter((e) => e.id !== id && e.branchId !== id && !relatedBranchIds.includes(e.branchId || '')));
      setBranches((prev) => prev.filter((b) => b.parentEventId !== id));
    }, 200);

    if (selectedEventId === id) {
      setSelectedEventId(null);
    }
  }, [branches, selectedEventId]);

  const handleEventDateChange = useCallback((id: string, date: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, date } : e))
    );
  }, []);

  const handleAddBranch = useCallback((parentEventId: string) => {
    const parentEvent = events.find((e) => e.id === parentEventId);
    if (!parentEvent) return;

    const existingBranches = branches.filter((b) => b.parentEventId === parentEventId);
    if (existingBranches.length >= 3) return;

    const newBranch: TimelineBranch = {
      id: genId(),
      name: `分支 ${existingBranches.length + 1}`,
      parentEventId,
    };

    const branchDate = new Date(parentEvent.date);
    branchDate.setDate(branchDate.getDate() + 7);

    const branchEvent: TimelineEvent = {
      id: genId(),
      title: '分支事件',
      date: formatDate(branchDate),
      description: '',
      category: parentEvent.category,
      branchId: newBranch.id,
      parentId: parentEventId,
      createdAt: Date.now(),
      isNew: true,
    };

    setBranches((prev) => [...prev, newBranch]);
    setEvents((prev) => [...prev, branchEvent]);
  }, [events, branches]);

  const handleRemoveBranch = useCallback((branchId: string) => {
    setBranches((prev) => prev.filter((b) => b.id !== branchId));
    setEvents((prev) => prev.filter((e) => e.branchId !== branchId));
  }, []);

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
        <div className="timeline-container">
          <Timeline
            events={filteredEvents}
            branches={branches}
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
        branches={branches}
        onChange={handleUpdateEvent}
        onDelete={handleDeleteEvent}
        onAddBranch={handleAddBranch}
        onRemoveBranch={handleRemoveBranch}
      />
    </div>
  );
};

export default App;
