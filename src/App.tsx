import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import CastPage from '@/pages/CastPage';
import ArchivePage from '@/pages/ArchivePage';
import RecordDetailPage from '@/pages/RecordDetailPage';

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-[#f0e6d3] text-[#2a1a0a]">
        <header className="border-b-2 border-[#b8860b]/40 bg-[#e8dcc8]/80 shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <h1 className="font-serif text-2xl font-bold tracking-widest text-[#5d3a1a]">
              六爻占卜
            </h1>
            <nav className="flex gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `rounded-lg px-4 py-2 text-sm transition ${
                    isActive ? 'bg-[#5d3a1a] text-[#f0e6d3]' : 'text-[#5d3a1a] hover:bg-[#b8860b]/15'
                  }`
                }
              >
                起卦
              </NavLink>
              <NavLink
                to="/records"
                className={({ isActive }) =>
                  `rounded-lg px-4 py-2 text-sm transition ${
                    isActive ? 'bg-[#5d3a1a] text-[#f0e6d3]' : 'text-[#5d3a1a] hover:bg-[#b8860b]/15'
                  }`
                }
              >
                卦档
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">
          <Routes>
            <Route path="/" element={<CastPage />} />
            <Route path="/records" element={<ArchivePage />} />
            <Route path="/records/:id" element={<RecordDetailPage />} />
          </Routes>
        </main>

        <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-center text-xs text-stone-500">
          三枚铜钱摇六次，自下而上次第成爻；动则变，变则占。记录保存在本机浏览器，离线可用。
        </footer>
      </div>
    </HashRouter>
  );
}
