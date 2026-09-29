import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { CityInfo } from '@/stats/cityDB';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchBoxProps {
  cities: CityInfo[];
  onSelect: (city: CityInfo) => void;
  className?: string;
}

export default function SearchBox({ cities, onSelect, className }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 200);

  const results = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const q = debouncedQuery.toLowerCase();
    return cities
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.country.toLowerCase().includes(q) ||
          c.continent.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [cities, debouncedQuery]);

  const handleSelect = (city: CityInfo) => {
    onSelect(city);
    setQuery(city.name);
    setIsOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div className={cn('relative z-[1000]', className)}>
      <div className="relative bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center px-3 py-2">
          <Search className="w-5 h-5 text-gray-400 mr-2" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="搜索城市、国家..."
            className="flex-1 outline-none text-sm text-gray-700 placeholder-gray-400 bg-transparent"
          />
          {query && (
            <button
              onClick={handleClear}
              className="ml-2 p-0.5 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
          <ul className="max-h-64 overflow-y-auto">
            {results.map((city) => (
              <li key={`${city.name}-${city.country}`}>
                <button
                  onClick={() => handleSelect(city)}
                  className="w-full px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
                >
                  <div className="text-sm font-medium text-gray-800">{city.name}</div>
                  <div className="text-xs text-gray-400">
                    {city.country} · {city.continent}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
