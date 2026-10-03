import { Moon, Sun } from 'lucide-react';
import ArtCanvas from '@/components/art/ArtCanvas';
import LayerControls from '@/components/art/LayerControls';
import LayerList from '@/components/art/LayerList';
import { useTheme } from '@/hooks/useTheme';

export default function Home() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="flex h-screen flex-col bg-gray-100 text-gray-900 dark:bg-[#12121f] dark:text-gray-100">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-white/10">
        <h1 className="text-sm font-semibold tracking-wide">抽象艺术生成器</h1>
        <button
          onClick={toggleTheme}
          title="切换主题"
          className="rounded-md p-2 transition hover:bg-gray-200 dark:hover:bg-white/10"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 space-y-5 overflow-y-auto border-r border-gray-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
          <LayerList />
          <LayerControls />
        </aside>
        <main className="min-w-0 flex-1">
          <ArtCanvas />
        </main>
      </div>
    </div>
  );
}
