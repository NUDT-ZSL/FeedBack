import type { ReactNode } from "react";
import { BrowserRouter as Router, Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import ShipListPage from "@/pages/ShipListPage";
import ShipDetailPage from "@/pages/ShipDetailPage";
import VerifyPage from "@/pages/VerifyPage";

function Layout({ children }: { children: ReactNode }) {
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm transition ${
      isActive ? "bg-[#8b4513] text-[#f5e6c8]" : "text-[#6b3a2a] hover:bg-[#ffd70022]"
    }`;
  return (
    <div className="min-h-screen bg-[#f5f0e0] text-stone-800">
      <header className="border-b border-[#8b4513]/30 bg-[#f5e6c8]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="text-xl font-bold text-[#6b3a2a]">
            泉州市舶司 · 商船通关管理
          </Link>
          <nav className="ml-auto flex gap-1">
            <NavLink to="/" end className={navCls}>
              商船总览
            </NavLink>
            <NavLink to="/verify" className={navCls}>
              一致性核验
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<ShipListPage />} />
          <Route path="/ships/:shipId" element={<ShipDetailPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}
