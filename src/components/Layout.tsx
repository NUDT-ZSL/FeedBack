import { NavLink, Outlet } from 'react-router-dom';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-4 py-1.5 text-sm transition-colors ${
    isActive
      ? 'bg-[#8b4513] text-[#f5f0e0]'
      : 'text-[#8b4513] hover:bg-[#ffd70022]'
  }`;

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#f5f0e0] text-[#3d2b1f]">
      <header className="border-b-4 border-[#8b4513] bg-[#f5e6c8]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold tracking-widest text-[#6b3a2a]">
              泉州市舶司
            </h1>
            <p className="text-xs text-[#8b4513]">商船通关 · 抽解征税 · 抽检裁定</p>
          </div>
          <nav className="flex gap-2">
            <NavLink to="/" end className={linkCls}>
              在港商船
            </NavLink>
            <NavLink to="/verify" className={linkCls}>
              核验中心
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
