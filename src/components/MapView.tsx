import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import { SurveyPoint, getTagColor, getTagLabel, formatDate } from '../utils';

interface MapViewProps {
  points: SurveyPoint[];
  currentPosition: { lat: number; lng: number } | null;
  onAddMarkerClick: (lat: number, lng: number) => void;
  highlightPointId: string | null;
}

export interface MapViewRef {
  focusOnPoint: (point: SurveyPoint) => void;
  getMapInstance: () => L.Map | null;
}

const createCustomIcon = (color: string, isHighlighted: boolean = false): L.DivIcon => {
  return L.divIcon({
    className: `custom-marker ${isHighlighted ? 'highlighted-marker' : ''}`,
    html: `
      <div style="
        position: relative;
        width: 32px;
        height: 42px;
        transform: translate(-50%, -100%);
      ">
        <svg viewBox="0 0 32 42" width="32" height="42" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
          <path d="M16 0C7.16 0 0 7.16 0 16c0 10.4 13.2 24.5 14.2 25.6 0.4 0.4 1 0.6 1.6 0.6s1.2-0.2 1.6-0.6C18.8 40.5 32 26.4 32 16 32 7.16 24.84 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
          <circle cx="16" cy="15" r="6" fill="white"/>
          <circle cx="16" cy="15" r="3.5" fill="${color}"/>
        </svg>
      </div>
    `,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    popupAnchor: [0, -38]
  });
};

const createCurrentLocationIcon = (): L.DivIcon => {
  return L.divIcon({
    className: 'current-location-marker',
    html: `
      <div style="
        width: 24px;
        height: 24px;
        background: #3498db;
        border: 4px solid white;
        border-radius: 50%;
        box-shadow: 0 0 0 8px rgba(52, 152, 219, 0.2);
        animation: location-pulse 2s infinite;
      "></div>
      <style>
        @keyframes location-pulse {
          0%, 100% { box-shadow: 0 0 0 8px rgba(52, 152, 219, 0.2); }
          50% { box-shadow: 0 0 0 16px rgba(52, 152, 219, 0); }
        }
      </style>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

const MapView = forwardRef<MapViewRef, MapViewProps>(
  ({ points, currentPosition, onAddMarkerClick, highlightPointId }, ref) => {
    const mapRef = useRef<L.Map | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const markersLayerRef = useRef<L.MarkerClusterGroup | null>(null);
    const currentLocationMarkerRef = useRef<L.Marker | null>(null);
    const markersMapRef = useRef<Map<string, L.Marker>>(new Map());
    const mapInitializedRef = useRef(false);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const invalidateSizeTimerRef = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
      focusOnPoint: (point: SurveyPoint) => {
        if (!mapRef.current) return;

        const marker = markersMapRef.current.get(point.id);
        if (marker) {
          mapRef.current.setView([point.lat, point.lng], Math.max(mapRef.current.getZoom(), 15), {
            animate: true,
            duration: 0.8
          });

          const icon = marker.getIcon() as L.DivIcon;
          const color = getTagColor(point.tag);

          markersMapRef.current.forEach((m, id) => {
            const p = points.find((pt) => pt.id === id);
            if (p) {
              m.setIcon(createCustomIcon(getTagColor(p.tag), id === point.id));
            }
          });

          setTimeout(() => {
            marker.openPopup();
          }, 400);

          setTimeout(() => {
            markersMapRef.current.forEach((m, id) => {
              const p = points.find((pt) => pt.id === id);
              if (p) {
                m.setIcon(createCustomIcon(getTagColor(p.tag), false));
              }
            });
          }, 4000);
        }
      },
      getMapInstance: () => mapRef.current
    }));

    useEffect(() => {
      if (mapInitializedRef.current) return;
      mapInitializedRef.current = true;

      const initialLat = currentPosition?.lat ?? 39.9042;
      const initialLng = currentPosition?.lng ?? 116.4074;

      const container = document.getElementById('map');
      if (!container) return;

      const map = L.map(container, {
        center: [initialLat, initialLng],
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        worldCopyJump: true,
        fadeAnimation: true,
        zoomAnimation: true,
        markerZoomAnimation: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        updateWhenIdle: true,
        keepBuffer: 2
      }).addTo(map);

      const markersCluster = L.markerClusterGroup({
        maxClusterRadius: 80,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        animate: true,
        animateAddingMarkers: true,
        chunkedLoading: true
      });

      map.addLayer(markersCluster);
      markersLayerRef.current = markersCluster;
      mapRef.current = map;

      if (currentPosition) {
        const locationMarker = L.marker([currentPosition.lat, currentPosition.lng], {
          icon: createCurrentLocationIcon(),
          interactive: false
        }).addTo(map);
        currentLocationMarkerRef.current = locationMarker;
      }

      const handleResize = () => {
        if (invalidateSizeTimerRef.current) {
          window.clearTimeout(invalidateSizeTimerRef.current);
        }
        invalidateSizeTimerRef.current = window.setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.invalidateSize({ animate: false, pan: false });
          }
          invalidateSizeTimerRef.current = null;
        }, 100);
      };

      if (container && 'ResizeObserver' in window) {
        resizeObserverRef.current = new ResizeObserver(handleResize);
        resizeObserverRef.current.observe(container);
      } else {
        window.addEventListener('resize', handleResize);
      }

      map.whenReady(() => {
        handleResize();
      });

      return () => {
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
          resizeObserverRef.current = null;
        } else {
          window.removeEventListener('resize', handleResize);
        }
        if (invalidateSizeTimerRef.current) {
          window.clearTimeout(invalidateSizeTimerRef.current);
        }
        map.remove();
        mapRef.current = null;
        markersLayerRef.current = null;
        currentLocationMarkerRef.current = null;
        mapInitializedRef.current = false;
      };
    }, []);

    useEffect(() => {
      if (!mapRef.current || !currentPosition) return;

      if (!currentLocationMarkerRef.current) {
        const locationMarker = L.marker([currentPosition.lat, currentPosition.lng], {
          icon: createCurrentLocationIcon(),
          interactive: false
        }).addTo(mapRef.current);
        currentLocationMarkerRef.current = locationMarker;
      } else {
        currentLocationMarkerRef.current.setLatLng([currentPosition.lat, currentPosition.lng]);
      }
    }, [currentPosition]);

    useEffect(() => {
      if (!markersLayerRef.current || !mapRef.current) return;

      markersLayerRef.current.clearLayers();
      markersMapRef.current.clear();

      points.forEach((point) => {
        const color = getTagColor(point.tag);
        const isHighlighted = highlightPointId === point.id;
        const marker = L.marker([point.lat, point.lng], {
          icon: createCustomIcon(color, isHighlighted),
          riseOnHover: true,
          riseOffset: 500
        });

        const imageHtml = point.imageUrl
          ? `
            <img
              src="${point.imageUrl}"
              class="popup-image"
              alt="${point.name}"
              onclick="window.open('${point.imageUrl}', '_blank')"
              onerror="this.style.display='none'"
            />
          `
          : '';

        const descriptionHtml = point.description
          ? `<div class="popup-description">${escapeHtml(point.description)}</div>`
          : '';

        const popupContent = `
          <div class="popup-content">
            <div class="popup-name">
              <i class="fas fa-map-pin" style="color: ${color}; margin-right: 6px;"></i>
              ${escapeHtml(point.name)}
            </div>
            <span class="popup-tag" style="background: ${color}">
              ${getTagLabel(point.tag)}
            </span>
            <div class="popup-coords">
              <i class="fas fa-crosshairs" style="margin-right: 4px;"></i>
              ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
            </div>
            ${descriptionHtml}
            ${imageHtml}
            <div class="popup-time">
              <i class="far fa-clock" style="margin-right: 4px;"></i>
              ${formatDate(point.createdAt)}
            </div>
          </div>
        `;

        marker.bindPopup(popupContent, {
          maxWidth: 300,
          minWidth: 200,
          className: 'custom-popup',
          closeButton: true,
          autoPan: true,
          autoPanPadding: [20, 20]
        });

        markersLayerRef.current!.addLayer(marker);
        markersMapRef.current.set(point.id, marker);
      });
    }, [points, highlightPointId]);

    const handleAddMarker = () => {
      if (!mapRef.current) return;

      const center = mapRef.current.getCenter();
      const lat = Number(center.lat.toFixed(6));
      const lng = Number(center.lng.toFixed(6));
      onAddMarkerClick(lat, lng);
    };

    return (
      <div className="map-container">
        <div id="map"></div>
        <button
          className="add-marker-btn"
          onClick={handleAddMarker}
          title="在当前地图中心添加采样点"
        >
          <i className="fas fa-plus"></i>
        </button>
      </div>
    );
  }
);

const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

MapView.displayName = 'MapView';

export default MapView;
