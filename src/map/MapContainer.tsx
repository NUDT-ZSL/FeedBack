import { useEffect, useRef, useState } from 'react';
import { MapContainer as LeafletMap, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { City } from '@/stats/TravelData';
import { MarkerManager, MarkerData } from './MarkerManager';
import SearchBox from './SearchBox';
import { cn } from '@/lib/utils';

interface MapContainerProps {
  cities: City[];
  onMarkerClick?: (city: City) => void;
  className?: string;
}

function MapEvents({ onMapReady }: { onMapReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    if (map) {
      onMapReady(map);
    }
  }, [map, onMapReady]);
  return null;
}

function FlyToHandler({ target }: { target: City | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], 6, {
        duration: 1.2,
      });
    }
  }, [target, map]);
  return null;
}

export default function MapContainer({ cities, onMarkerClick, className }: MapContainerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerManagerRef = useRef<MarkerManager | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);

  useEffect(() => {
    return () => {
      if (markerManagerRef.current) {
        markerManagerRef.current.clearMarkers();
        markerManagerRef.current.setMap(null);
      }
    };
  }, []);

  const handleMapReady = (map: L.Map) => {
    mapRef.current = map;

    if (!markerManagerRef.current) {
      markerManagerRef.current = new MarkerManager({
        onMarkerClick: (marker) => {
          const city = cities.find(
            (c) => c.lat === marker.lat && c.lng === marker.lng
          );
          if (city && onMarkerClick) {
            onMarkerClick(city);
          }
        },
      });
    }

    markerManagerRef.current.setMap(map);

    cities.forEach((city, index) => {
      const markerData: MarkerData = {
        id: `city-${city.name}-${index}`,
        lat: city.lat,
        lng: city.lng,
        status: city.isRead ? 'read' : 'unread',
        group: city.continent,
        data: { city },
      };
      markerManagerRef.current?.addMarker(markerData);
    });

    setTimeout(() => setIsLoaded(true), 100);
  };

  const handleCitySelect = (city: City) => {
    setSelectedCity(city);
    setTimeout(() => setSelectedCity(null), 2000);
  };

  return (
    <div className={cn('relative w-full h-full', className)}>
      <div
        className={cn(
          'absolute top-4 left-1/2 -translate-x-1/2 w-80 z-[1000] transition-all duration-500',
          isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        )}
      >
        <SearchBox cities={cities} onSelect={handleCitySelect} />
      </div>

      <LeafletMap
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        maxZoom={10}
        style={{
          height: '100%',
          width: '100%',
          backgroundColor: '#f0f2f5',
        }}
        worldCopyJump
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEvents onMapReady={handleMapReady} />
        <FlyToHandler target={selectedCity} />
      </LeafletMap>

      <div
        className={cn(
          'absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] transition-all duration-700 ease-out',
          isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        )}
      >
        <div className="bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow