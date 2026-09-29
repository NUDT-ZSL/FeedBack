import type { RideRecord, RouteSegment, MergedRoute, Stats, ElevationPoint, SpeedPoint, Waypoint } from '../types';

function generateElevationProfile(distanceKm: number, baseAlt: number, maxClimb: number): ElevationPoint[] {
  const points: ElevationPoint[] = [];
  const step = Math.max(0.5, distanceKm / 20);
  for (let d = 0; d <= distanceKm; d += step) {
    const e = baseAlt + maxClimb * (
      0.4 * Math.sin(d * 0.3) +
      0.3 * Math.sin(d * 0.7 + 1) +
      0.2 * Math.sin(d * 1.3 + 2) +
      0.1 * Math.sin(d * 2.1 + 3)
    );
    points.push({ distance: Math.round(d * 10) / 10, elevation: Math.max(0, Math.round(e)) });
  }
  return points;
}

function generateSpeedProfile(distanceKm: number, avgSpeed: number): SpeedPoint[] {
  const points: SpeedPoint[] = [];
  let speed = avgSpeed;
  for (let km = 1; km <= Math.ceil(distanceKm); km++) {
    speed = avgSpeed + (Math.sin(km * 0.8) * 4 + Math.sin(km * 1.7) * 2);
    speed = Math.max(8, Math.min(45, speed));
    points.push({ km, speed: Math.round(speed * 10) / 10 });
  }
  return points;
}

function parseDurationHours(dur: string): number {
  const parts = dur.split(':').map(Number);
  return parts[0] + parts[1] / 60 + parts[2] / 3600;
}

const MOCK_RIDES: RideRecord[] = [
  {
    id: 'r01', date: '2026-06-15', name: '晨骑奥森北园', distance: 18.5, duration: '0:52:30', avgHeartRate: 138, elevationGain: 85,
    waypoints: [{ name: '奥森南门', lat: 40.0128, lng: 116.3839 }, { name: '北园湖心', lat: 40.0245, lng: 116.3790 }, { name: '北门折返', lat: 40.0356, lng: 116.3850 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r02', date: '2026-06-14', name: '百望山爬坡训练', distance: 12.3, duration: '0:58:10', avgHeartRate: 162, elevationGain: 480,
    waypoints: [{ name: '黑山扈路', lat: 40.0321, lng: 116.2910 }, { name: '百望山顶', lat: 40.0450, lng: 116.2780 }, { name: '下坡终点', lat: 40.0280, lng: 116.2850 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r03', date: '2026-06-12', name: '长安街夜骑', distance: 22.0, duration: '1:05:45', avgHeartRate: 132, elevationGain: 30,
    waypoints: [{ name: '国贸', lat: 39.9085, lng: 116.4585 }, { name: '天安门', lat: 39.9074, lng: 116.3972 }, { name: '复兴门', lat: 39.9074, lng: 116.3565 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r04', date: '2026-06-10', name: '戒台寺环线', distance: 45.6, duration: '2:15:30', avgHeartRate: 148, elevationGain: 720,
    waypoints: [{ name: '门头沟起点', lat: 39.9370, lng: 116.0980 }, { name: '戒台寺', lat: 39.9050, lng: 116.0750 }, { name: '潭柘寺', lat: 39.8830, lng: 116.0530 }, { name: '返程松树口', lat: 39.9100, lng: 116.0800 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r05', date: '2026-06-08', name: '妙峰山挑战', distance: 68.2, duration: '3:42:00', avgHeartRate: 158, elevationGain: 1380,
    waypoints: [{ name: '三家店', lat: 39.9250, lng: 116.1250 }, { name: '妙峰山牌楼', lat: 39.9600, lng: 116.0400 }, { name: '金顶', lat: 39.9800, lng: 116.0200 }, { name: '下坡驿站', lat: 39.9500, lng: 116.0600 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r06', date: '2026-06-06', name: '颐和园绕圈', distance: 15.8, duration: '0:45:20', avgHeartRate: 128, elevationGain: 45,
    waypoints: [{ name: '东宫门', lat: 39.9995, lng: 116.2755 }, { name: '苏州街', lat: 39.9960, lng: 116.2630 }, { name: '十七孔桥', lat: 39.9920, lng: 116.2740 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r07', date: '2026-06-04', name: '二环路通勤', distance: 32.5, duration: '1:28:00', avgHeartRate: 142, elevationGain: 120,
    waypoints: [{ name: '东直门', lat: 39.9430, lng: 116.4270 }, { name: '西直门', lat: 39.9430, lng: 116.3530 }, { name: '建国门', lat: 39.9080, lng: 116.4350 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r08', date: '2026-06-02', name: '十三陵水库', distance: 55.0, duration: '2:35:00', avgHeartRate: 150, elevationGain: 560,
    waypoints: [{ name: '昌平城区', lat: 40.2200, lng: 116.2350 }, { name: '十三陵水库', lat: 40.2500, lng: 116.2200 }, { name: '长陵', lat: 40.2580, lng: 116.2000 }, { name: '返程路口', lat: 40.2350, lng: 116.2150 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r09', date: '2026-05-30', name: '温榆河绿道', distance: 28.3, duration: '1:18:00', avgHeartRate: 135, elevationGain: 35,
    waypoints: [{ name: '顺义起点', lat: 40.1300, lng: 116.6500 }, { name: '温榆河桥', lat: 40.1050, lng: 116.5800 }, { name: '朝阳段终点', lat: 40.0800, lng: 116.5200 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r10', date: '2026-05-28', name: '香山爬坡', distance: 8.5, duration: '0:38:15', avgHeartRate: 170, elevationGain: 520,
    waypoints: [{ name: '香山路口', lat: 39.9930, lng: 116.1880 }, { name: '香炉峰', lat: 39.9970, lng: 116.1750 }, { name: '下山出口', lat: 39.9910, lng: 116.1920 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r11', date: '2026-05-25', name: '通州大运河', distance: 35.2, duration: '1:42:00', avgHeartRate: 140, elevationGain: 55,
    waypoints: [{ name: '运河广场', lat: 39.9020, lng: 116.6200 }, { name: '漕运码头', lat: 39.8850, lng: 116.6500 }, { name: '森林公园', lat: 39.8700, lng: 116.6200 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r12', date: '2026-05-22', name: '房山十渡', distance: 72.0, duration: '3:55:00', avgHeartRate: 155, elevationGain: 980,
    waypoints: [{ name: '阎村出发', lat: 39.7500, lng: 116.1200 }, { name: '张坊', lat: 39.7000, lng: 115.9800 }, { name: '十渡', lat: 39.6500, lng: 115.9200 }, { name: '返程点', lat: 39.6800, lng: 115.9600 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r13', date: '2026-05-18', name: '朝阳公园晨骑', distance: 9.8, duration: '0:32:40', avgHeartRate: 125, elevationGain: 20,
    waypoints: [{ name: '西门', lat: 39.9340, lng: 116.4680 }, { name: '南湖', lat: 39.9280, lng: 116.4750 }, { name: '东门', lat: 39.9320, lng: 116.4880 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r14', date: '2026-05-15', name: '怀柔雁栖湖', distance: 80.0, duration: '4:10:00', avgHeartRate: 152, elevationGain: 850,
    waypoints: [{ name: '怀柔城区', lat: 40.3100, lng: 116.6300 }, { name: '雁栖湖', lat: 40.3600, lng: 116.6700 }, { name: '红螺寺', lat: 40.3300, lng: 116.6100 }, { name: '返程', lat: 40.3150, lng: 116.6250 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r15', date: '2026-05-12', name: '圆明园休闲骑', distance: 6.5, duration: '0:25:10', avgHeartRate: 118, elevationGain: 15,
    waypoints: [{ name: '南门', lat: 40.0010, lng: 116.2980 }, { name: '西洋楼', lat: 40.0080, lng: 116.2900 }, { name: '福海', lat: 40.0050, lng: 116.2820 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r16', date: '2026-05-08', name: '昌平延庆穿越', distance: 58.5, duration: '2:50:00', avgHeartRate: 155, elevationGain: 780,
    waypoints: [{ name: '昌平南口', lat: 40.2100, lng: 116.1500 }, { name: '居庸关', lat: 40.2900, lng: 116.0800 }, { name: '八达岭', lat: 40.3500, lng: 116.0200 }, { name: '延庆城区', lat: 40.4600, lng: 115.9700 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r17', date: '2026-05-05', name: '大兴骑行', distance: 25.0, duration: '1:10:00', avgHeartRate: 130, elevationGain: 40,
    waypoints: [{ name: '黄村', lat: 39.7700, lng: 116.3400 }, { name: '南海子', lat: 39.7300, lng: 116.3900 }, { name: '亦庄', lat: 39.7900, lng: 116.5000 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r18', date: '2026-05-01', name: '密云水库环线', distance: 65.0, duration: '3:20:00', avgHeartRate: 149, elevationGain: 650,
    waypoints: [{ name: '密云城区', lat: 40.3800, lng: 116.8400 }, { name: '水库大坝', lat: 40.4200, lng: 116.9200 }, { name: '溪翁庄', lat: 40.4000, lng: 116.8700 }, { name: '返程', lat: 40.3850, lng: 116.8450 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r19', date: '2026-04-28', name: 'CBD通勤', distance: 14.2, duration: '0:42:00', avgHeartRate: 136, elevationGain: 60,
    waypoints: [{ name: '望京', lat: 39.9850, lng: 116.4800 }, { name: '国贸', lat: 39.9085, lng: 116.4585 }, { name: '大望路', lat: 39.9100, lng: 116.4700 }],
    elevationProfile: [], speedProfile: []
  },
  {
    id: 'r20', date: '2026-04-25', name: '顺义潮白河', distance: 40.0, duration: '1:55:00', avgHeartRate: 145, elevationGain: 95,
    waypoints: [{ name: '顺义城区', lat: 40.1400, lng: 116.6600 }, { name: '潮白河大桥', lat: 40.1100, lng: 116.7000 }, { name: '河东营地', lat: 40.0900, lng: 116.7200 }],
    elevationProfile: [], speedProfile: []
  },
];

MOCK_RIDES.forEach(ride => {
  const avgSpeed = ride.distance / parseDurationHours(ride.duration);
  ride.elevationProfile = generateElevationProfile(ride.distance, 50, ride.elevationGain);
  ride.speedProfile = generateSpeedProfile(ride.distance, avgSpeed);
});

let rides: RideRecord[] = [...MOCK_RIDES];

export function getAllRides(): RideRecord[] {
  return [...rides].sort((a, b) => b.date.localeCompare(a.date));
}

export function getRideById(id: string): RideRecord | undefined {
  return rides.find(r => r.id === id);
}

export function createRide(data: Omit<RideRecord, 'id' | 'elevationProfile' | 'speedProfile'>): RideRecord {
  const id = 'r' + String(Date.now()).slice(-6);
  const avgSpeed = data.distance / parseDurationHours(data.duration);
  const newRide: RideRecord = {
    ...data,
    id,
    elevationProfile: generateElevationProfile(data.distance, 50, data.elevationGain),
    speedProfile: generateSpeedProfile(data.distance, avgSpeed),
  };
  rides = [newRide, ...rides];
  return newRide;
}

export function deleteRide(id: string): void {
  rides = rides.filter(r => r.id !== id);
}

export function mergeRoutes(segments: RouteSegment[]): MergedRoute {
  const mergedElevation: ElevationPoint[] = [];
  const mergedSpeed: SpeedPoint[] = [];
  const connectionNodes: { name: string; lat: number; lng: number }[] = [];
  let totalDistance = 0;

  const sorted = [...segments].sort((a, b) => {
    const rideA = getRideById(a.rideId);
    const rideB = getRideById(b.rideId);
    return (rideA?.date || '').localeCompare(rideB?.date || '');
  });

  sorted.forEach((seg, idx) => {
    const ride = getRideById(seg.rideId);
    if (!ride) return;

    const elevSlice = ride.elevationProfile.filter(
      p => p.distance >= seg.startKm && p.distance <= seg.endKm
    );
    elevSlice.forEach(p => {
      mergedElevation.push({
        distance: Math.round((p.distance - seg.startKm + totalDistance) * 10) / 10,
        elevation: p.elevation,
      });
    });

    const speedSlice = ride.speedProfile.filter(
      p => p.km >= Math.ceil(seg.startKm) && p.km <= Math.floor(seg.endKm)
    );
    speedSlice.forEach(p => {
      mergedSpeed.push({
        km: Math.round((p.km - Math.ceil(seg.startKm) + totalDistance) * 10) / 10,
        speed: p.speed,
      });
    });

    if (idx > 0 && ride.waypoints.length > 0) {
      const wp = ride.waypoints[0];
      connectionNodes.push({
        name: `${ride.name}起点`,
        lat: wp.lat,
        lng: wp.lng,
      });
    }

    totalDistance += seg.endKm - seg.startKm;
  });

  return {
    id: 'm' + String(Date.now()).slice(-6),
    name: '拼接路线 ' + new Date().toLocaleDateString('zh-CN'),
    segments: sorted,
    mergedElevation,
    mergedSpeed,
    connectionNodes,
  };
}

export function getMonthlyStats(year: number, month: number): Stats {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const monthRides = rides.filter(r => r.date.startsWith(monthStr));

  const totalDistance = monthRides.reduce((s, r) => s + r.distance, 0);
  const totalElevation = monthRides.reduce((s, r) => s + r.elevationGain, 0);
  const rideCount = monthRides.length;
  const avgSpeed = rideCount > 0
    ? monthRides.reduce((s, r) => s + r.distance / parseDurationHours(r.duration), 0) / rideCount
    : 0;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStats = getMonthlyStatsRaw(prevYear, prevMonth);

  const pct = (curr: number, prev: number) => prev === 0 ? 0 : Math.round(((curr - prev) / prev) * 1000) / 10;

  return {
    totalDistance: Math.round(totalDistance * 10) / 10,
    avgSpeed: Math.round(avgSpeed * 10) / 10,
    totalElevation: Math.round(totalElevation),
    rideCount,
    distanceChangePercent: pct(totalDistance, prevStats.totalDistance),
    speedChangePercent: pct(avgSpeed, prevStats.avgSpeed),
    elevationChangePercent: pct(totalElevation, prevStats.totalElevation),
    countChangePercent: pct(rideCount, prevStats.rideCount),
  };
}

function getMonthlyStatsRaw(year: number, month: number): { totalDistance: number; avgSpeed: number; totalElevation: number; rideCount: number } {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const monthRides = rides.filter(r => r.date.startsWith(monthStr));
  const totalDistance = monthRides.reduce((s, r) => s + r.distance, 0);
  const totalElevation = monthRides.reduce((s, r) => s + r.elevationGain, 0);
  const rideCount = monthRides.length;
  const avgSpeed = rideCount > 0
    ? monthRides.reduce((s, r) => s + r.distance / parseDurationHours(r.duration), 0) / rideCount
    : 0;
  return { totalDistance, avgSpeed, totalElevation, rideCount };
}
