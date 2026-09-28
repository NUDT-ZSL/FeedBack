import { useState, useEffect, useRef } from 'react';
import { Bell, X, CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { formatRelativeTime } from '../../utils/format';

export default function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.unreadCount);
  const markRead = useStore((s) => s.markNotificationsRead);
  const showToast = useStore((s) => s.showToast);
  const loadNotifications = useStore((s) => s.loadNotifications);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = async () => {
    if (!open) {
      try {
        await loadNotifications();
      } catch (_err) {
        /* ignore */
      }
    }
    setOpen(!open);
  };

  const handleMarkAll = async () => {
    try {
      await markRead();
      showToast('已全部标记为已读', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleClickNotif = (link: string) => {
    setOpen(false);
    navigate(link);
  };

  const latest = notifications.slice(0, 5);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={handleToggle}
        className="relative btn-ghost !p-2.5 hover:!bg-theater-cardHover"
        aria-label="通知"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-gold-500 text-wine-950 text-[10px]
              font-bold rounded-full flex items-center justify-center animate-pulse-slow
              ring-2 ring-theater-card"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] card !rounded-2xl
            !shadow-cardHover overflow-hidden animate-slide-in z-50"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-theater-border bg-wine-900/30">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-gold-400" />
              <h3 className="font-display text-lg font-semibold">通知中心</h3>
              {unreadCount > 0 && (
                <span className="badge bg-gold-500/20 text-gold-400">
                  {unreadCount} 条未读
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="text-xs text-gold-400 hover:text-gold-300
                    flex items-center gap-1 px-2 py-1 rounded hover:bg-gold-500/10 transition-all"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  全部已读
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-theater-textMuted hover:text-theater-text p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {latest.length === 0 ? (
              <div className="py-16 text-center">
                <Bell className="w-12 h-12 text-theater-textMuted mx-auto mb-3 opacity-40" />
                <p className="text-theater-textMuted text-sm">暂无通知</p>
              </div>
            ) : (
              <ul className="divide-y divide-theater-border/60">
                {latest.map((n, idx) => (
                  <li
                    key={n.id}
                    onClick={() => handleClickNotif(n.link)}
                    className={`px-5 py-4 cursor-pointer transition-all hover:bg-theater-cardHover
                      ${!n.read ? 'bg-gold-500/5' : ''}`}
                    style={{ animationDelay: `${idx * 0.05}s` }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-2 h-2 rounded-full mt-2 shrink-0
                          ${!n.read ? 'bg-gold-500' : 'bg-transparent'}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-sm font-medium ${
                              !n.read ? 'text-theater-text' : 'text-theater-textDim'
                            }`}
                          >
                            {n.title}
                          </p>
                          <ExternalLink className="w-3.5 h-3.5 text-theater-textMuted shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-sm text-theater-textDim mt-1 line-clamp-2">
                          {n.content}
                        </p>
                        <p className="text-xs text-theater-textMuted mt-2">
                          {formatRelativeTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {notifications.length > 5 && (
            <div className="px-5 py-3 border-t border-theater-border bg-theater-bg/40">
              <button
                onClick={() => handleClickNotif('/notifications')}
                className="w-full text-sm text-gold-400 hover:text-gold-300
                  font-medium py-2 rounded-lg hover:bg-gold-500/10 transition-all"
              >
                查看全部 {notifications.length} 条通知 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
