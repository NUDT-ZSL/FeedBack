import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home,
  Scroll,
  FileText,
  CalendarDays,
  Bell,
  LogOut,
  Menu,
  Theater,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../../store/useStore';

export default function Sidebar() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const unreadCount = useStore((s) => s.unreadCount);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/', icon: Home, label: '首页' },
    ...(user?.role === 'director'
      ? [{ to: '/my-plays', icon: Scroll, label: '我的剧本' }]
      : []),
    ...(user?.role === 'actor'
      ? [{ to: '/my-applications', icon: FileText, label: '我的报名' }]
      : []),
    ...(user
      ? [{ to: '/schedule', icon: CalendarDays, label: '面试日程' }]
      : []),
    ...(user
      ? [{ to: '/notifications', icon: Bell, label: '通知中心', badge: unreadCount }]
      : []),
  ];

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-5 border-b border-theater-border">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 wine-gradient rounded-xl flex items-center justify-center shadow-lg shadow-wine-900/40">
            <Theater className="w-6 h-6 text-gold-400" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold gold-gradient-text leading-none">
              戏剧社
            </h1>
            <p className="text-xs text-theater-textMuted mt-1">演员招募系统</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''} group relative`
            }
          >
            <item.icon className="w-5 h-5 shrink-0 transition-transform group-hover:scale-110" />
            <span className="flex-1 text-sm font-medium">{item.label}</span>
            {item.badge && item.badge > 0 ? (
              <span className="badge bg-gold-500 text-wine-950 animate-pulse-slow min-w-[20px]">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}

        {user?.role === 'director' && (
          <div className="pt-4 mt-4 border-t border-theater-border">
            <NavLink
              to="/play/create"
              onClick={() => setMobileOpen(false)}
              className="btn-gold w-full text-sm"
            >
              <UserPlus className="w-4 h-4" />
              发布新剧本
            </NavLink>
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-theater-border">
        {user ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-2">
              <img
                src={user.avatar}
                alt={user.name}
                className="w-10 h-10 rounded-full border-2 border-gold-500/40"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-theater-text truncate">
                  {user.name}
                </p>
                <p className="text-xs text-theater-textMuted">
                  {user.role === 'director' ? '导演' : '演员'}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="sidebar-link w-full !justify-start text-red-400 hover:!bg-red-500/10 hover:!text-red-300"
            >
              <LogOut className="w-5 h-5" />
              <span className="text-sm font-medium">退出登录</span>
            </button>
          </div>
        ) : (
          <NavLink to="/login" className="btn-primary w-full text-sm">
            登录 / 注册
          </NavLink>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        className="fixed top-4 left-4 z-50 md:hidden btn-ghost !p-2"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="w-6 h-6" />
      </button>

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-theater-card/95 backdrop-blur-md
          border-r border-theater-border transform transition-transform duration-300 ease-theater
          md:translate-x-0 md:static
          ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:shadow-none'}`}
      >
        {SidebarContent}
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden animate-fade-in-up"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </>
  );
}
