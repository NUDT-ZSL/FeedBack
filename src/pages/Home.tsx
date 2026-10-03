import { Moon, Sun } from "lucide-react";
import CanvasView from "@/components/CanvasView";
import LayerList from "@/components/LayerList";
import ParamsPanel from "@/components/ParamsPanel";
import { useTheme } from "@/hooks/useTheme";

export default function Home() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="flex h-screen flex-col bg-neutral-100 text-neutral-900 dark:bg-[#12121f] dark:text-neutral-100">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 px-4 dark:border-white/10">
        <h1 className="text-sm font-semibold tracking-wide">抽象艺术生成器</h1>
        <button
          onClick={toggleTheme}
          title="切换主题"
          className="rounded-md p-2 text-neutral-500 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <LayerList />
        </aside>

        <main className="min-w-0 flex-1 p-3">
          <div className="h-full w-full overflow-hidden rounded-lg border border-neutral-200 shadow-sm dark:border-white/10">
            <CanvasView />
          </div>
        </main>

        <aside className="w-64 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <ParamsPanel />
        </aside>
      </div>
    </div>
  );
}
