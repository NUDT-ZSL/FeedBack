import { useEffect, useState, useMemo } from 'react';
import { MapPin, Globe, Calendar } from 'lucide-react';
import TravelData, { type City, type Stats } from './TravelData';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { cn } from '@/lib/utils';

function CircularProgress({ value, max }: { value: number; max: number }) {
  const animatedValue = useAnimatedNumber(value, 800);
  const percentage = max > 0 ? Math.min((animatedValue / max) * 100, 100) : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const gradientId = useMemo(() => `country-progress-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div className="relative w-32 h-32 flex items-center justify-center">
      <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 120 120">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3498db" />
            <stop offset="50%" stopColor="#9b59b6" />
            <stop offset="100%" stopColor="#e74c3c" />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="#f3f4f6"
          strokeWidth="8"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.1s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-gray-800">{Math.round(animatedValue)}</span>
        <span className="text-xs text-gray-400">国家</span>
      </div>
    </div>
  );
}

interface CityYearGroup {
  year: number;
  cities: City[];
}

export default function StatsPanel() {
  const [cities, setCities] = useState<City[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    countries: 0,
    byYear: {},
    byContinent: {
      Asia: 0,
      Europe: 0,
      'North America': 0,
      'South America': 0,
      Africa: 0,
      Oceania: 0,
    },
  });

  useEffect(() => {
    const travelData = TravelData.getInstance();
    setCities(travelData.getCities());
    setStats(travelData.getStats());

    const unsubscribe = travelData.subscribe(() => {
      setCities(travelData.getCities());
      setStats(travelData.getStats());
    });

    return unsubscribe;
  }, []);

  const animatedTotal = useAnimatedNumber(stats.total, 500);

  const sortedCityGroups = useMemo<CityYearGroup[]>(() => {
    const grouped: Record<number, City[]> = {};
    for (const city of cities) {
      if (!grouped[city.year]) {
        grouped[city.year] = [];
      }
      grouped[city.year].push(city);
    }
    return Object.entries(grouped)
      .map(([year, cityList]) => ({
        year: Number(year),
        cities: cityList.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.year - a.year);
  }, [cities]);

  const maxCountries = 195;

  return (
    <div className="w-full h-full flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-2 mb-3 text-gray-500">
            <MapPin className="w-4 h-4" />
            <span className="text-sm font-medium">总旅行次数</span>
          </div>
          <span
            className="font-bold text-gray-800 leading-none"
            style={{ fontSize: '48px', fontWeight: 700 }}
          >
            {Math.round(animatedTotal)}
          </span>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-2 mb-3 text-gray-500">
            <Globe className="w-4 h-4" />
            <span className="text-sm font-medium">到访国家</span>
          </div>
          <CircularProgress value={stats.countries} max={maxCountries} />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2 mb-4 text-gray-700">
          <Calendar className="w-4 h-4" />
          <span className="text-sm font-semibold">城市列表</span>
          <span className="text-xs text-gray-400">共 {cities.length} 个城市</span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
          {sortedCityGroups.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              暂无旅行记录
            </div>
          ) : (
            sortedCityGroups.map((group) => (
              <div key={group.year} className="mb-3">
                <div className="flex items-center gap-2 mb-2 px-2">
                  <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#3498db] to-[#2ecc71]">
                    {group.year}
                  </span>
                  <span className="text-xs text-gray-400">{group.cities.length} 个城市</span>
                </div>
                <div className="space-y-0.5">
                  {group.cities.map((city) => (
                    <div
                      key={city.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg',
                        'cursor-pointer transition-colors duration-200',
                        'hover:bg-gray-50'
                      )}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-[#3498db]" />
                      <span className="text-sm text-gray-700 font-medium">{city.name}</span>
                      <span className="text-xs text-gray-400">{city.country}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
