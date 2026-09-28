import { Popup } from 'react-leaflet';
import type { Popup as LeafletPopup } from 'leaflet';
import { CityInfo } from '@/stats/cityDB';
import { MarkerData } from './MarkerManager';

interface StoryPopupProps {
  city: CityInfo;
  markerData?: MarkerData;
  onClose?: () => void;
  onMarkAsRead?: (id: string) => void;
}

export default function StoryPopup({ city, markerData, onClose, onMarkAsRead }: StoryPopupProps) {
  const eventHandlers = onClose
    ? {
        remove: () => onClose(),
        popupclose: () => onClose(),
      }
    : undefined;

  return (
    <Popup
      closeButton={true}
      eventHandlers={eventHandlers as unknown as Record<string, (e: { target: LeafletPopup }) => void>}
      className="story-popup"
    >
      <div className="min-w-[200px] p-2">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">{city.name}</h3>
        <p className="text-sm text-gray-500 mb-2">{city.country} · {city.continent}</p>
        <div className="text-xs text-gray-400 mb-3">
          纬度: {city.lat.toFixed(4)}<br />
          经度: {city.lng.toFixed(4)}
        </div>
        {markerData && onMarkAsRead && markerData.status !== 'read' && (
          <button
            onClick={() => onMarkAsRead(markerData.id)}
            className="w-full px-3 py-1.5 bg-[#3498db] text-white text-sm rounded-md hover:bg-[#2980b9] transition-colors"
          >
            标记为已读
          </button>
        )}
        {markerData?.status === 'read' && (
          <div className="text-sm text-[#2ecc71] font-medium text-center">
            ✓ 已读
          </div>
        )}
      </div>
    </Popup>
  );
}
