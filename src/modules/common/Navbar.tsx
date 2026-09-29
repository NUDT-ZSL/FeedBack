import { memo } from 'react';
import { Menu } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useLocation } from 'react-router-dom';

const breadcrumbMap: Record<string, Array<{ label: string; path?: string }>> = {
  '/': [{ label: '订单看板' }],
  '/inventory': [{ label: '库存管理' }],
  '/purchases': [{ label: '采购记录' }],
  '/track': [{ label: '进度查询' }],
};

function NavbarComponent() {
  const { toggleSidebar } = useAppStore();
  const location = useLocation();

  const crumbs = breadcrumbMap[location.pathname] || [
    { label: '首页' },
  ];

  if (location.pathname.startsWith('/orders/')) {
    crumbs.length = 0;
    crumbs.push({ label: '订单看板', path: '/' });
    crumbs.push({ label: `订单 #${location.pathname.split('/').pop() || ''}` });
  }

  return (
    <header className="sticky top-0 z-20 bg-brand-cream/80 backdrop-blur-md border-b border-brand-dark/10">
      <div className="h-16 px-4 md:px-8 flex items-center gap-4">
        <button
          type="button"
          onClick={toggleSidebar}
          className="md:hidden p-2 -ml-2 rounded-lg hover:bg-brand-dark/5 active:scale-95 transition-all min-w-[40px] min-h-[40px] flex items-center justify-center"
          aria-label="打开菜单"
        >
          <Menu className="w-6 h-6 text-brand-dark" strokeWidth={2.2} />
        </button>

        <nav className="flex items-center gap-2 text-sm flex-1 min-w-0">
          {crumbs.map((crumb, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              {i > 0 && (
                <span className="text-brand-dark/30 flex-shrink-0">/</span>
              )}
              <span
                className={`truncate ${
                  i === crumbs.length - 1
                    ? 'text-brand-dark font-semibold'
                    : 'text-brand-dark/60 hover:text-brand-brown cursor-pointer'
                }`}
              >
                {crumb.label}
              </span>
            </div>
          ))}
        </nav>

        <div className="hidden sm:flex items-center gap-3 text-xs text-brand-dark/60">
          <span className="font-mono-num">
            {new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })}
          </span>
        </div>
      </div>
    </header>
  );
}

NavbarComponent.displayName = 'Navbar';
export const Navbar = memo(NavbarComponent);
