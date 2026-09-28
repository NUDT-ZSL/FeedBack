import { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, dayjsLocalizer } from 'react-big-calendar';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import {
  CalendarDays,
  Plus,
  MapPin,
  StickyNote,
  User,
  X,
  Clock,
  Trash2,
  Edit,
  AlertCircle,
} from 'lucide-react';
import type { Interview, Application } from '../types';
import { interviewApi, applicationApi, playApi } from '../api';
import { useStore } from '../store/useStore';
import { formatDateTime, formatDate, formatTime } from '../utils/format';

dayjs.locale('zh-cn');
const localizer = dayjsLocalizer(dayjs);

const locales = {
  'zh-cn': {
    month: '月视图',
    week: '周视图',
    work_week: '工作日',
    day: '日视图',
    agenda: '列表',
    today: '今天',
    previous: '上一页',
    next: '下一页',
    showMore: (total: number) => `+${total} 更多`,
    allDay: '全天',
    date: '日期',
    time: '时间',
    event: '面试',
    noEventsInRange: '该时段没有面试安排',
  },
};

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  interview: Interview;
  resource?: Record<string, unknown>;
}

export default function ScheduleView() {
  const user = useStore((s) => s.user);
  const interviews = useStore((s) => s.interviews);
  const loadInterviews = useStore((s) => s.loadInterviews);
  const updateOrAddInterview = useStore((s) => s.updateOrAddInterview);
  const removeInterview = useStore((s) => s.removeInterview);
  const showToast = useStore((s) => s.showToast);
  const isDirector = user?.role === 'director';
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<Application[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<Interview | null>(null);
  const [form, setForm] = useState({
    applicationId: '',
    startTime: '',
    endTime: '',
    location: '',
    notes: '',
  });
  const [rangeError, setRangeError] = useState('');
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadInterviews();
        if (isDirector) {
          try {
            const apps = await applicationApi.myApplications();
            setApplications([]);
            const allPlays = await playApi.list({ pageSize: 100 });
            const allApps: Application[] = [];
            for (const p of allPlays.items) {
              if (p.directorId === user?.id) {
                for (const role of p.roles) {
                  try {
                    const roleApps = await (
                      await fetch(`/api/roles/${role.id}/applications`, {
                        headers: {
                          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
                        },
                      })
                    ).json();
                    if (Array.isArray(roleApps)) {
                      allApps.push(...roleApps.filter((a) => a.status !== 'rejected'));
                    }
                  } catch (_err) {
                    /* ignore */
                  }
                }
              }
            }
            setApplications(allApps);
          } catch (_err) {
            /* ignore */
          }
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadInterviews, isDirector, user?.id]);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    return interviews.map((iv) => {
      const actorName = iv.application?.actor?.name || '未知演员';
      const roleName = iv.application?.role?.name || '';
      const title = isDirector
        ? `${actorName} - ${roleName}`
        : `${roleName ? `《${iv.application?.role?.playTitle}》${roleName}` : '面试'}`;
      return {
        id: iv.id,
        title,
        start: new Date(iv.startTime),
        end: new Date(iv.endTime),
        interview: iv,
      };
    });
  }, [interviews, isDirector]);

  const unscheduledActors = useMemo(() => {
    const scheduledIds = new Set(interviews.map((i) => i.applicationId));
    return applications.filter((a) => !scheduledIds.has(a.id) && a.status !== 'rejected');
  }, [applications, interviews]);

  const eventPropGetter = (event: CalendarEvent) => {
    const iv = event.interview;
    const mine = iv.application?.actorId === user?.id || iv.directorId === user?.id;
    return {
      style: {
        border: `2px solid ${mine ? 'rgba(212, 175, 55, 0.8)' : 'rgba(212, 175, 55, 0.4)'}`,
        borderRadius: '8px',
        padding: '2px 6px',
        cursor: 'pointer',
      },
    };
  };

  const handleSelectSlot = (slotInfo: { start: Date; end: Date }) => {
    if (!isDirector) return;
    setRangeError('');
    const now = new Date();
    if (slotInfo.start < now) {
      setRangeError('不能安排过去的时间');
      return;
    }
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
        d.getMinutes()
      )}`;
    setForm({
      applicationId: '',
      startTime: fmt(slotInfo.start),
      endTime: fmt(slotInfo.end),
      location: '',
      notes: '',
    });
    setSelectedInterview(null);
    setShowModal(true);
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    const iv = event.interview;
    setSelectedInterview(iv);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`;
    };
    setForm({
      applicationId: iv.applicationId,
      startTime: fmt(iv.startTime),
      endTime: fmt(iv.endTime),
      location: iv.location,
      notes: iv.notes,
    });
    setRangeError('');
    setShowModal(true);
  };

  const handleDragDrop = (_event: React.DragEvent, appId: string, slotStart: Date, slotEnd: Date) => {
    if (!isDirector) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
        d.getMinutes()
      )}`;
    setForm({
      applicationId: appId,
      startTime: fmt(slotStart),
      endTime: fmt(slotEnd),
      location: '',
      notes: '',
    });
    setSelectedInterview(null);
    setRangeError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.applicationId) {
      setRangeError('请选择面试演员');
      return;
    }
    if (new Date(form.endTime) <= new Date(form.startTime)) {
      setRangeError('结束时间必须晚于开始时间');
      return;
    }
    try {
      if (selectedInterview) {
        const updated = await interviewApi.update(selectedInterview.id, form);
        updateOrAddInterview(updated);
        showToast('面试安排已更新', 'success');
      } else {
        const created = await interviewApi.create(form);
        updateOrAddInterview(created);
        showToast('面试安排已创建，演员将收到通知', 'success');
      }
      setShowModal(false);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleDelete = async () => {
    if (!selectedInterview) return;
    if (!confirm('确定删除此面试安排？演员将收到通知。')) return;
    try {
      await interviewApi.delete(selectedInterview.id);
      removeInterview(selectedInterview.id);
      showToast('面试安排已删除', 'success');
      setShowModal(false);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin w-12 h-12 border-4 border-gold-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 fade-in-up">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-11 h-11 wine-gradient rounded-xl flex items-center justify-center shadow-lg shadow-wine-900/40">
              <CalendarDays className="w-6 h-6 text-gold-400" />
            </div>
            <div>
              <h1 className="page-title">面试日程</h1>
              <p className="text-theater-textDim text-sm mt-1">
                {isDirector
                  ? '拖拽日历空白处创建面试时段，从右侧列表拖拽演员分配'
                  : '查看您被安排的面试时间，点击时段查看详情'}
              </p>
            </div>
          </div>
        </div>
        {isDirector && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-theater-textDim">
              未安排：{unscheduledActors.length} 人
            </span>
            <button
              onClick={() => {
                const now = new Date();
                const then = new Date(now.getTime() + 3600 * 1000);
                handleSelectSlot({ start: now, end: then });
              }}
              className="btn-gold text-sm"
            >
              <Plus className="w-4 h-4" />
              新建面试
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 card p-4 md:p-6 fade-in-up" style={{ animationDelay: '0.05s' }}>
          <div ref={calendarRef} className="rbc-calendar-dark">
            <Calendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              style={{ height: 'calc(100vh - 280px)', minHeight: 500 }}
              defaultView={isMobile ? 'week' : 'month'}
              selectable={isDirector}
              views={['month', 'week', 'day', 'agenda']}
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventPropGetter}
              culture="zh-cn"
              messages={locales['zh-cn']}
              popup
            />
          </div>
        </div>

        {isDirector && (
          <aside className="space-y-4 fade-in-up" style={{ animationDelay: '0.1s' }}>
            <div className="card p-5 sticky top-6">
              <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                <User className="w-4 h-4 text-gold-400" />
                待安排演员
              </h3>
              {unscheduledActors.length === 0 ? (
                <div className="text-center py-8">
                  <User className="w-10 h-10 text-theater-textMuted mx-auto mb-2 opacity-30" />
                  <p className="text-sm text-theater-textMuted">暂无待安排演员</p>
                </div>
              ) : (
                <ul className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
                  {unscheduledActors.map((app) => (
                    <li
                      key={app.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('applicationId', app.id);
                      }}
                      onDragEnd={(e) => {
                        const el = document.elementFromPoint(
                          e.clientX,
                          e.clientY
                        ) as HTMLElement | null;
                        if (el && calendarRef.current?.contains(el)) {
                          const now = new Date();
                          const start = new Date(
                            now.getFullYear(),
                            now.getMonth(),
                            now.getDate(),
                            10
                          );
                          const end = new Date(
                            now.getFullYear(),
                            now.getMonth(),
                            now.getDate(),
                            11
                          );
                          handleDragDrop(e, app.id, start, end);
                        }
                      }}
                      className="p-3 rounded-xl bg-theater-bg border-2 border-dashed border-gold-500/40
                        hover:border-gold-400 hover:bg-gold-500/5 transition-all
                        cursor-grab active:cursor-grabbing group"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={app.actor?.avatar}
                          alt={app.actor?.name}
                          className="w-9 h-9 rounded-full border border-gold-500/30 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-theater-text text-sm truncate">
                            {app.actor?.name}
                          </p>
                          <p className="text-xs text-theater-textMuted truncate">
                            {app.role?.playTitle} · {app.role?.name}
                          </p>
                        </div>
                      </div>
                      <p className="text-[11px] text-theater-textMuted mt-2 line-clamp-2">
                        {app.introduction}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in-up"
            onClick={() => setShowModal(false)}
          />
          <div className="relative w-full max-w-xl card !rounded-2xl !shadow-cardHover overflow-hidden animate-fade-in-up">
            <div className="wine-gradient px-6 py-5 border-b border-theater-border">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold text-white">
                    {selectedInterview ? '编辑面试安排' : '创建面试安排'}
                  </h2>
                  <p className="text-sm text-gold-300/80 mt-1">
                    {selectedInterview ? '修改面试时间、地点等信息' : '为演员安排面试时段'}
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="input-label flex items-center gap-2">
                  <User className="w-4 h-4 text-gold-400" />
                  候选演员 <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.applicationId}
                  onChange={(e) => setForm({ ...form, applicationId: e.target.value })}
                  className="input"
                  disabled={!!selectedInterview}
                  required
                >
                  <option value="">请选择演员...</option>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.actor?.name} - 《{a.role?.playTitle}》{a.role?.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="input-label flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gold-400" />
                    开始时间 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="input-label flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gold-400" />
                    结束时间 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className="input"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="input-label flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gold-400" />
                  面试地点
                </label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="例如：戏剧社三楼排练厅A"
                  className="input"
                />
              </div>

              <div>
                <label className="input-label flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-gold-400" />
                  备注说明
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  placeholder="请输入面试注意事项、准备内容等..."
                  className="input resize-none"
                />
              </div>

              {rangeError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {rangeError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {selectedInterview ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="btn-danger text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="btn-ghost text-sm"
                  >
                    取消
                  </button>
                  <button type="submit" className="btn-gold text-sm min-w-[120px]">
                    {selectedInterview ? '保存修改' : '确认安排'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
