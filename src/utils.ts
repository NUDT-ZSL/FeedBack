export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const formatTime = (hour: number): string => {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

export const hourToShichen = (hour: number): number => {
  const h = Math.floor(hour) % 24;
  if (h === 23 || h === 0) return 0;
  return Math.floor((h + 1) / 2) % 12;
};

export const shichenToHour = (shichen: number): number => {
  const hours = [23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];
  return hours[shichen % 12];
};

export const getStarColor = (): string => {
  const colors = ['#ffffff', '#f0f8ff', '#e6e6fa', '#fffaf0', '#aaccff', '#cceeff', '#ffeecc'];
  return colors[Math.floor(Math.random() * colors.length)];
};

export const getStarSize = (): number => 0.02 + Math.random() * 0.06;

export const sphericalToCartesian = (
  radius: number,
  ra: number,
  dec: number
): [number, number, number] => {
  const raRad = degToRad(ra);
  const decRad = degToRad(dec);
  const x = radius * Math.cos(decRad) * Math.cos(raRad);
  const y = radius * Math.sin(decRad);
  const z = radius * Math.cos(decRad) * Math.sin(raRad);
  return [x, y, z];
};

export const cartesianToSpherical = (
  x: number,
  y: number,
  z: number
): { radius: number; ra: number; dec: number } => {
  const radius = Math.sqrt(x * x + y * y + z * z);
  const dec = radToDeg(Math.asin(y / radius));
  let ra = radToDeg(Math.atan2(z, x));
  if (ra < 0) ra += 360;
  return { radius, ra, dec };
};

export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * t;
