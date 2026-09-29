import { memo } from 'react';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Search,
  Scissors,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

type MenuKey = 'dashboard' | 'inventory' | 'purchases' | 'track';

const menuConfig: Array<{
  key: MenuKey;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  path: string;
  showBadge?: boolean;
}> = [
  { key: 'dashboard', label: '订单看板', icon: LayoutDashboard, path: '/' },
  { key: 'inventory', label: '库存管理', icon: Package, path: '/inventory' },
  { key: 'purchases', label: '采购记录', icon: ShoppingCart, path: '/purchases' },
  { key: 'track', label: '进度查询', icon: Search, path: '/track' },
];

function SidebarComponent() {
  const {
    sidebarOpen,
    toggleSidebar,
    activeMenu,
    setActiveMenu,
    orders,
    lowStock,
  } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    const matched = menuConfig.find((m) =>
      path === '/' ? m.path === '/' : path.startsWith(m.path),
    );
    if (matched) setActiveMenu(matched.key);
  }, [location.pathname, setActiveMenu]);

  const activeCount = orders.filter(
    (o) => o.status === 'in_progress' || o.status === 'confirmed',
  ).length;

  const handleNavigate = (key: MenuKey, path: string) => {
    setActiveMenu(key);
    navigate(path);
    if (window.innerWidth < 768 && sidebarOpen) toggleSidebar();
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden animate-fadeOut"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
          onClick={toggleSidebar}
        />
      )}
      <aside
        className={`sidebar-leather fixed top-0 left-0 h-full z-40 w-[280px]
          text-brand-cream flex flex-col transition-transform duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0`}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-brown to-[#A67F1D] flex items-center justify-center shadow-lg shadow-black/20">
              <Scissors className="w-6 h-6 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-brand-cream leading-tight">
                匠心皮具
              </h1>
              <p className="text-[10px] text-brand-cream/60 tracking-wider uppercase">
                Leather Atelier
              </p>
            </div>
          </div>
          <button
            type="button"
            className="md:hidden p-2 -mr-2 text-brand-cream/80 hover:text-brand-cream active:scale-90"
            onClick={toggleSidebar}
            aria-label="关闭菜单"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-3 space-y-1 overflow-y-auto scrollbar-thin">
          {menuConfig.map(({ key, label, icon: Icon, path, showBadge }) => {
            const isActive = activeMenu === key;
            const badge =
              key === 'dashboard' ? activeCount :
              key === 'inventory' ? lowStock.length : 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleNavigate(key, path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl
                  transition-all duration-200 group min-h-[48px]
                  ${isActive
                    ? 'bg-gradient-to-r from-brand-brown/90 to-[#A67F1D]/80 text-white shadow-md shadow-black/15'
                    : 'text-brand-cream/80 hover:bg-white/10 hover:text-white'
                  }`}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-110 ${
                    isActive ? 'text-white' : ''
                  }`}
                />
                <span className="flex-1 text-left text-sm font-medium">{label}</span>
                {(showBadge !== false && badge > 0) || badge > 0 ? (
                  <span
                    className={`min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold
                      flex items-center justify-center flex-shrink-0
                      ${
                        key === 'inventory' && badge > 0
                          ? 'bg-danger text-white'
                          : 'bg-danger/90 text-white'
                      }`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="px-6 py-4 border-t border-white/10">
          <div className="text-[10px] text-brand-cream/40 tracking-wider uppercase mb-1">
            在线工人数
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-2.5 h-2.5 rounded-full bg-[#7CB068]" />
              <span className="absolute inset-0 rounded-full bg-[#7CB068] animate-ping opacity-60" />
            </div>
            <span className="font-mono-num text-sm font-semibold">
              3 人在岗
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

SidebarComponent.displayName = 'Sidebar';
export const Sidebar = memo(SidebarComponent);
