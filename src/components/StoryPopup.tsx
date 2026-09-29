import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { City } from '@/stats/TravelData';
import TravelData from '@/stats/TravelData';
import { Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StoryPopupProps {
  city: City;
  onClose: () => void;
  onEdit: (city: City) => void;
}

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export default function StoryPopup({ city, onClose, onEdit }: StoryPopupProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const travelData = TravelData.getInstance();

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setVisible(true), 10);
    return () => {
      clearTimeout(timer);
      setMounted(false);
    };
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleDelete = () => {
    if (confirm(`确定要删除 "${city.name}" 的旅行记录吗？`)) {
      travelData.deleteCity(city.id);
      onClose();
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!mounted) return null;

  const firstLetter = city.name.charAt(0).toUpperCase();
  const gradient = getGradient(city.name);

  const content = (
    <div
      className={cn(
        'fixed inset-0 z-[2000] flex items-center justify-center',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      style={{ transition: 'opacity 0.3s ease-out' }}
      onClick={handleOverlayClick}
    >
      <div
        className="absolute inset-0 bg-[rgba(0,0,0,0.5)]"
        onClick={handleOverlayClick}
      />

      <div
        className={cn(
          'relative w-[90%] max-w-[420px] bg-white',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        )}
        style={{
          borderRadius: '12px',
          border: '1px solid #ddd',
          transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-gray-100 transition-colors z-10"
        >
          <X className="w-5 h-5 text-[#7f8c8d]" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-4 mb-5">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0"
              style={{ background: gradient }}
            >
              {firstLetter}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-[#2c3e50] truncate">
                {city.name}
              </h2>
              <p className="text-sm text-[#7f8c8d] truncate">
                {city.country} · {city.continent}
              </p>
            </div>
          </div>

          <div className="mb-4 p-3 bg-[#f8f9fa] rounded-lg">
            <div className="text-xs text-[#7f8c8d] mb-1">到达年份</div>
            <div className="text-lg font-semibold text-[#2c3e50]">{city.year}</div>
          </div>

          <div className="mb-6">
            <div className="text-xs text-[#7f8c8d] mb-2">旅行故事</div>
            <div className="text-[#2c3e50] text-sm leading-relaxed whitespace-pre-wrap min-h-[60px]">
              {city.story || <span className="text-[#7f8c8d] italic">暂无旅行故事记录</span>}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => onEdit(city)}
              className="btn btn-primary flex-1 gap-2"
            >
              <Pencil className="w-4 h-4" />
              编辑故事
            </button>
            <button
              onClick={handleDelete}
              className="btn btn-danger flex-1 gap-2"
            >
              <Trash2 className="w-4 h-4" />
              删除标记
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
