import { useMemo } from 'react';
import Home from './pages/Home.tsx';
import scrolls from './data/scrolls.ts';
import { CollectionEngine } from './collection/engine.ts';

export default function App() {
  // 收藏状态唯一事实来源：整个应用共享同一个引擎实例
  const engine = useMemo(() => new CollectionEngine({ catalog: scrolls }), []);
  return <Home engine={engine} />;
}
