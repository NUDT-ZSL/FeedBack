import React, { useMemo, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { TripSpot, DAY_COLORS } from '../types';

interface MapViewProps {
  spots: TripSpot[];
  days: number;
  isPreviewMode: boolean;
}

const createCircleIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-circle-marker',
    html: `<div style="
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: ${color};
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
};

const MapView: React.FC<MapViewProps> = ({ spots, days, isPreviewMode }) => {
  const markers = useMemo(() => {
    return spots.map((spot) => ({
      id: spot.id,
      lat: spot.lat,
      lng: spot.lng,
      name: spot.name,
      description: spot.description,
      dayIndex: spot.dayIndex,
      color: DAY_COLORS[spot.dayIndex % DAY_COLORS.length],
    }));
  }, [spots]);

  const polylinesByDay = useMemo(() => {
    const lines: { color: string; positions: [number, number][] }[] = [];
    for (let d = 0; d < days; d++) {
      const daySpots = spots
        .filter((s) => s.dayIndex === d)
        .sort((a, b) => a.order - b.order);
      if (daySpots.length >= 2) {
        lines.push({
          color: DAY_COLORS[d % DAY_COLORS.length],
          positions: daySpots.map((s) => [s.lat, s.lng] as [number, number]),
        });
      }
    }
    return lines;
  }, [spots, days]);

  const crossDayLines = useMemo(() => {
    const lines: { positions: [number, number][] }[] = [];
    for (let d = 0; d < days - 1; d++) {
      const currentDaySpots = spots
        .filter((s) => s.dayIndex === d)
        .sort((a, b) => a.order - b.order);
      const nextDaySpots = spots
        .filter((s) => s.dayIndex === d + 1)
        .sort((a, b) => a.order - b.order);
      if (currentDaySpots.length > 0 && nextDaySpots.length > 0) {
        const last = currentDaySpots[currentDaySpots.length - 1];
        const first = nextDaySpots[0];
        lines.push({
          positions: [
            [last.lat, last.lng] as [number, number],
            [first.lat, first.lng] as [number, number],
          ],
        });
      }
    }
    return lines;
  }, [spots, days]);

  const bounds = useMemo(() => {
    if (markers.length === 0) return null;
    const lats = markers.map((m) => m.lat);
    const lngs = markers.map((m) => m.lng);
    const minLat = Math.min(...lats) - 2;
    const maxLat = Math.max(...lats) + 2;
    const minLng = Math.min(...lngs) - 2;
    const maxLng = Math.max(...lngs) + 2;
    return L.latLngBounds([minLat, minLng] as [number, number], [maxLat, maxLng] as [number, number]);
  }, [markers]);

  const center: [number, number] = useMemo(() => {
    if (bounds) {
      const c = bounds.getCenter();
      return [c.lat, c.lng];
    }
    return [35.8617, 104.1954];
  }, [bounds]);

  return (
    <div className={`map-wrapper ${isPreviewMode ? 'map-preview' : ''}`}>
      <style>{`
        .leaflet-popup-content-wrapper {
          border-radius: 10px;
          animation: popupIn 0.25s ease-out;
        }
        .leaflet-popup-content {
          margin: 12px 14px;
          min-width: 160px;
        }
        .popup-day-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 10px;
          color: white;
          font-size: 11px;
          font-weight: 600;
          margin-right: 6px;
        }
        .popup-title {
          font-size: 15px;
          font-weight: 600;
          margin: 6px 0 4px;
          color: #2C3E50;
        }
        .popup-desc {
          font-size: 12px;
          color: #7F8C8D;
          line-height: 1.4;
        }
        @keyframes popupIn {
          from {
            opacity: 0;
            transform: scale(0.85);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .cross-day-polyline {
          stroke-dasharray: 8 8;
          animation: dashmove 0.8s linear infinite;
        }
        @keyframes dashmove {
          to {
            stroke-dashoffset: -16;
          }
        }
        .custom-circle-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
      <MapContainer
        center={center}
        zoom={5}
        style={{ height: '100%', width: '100%', borderRadius: '12px' }}
        scrollWheelZoom={!isPreviewMode}
        dragging={!isPreviewMode}
        touchZoom={!isPreviewMode}
        doubleClickZoom={!isPreviewMode}
        boxZoom={!isPreviewMode}
        keyboard={!isPreviewMode}
        zoomControl={!isPreviewMode}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {bounds && markers.length > 0 && (
          <MapBoundsSetter bounds={bounds} />
        )}

        {polylinesByDay.map((line, idx) => (
          <Polyline
            key={`day-line-${idx}`}
            positions={line.positions}
            pathOptions={{
              color: line.color,
              weight: 3,
              opacity: 0.8,
              lineCap: 'round',
            }}
          />
        ))}

        {crossDayLines.map((line, idx) => (
          <Polyline
            key={`cross-line-${idx}`}
            positions={line.positions}
            className="cross-day-polyline"
            pathOptions={{
              color: '#4A90D9',
              weight: 3,
              opacity: 0.9,
              lineCap: 'round',
            }}
          />
        ))}

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={createCircleIcon(m.color)}
          >
            <Popup>
              <div>
                <span className="popup-day-badge" style={{ backgroundColor: m.color }}>
                  D{m.dayIndex + 1}
                </span>
                <div className="popup-title">{m.name}</div>
                <div className="popup-desc">{m.description}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

const MapBoundsSetter: React.FC<{ bounds: L.LatLngBounds }> = React.memo(
  ({ bounds }) => {
    const map = useMap();
    useEffect(() => {
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
      }
    }, [bounds, map]);
    return null;
  }
);

export default React.memo(MapView);
