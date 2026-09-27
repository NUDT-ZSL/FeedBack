import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchBar({ 
  onSearch, 
  placeholder = '搜索菜谱、食材、标签...',
  className 
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (onSearch) {
      onSearch(debouncedQuery);
    }
  }, [debouncedQuery, onSearch]);

  return (
    <div className={cn(
      'relative flex items-center w-full md:w-72 lg:w-96 transition-all duration-300',
      className
    )}>
      <div className={cn(
        'absolute inset-y-0 left-0 flex items-center pl-4',
        'transition-all duration-300 ease-out',
        isFocused ? 'text-forest-500 scale-110 rotate-6' : 'text-brown-400'
      )}>
        <Search className="w-5 h-5 transition-all duration-300" />
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className={cn(
          'w-full py-3 pl-12 pr-4 rounded-full',
          'bg-cream-100 text-brown-700 placeholder-brown-300',
          'border-2 border-transparent',
          'focus:outline-none focus:border-forest-500',
          'transition-all duration-300',
          'hover:bg-cream-200/50'
        )}
      />
    </div>
  );
}
