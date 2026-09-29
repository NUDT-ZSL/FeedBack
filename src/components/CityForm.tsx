import { useState, useEffect, useRef } from 'react';
import type { CityInfo } from '@/stats/cityDB';
import { CITIES } from '@/stats/cityDB';
import TravelData, { type City } from '@/stats/TravelData';
import SearchBox from '@/map/SearchBox';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';

interface CityFormProps {
  editingCity?: City | null;
  onSuccess?: () => void;
  onCancel?: () => void;
  className?: string;
}

export default function CityForm({ editingCity, onSuccess, onCancel, className }: CityFormProps) {
  const [selectedCity, setSelectedCity] = useState<CityInfo | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [continent, setContinent] = useState<City['continent']>('Asia');
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [story, setStory] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>(0);

  const isEditMode = !!editingCity;
  const travelData = TravelData.getInstance();

  useEffect(() => {
    if (editingCity) {
      setSelectedCity(null);
      setName(editingCity.name);
      setCountry(editingCity.country);
      setContinent(editingCity.continent);
      setLat(editingCity.lat);
      setLng(editingCity.lng);
      setYear(editingCity.year);
      setStory(editingCity.story);
      setIsExpanded(true);
    } else {
      setSelectedCity(null);
      setName('');
      setCountry('');
      setContinent('Asia');
      setLat(0);
      setLng(0);
      setYear(new Date().getFullYear());
      setStory('');
      setIsExpanded(false);
    }
  }, [editingCity]);

  useEffect(() => {
    if (contentRef.current) {
      if (isExpanded) {
        setHeight(contentRef.current.scrollHeight);
      } else {
        setHeight(0);
      }
    }
  }, [isExpanded, story, year, name, country]);

  const handleSelectCity = (city: CityInfo) => {
    setSelectedCity(city);
    setName(city.name);
    setCountry(city.country);
    setContinent(city.continent);
    setLat(city.lat);
    setLng(city.lng);
    if (!isExpanded) {
      setIsExpanded(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !country.trim() || !year) return;

    if (isEditMode && editingCity) {
      travelData.updateCity(editingCity.id, {
        name,
        country,
        continent,
        lat,
        lng,
        year,
        story,
      });
    } else {
      travelData.addCity({
        name,
        country,
        continent,
        lat,
        lng,
        year,
        story,
        isRead: false,
      });
    }

    if (!isEditMode) {
      setSelectedCity(null);
      setName('');
      setCountry('');
      setContinent('Asia');
      setLat(0);
      setLng(0);
      setYear(new Date().getFullYear());
      setStory('');
      setIsExpanded(false);
    }

    onSuccess?.();
  };

  const handleCancel = () => {
    if (!isEditMode) {
      setSelectedCity(null);
      setName('');
      setCountry('');
      setContinent('Asia');
      setLat(0);
      setLng(0);
      setYear(new Date().getFullYear());
      setStory('');
      setIsExpanded(false);
    }
    onCancel?.();
  };

  return (
    <div className={cn('card', className)}>
      <h3 className="text-lg font-semibold text-[#2c3e50] mb-4">
        {isEditMode ? '编辑城市' : '添加城市'}
      </h3>

      {!isEditMode && (
        <SearchBox
          cities={CITIES}
          onSelect={handleSelectCity}
          className="mb-4"
        />
      )}

      <div
        style={{
          height: height === 'auto' ? 'auto' : `${height}px`,
          overflow: 'hidden',
          transition: 'height 0.3s ease-out',
        }}
      >
        <div ref={contentRef}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#2c3e50] mb-1">
                城市名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入城市名称"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#2c3e50] mb-1">
                国家
              </label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="输入国家"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#2c3e50] mb-1">
                到达年份
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value) || 0)}
                min="1900"
                max="2100"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#2c3e50] mb-1">
                旅行故事
              </label>
              <div className="relative">
                <textarea
                  value={story}
                  onChange={(e) => {
                    if (e.target.value.length <= 150) {
                      setStory(e.target.value);
                    }
                  }}
                  placeholder="记录你的旅行回忆..."
                  maxLength={150}
                  rows={4}
                  className="input-field resize-none"
                />
                <div
                  className={cn(
                    'absolute bottom-2 right-3 text-xs',
                    story.length >= 150 ? 'text-[#e74c3c]' : 'text-[#7f8c8d]'
                  )}
                >
                  {story.length}/150
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="btn btn-primary flex-1 gap-2"
                disabled={!name.trim() || !country.trim() || !year}
              >
                <Check className="w-4 h-4" />
                {isEditMode ? '保存修改' : '添加城市'}
              </button>
              {(isEditMode || isExpanded) && onCancel && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="btn btn-secondary flex-1 gap-2"
                >
                  <X className="w-4 h-4" />
                  取消
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
