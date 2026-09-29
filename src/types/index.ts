export interface Waypoint {
  name: string;
  lat: number;
  lng: number;
}

export interface ElevationPoint {
  distance: number;
  elevation: number;
}

export interface SpeedPoint {
  km: number;
  speed: number;
}

export interface RideRecord {
  id: string;
  date: string;
  name: string;
  distance: number;
  duration: string;
  avgHeartRate: number;
  elevationGain: number;
  waypoints: Waypoint[];
  elevationProfile: ElevationPoint[];
  speedProfile: SpeedPoint[];
}

export interface RouteSegment {
  rideId: string;
  segmentName: string;
  startKm: number;
  endKm: number;
}

export interface ConnectionNode {
  name: string;
  lat: number;
  lng: number;
}

export interface MergedRoute {
  id: string;
  name: string;
  segments: RouteSegment[];
  mergedElevation: ElevationPoint[];
  mergedSpeed: SpeedPoint[];
  connectionNodes: ConnectionNode[];
}

export interface Stats {
  totalDistance: number;
  avgSpeed: number;
  totalElevation: number;
  rideCount: number;
  distanceChangePercent: number;
  speedChangePercent: number;
  elevationChangePercent: number;
  countChangePercent: number;
}
