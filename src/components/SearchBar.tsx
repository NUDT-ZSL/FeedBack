import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  const [input, setInput] = useState(value);

  // 防抖：输入停止 250ms 后再触发过滤
  useEffect(() => {
    const timer = window.setTimeout(() => onChange(input), 250);
    return () => window.clearTimeout(timer);
  }, [input, onChange]);

  return (
    <div className="search-bar">
      <Search size={18} className="search-icon" />
      <input
        type="text"
        placeholder="搜索菜名或食材，如：红烧肉、鸡蛋…"
        value={input}
        onChange={e => setInput(e.target.value)}
      />
      {input && (
        <button className="search-clear" onClick={() => setInput('')} aria-label="清空搜索">
          ×
        </button>
      )}
    </div>
  );
}
