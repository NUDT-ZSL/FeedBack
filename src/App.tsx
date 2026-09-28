import { useState, useMemo } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { Search } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useDebounce } from '@/hooks/useDebounce';
import { CITIES } from '@/stats/cityDB';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 200);

  const filteredCities = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const query = debouncedQuery.toLowerCase();
    return CITIES.filter(
      (city) =>
        city.name.toLowerCase().includes(query) ||
        city.country.toLowerCase().includes(query)
    ).slice(0, 10);
  }, [debouncedQuery]);

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-slate-50 dark:bg-slate-900 overflow-hidden">
      <div className="w-full md:w-[70%] h-1/2 md:h-full relative">
        <MapContainer
          center={[20, 0]}
          zoom={2}
          className="w-full h-full z-0"
          minZoom={2}
          maxZoom={18}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </MapContainer>
      </div>

      <div className="w-full md:w-[30%] h-1/2 md:h-full flex flex-col bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h1 className="text-xl font-bold text-slate-800 dark:text-white mb-4">
            我的旅行地图
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索城市或国家..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>
          {searchQuery && filteredCities.length > 0 && (
            <div className="mt-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filteredCities.map((city) => (
                <div
                  key={city.name}
                  className="px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-600 cursor-pointer text-slate-800 dark:text-white text-sm border-b border-slate-100 dark:border-slate-600 last:border-0"
                >
                  <span className="font-medium">{city.name}</span>
                  <span className="text-slate-500 dark:text-slate-400 ml-2">
                    {city.country}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-slate-500 dark:text-slate-400 text-sm text-center mt-8">
            右侧面板内容区域
          </p>
        </div>
      </div>
    </div>
  );
}
