import { useState } from "react";
import { useStore } from "@/store/useStore";
import BooksPage from "@/pages/BooksPage";
import SlotsPage from "@/pages/SlotsPage";
import SalesPage from "@/pages/SalesPage";
import ReportsPage from "@/pages/ReportsPage";
import DataPage from "@/pages/DataPage";

const TABS = [
  { key: "books", label: "书籍" },
  { key: "slots", label: "陈列位" },
  { key: "sales", label: "销售流水" },
  { key: "reports", label: "经营结论" },
  { key: "data", label: "数据" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Home() {
  const [tab, setTab] = useState<TabKey>("books");
  const { result } = useStore();
  const pendingCount = result.saleRows.filter((r) => !r.resolved).length;
  const anomalyCount = result.anomalies.length;

  return (
    <div className="min-h-screen bg-[#f5e6c8] text-[#3e2f23]">
      <header className="border-b-2 border-[#8d6e4a] bg-[#efe0bd]">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <h1 className="text-xl font-bold tracking-widest text-[#5d4037]">
            临安书坊 · 经营推演
          </h1>
          <p className="mt-0.5 text-xs text-[#8d6e4a]">
            录书 · 列架 · 记账 · 推演库存与盈亏，全部数据存于本地
          </p>
          <nav className="mt-3 flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative rounded-t border border-b-0 px-4 py-1.5 text-sm transition ${
                  tab === t.key
                    ? "border-[#8d6e4a] bg-[#f5e6c8] font-semibold text-[#5d4037]"
                    : "border-transparent text-[#8d6e4a] hover:text-[#5d4037]"
                }`}
              >
                {t.label}
                {t.key === "sales" && pendingCount > 0 && (
                  <span className="ml-1 rounded-full bg-[#d32f2f] px-1.5 text-xs text-white">
                    {pendingCount}
                  </span>
                )}
                {t.key === "reports" && anomalyCount > 0 && (
                  <span className="ml-1 rounded-full bg-[#d32f2f] px-1.5 text-xs text-white">
                    {anomalyCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">
        {tab === "books" && <BooksPage />}
        {tab === "slots" && <SlotsPage />}
        {tab === "sales" && <SalesPage />}
        {tab === "reports" && <ReportsPage />}
        {tab === "data" && <DataPage />}
      </main>
    </div>
  );
}
