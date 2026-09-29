import L from 'leaflet';

export type MarkerStatus = 'unread' | 'read';

export interface MarkerData {
  id: string;
  lat: number;
  lng: number;
  status?: MarkerStatus;
  group?: string;
  data?: Record<string, unknown>;
}

export interface MarkerCallbacks {
  onMarkerClick?: (marker: MarkerData) => void;
  onMarkerAdd?: (marker: MarkerData) => void;
  onMarkerRemove?: (markerId: string) => void;
  onMarkersClear?: () => void;
}

const UNREAD_COLOR = '#3498db';
const READ_COLOR = '#2ecc71';
const MARKER_RADIUS = 12;

export class MarkerManager {
  private markers: Map<string, L.CircleMarker> = new Map();
  private markerData: Map<string, MarkerData> = new Map();
  private groups: Map<string, Set<string>> = new Map();
  private map: L.Map | null = null;
  private callbacks: MarkerCallbacks;

  constructor(callbacks: MarkerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  setMap(map: L.Map | null) {
    this.map = map;
  }

  private createIcon(status: MarkerStatus = 'unread'): L.CircleMarkerOptions {
    const color = status === 'read' ? READ_COLOR : UNREAD_COLOR;
    return {
      radius: MARKER_RADIUS,
      fillColor: color,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
      className: 'custom-marker',
    };
  }

  private getMarkerStyle(status: MarkerStatus = 'unread', hovered: boolean = false): L.CircleMarkerOptions {
    const base = this.createIcon(status);
    if (hovered) {
      return {
        ...base,
        radius: MARKER_RADIUS * 1.3,
        weight: 3,
      };
    }
    return base;
  }

  addMarker(data: MarkerData): L.CircleMarker | null {
    if (!this.map) return null;
    if (this.markers.has(data.id)) return this.markers.get(data.id)!;

    const status = data.status || 'unread';
    const marker = L.circleMarker([data.lat, data.lng], this.getMarkerStyle(status));

    marker.on('click', () => {
      this.callbacks.onMarkerClick?.(data);
    });

    marker.on('mouseover', () => {
      const currentData = this.markerData.get(data.id);
      if (currentData) {
        marker.setStyle(this.getMarkerStyle(currentData.status || 'unread', true));
        const el = marker.getElement() as HTMLElement | undefined;
        el?.style.setProperty('filter', 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))');
      }
    });

    marker.on('mouseout', () => {
      const currentData = this.markerData.get(data.id);
      if (currentData) {
        marker.setStyle(this.getMarkerStyle(currentData.status || 'unread', false));
        const el = marker.getElement() as HTMLElement | undefined;
        el?.style.removeProperty('filter');
      }
    });

    marker.addTo(this.map);
    this.markers.set(data.id, marker);
    this.markerData.set(data.id, data);

    if (data.group) {
      if (!this.groups.has(data.group)) {
        this.groups.set(data.group, new Set());
      }
      this.groups.get(data.group)!.add(data.id);
    }

    this.callbacks.onMarkerAdd?.(data);
    return marker;
  }

  removeMarker(markerId: string): boolean {
    const marker = this.markers.get(markerId);
    if (!marker || !this.map) return false;

    const data = this.markerData.get(markerId);
    if (data?.group) {
      this.groups.get(data.group)?.delete(markerId);
      if (this.groups.get(data.group)?.size === 0) {
        this.groups.delete(data.group);
      }
    }

    marker.remove();
    this.markers.delete(markerId);
    this.markerData.delete(markerId);
    this.callbacks.onMarkerRemove?.(markerId);
    return true;
  }

  clearMarkers(group?: string): void {
    if (group) {
      const groupMarkers = this.groups.get(group);
      if (groupMarkers) {
        groupMarkers.forEach((id) => this.removeMarker(id));
      }
    } else {
      this.markers.forEach((marker) => marker.remove());
      this.markers.clear();
      this.markerData.clear();
      this.groups.clear();
      this.callbacks.onMarkersClear?.();
    }
  }

  updateMarkerStyle(markerId: string, status: MarkerStatus): boolean {
    const marker = this.markers.get(markerId);
    const data = this.markerData.get(markerId);
    if (!marker || !data) return false;

    data.status = status;
    this.markerData.set(markerId, data);
    marker.setStyle(this.getMarkerStyle(status, false));
    return true;
  }

  getMarker(markerId: string): L.CircleMarker | null {
    return this.markers.get(markerId) || null;
  }

  getMarkerData(markerId: string): MarkerData | null {
    return this.markerData.get(markerId) || null;
  }

  getAllMarkers(): MarkerData[] {
    return Array.from(this.markerData.values());
  }

  getMarkersByGroup(group: string): MarkerData[] {
    const groupMarkers = this.groups.get(group);
    if (!groupMarkers) return [];
    return Array.from(groupMarkers)
      .map((id) => this.markerData.get(id))
      .filter((m): m is MarkerData => !!m);
  }

  getGroups(): string[] {
    return Array.from(this.groups.keys());
  }
}
