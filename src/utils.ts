export type EasingFunction = (t: number) => number;

export const easeOutQuad: EasingFunction = (t: number): number => t * (2 - t);

export const easeOutElastic: EasingFunction = (t: number): number => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
    ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const easeOutCubic: EasingFunction = (t: number): number =>
  1 - Math.pow(1 - t, 3);

export function blendColors(
  hex1: string,
  hex2: string,
  ratio: number
): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function perlinNoise2(x: number, y: number, seed: number = 0): number {
  const p = new Uint8Array(512);
  const permutation = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    permutation[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const random = Math.sin(seed + i) * 10000;
    const j = Math.floor((random - Math.floor(random)) * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  for (let i = 0; i < 512; i++) {
    p[i] = permutation[i & 255];
  }
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x);
  const v = fade(y);
  const A = p[X] + Y;
  const AA = p[A];
  const AB = p[A + 1];
  const B = p[X + 1] + Y;
  const BA = p[B];
  const BB = p[B + 1];
  return lerp(
    lerp(grad(p[AA], x, y), grad(p[BA], x - 1, y), u),
    lerp(grad(p[AB], x, y - 1), grad(p[BB], x - 1, y - 1), u),
    v
  );
}

export type Direction = "乾" | "坤" | "震" | "巽" | "坎" | "离" | "艮" | "兑";

export type Mountain =
  | "壬"
  | "子"
  | "癸"
  | "丑"
  | "艮"
  | "寅"
  | "甲"
  | "卯"
  | "乙"
  | "辰"
  | "巽"
  | "巳"
  | "丙"
  | "午"
  | "丁"
  | "未"
  | "坤"
  | "申"
  | "庚"
  | "酉"
  | "辛"
  | "戌"
  | "乾"
  | "亥";

export interface MountainResult {
  mountain: Mountain;
  direction: Direction;
}

const MOUNTAINS: Mountain[] = [
  "壬",
  "子",
  "癸",
  "丑",
  "艮",
  "寅",
  "甲",
  "卯",
  "乙",
  "辰",
  "巽",
  "巳",
  "丙",
  "午",
  "丁",
  "未",
  "坤",
  "申",
  "庚",
  "酉",
  "辛",
  "戌",
  "乾",
  "亥",
];

const DIRECTIONS: Direction[] = [
  "坎",
  "坎",
  "坎",
  "艮",
  "艮",
  "艮",
  "震",
  "震",
  "震",
  "巽",
  "巽",
  "巽",
  "离",
  "离",
  "离",
  "坤",
  "坤",
  "坤",
  "兑",
  "兑",
  "兑",
  "乾",
  "乾",
  "乾",
];

export function angleTo24Mountain(angle: number): MountainResult {
  const normalized = ((angle % 360) + 360) % 360;
  const index = Math.floor((normalized + 7.5) / 15) % 24;
  return {
    mountain: MOUNTAINS[index],
    direction: DIRECTIONS[index],
  };
}

interface Position3D {
  x: number;
  y: number;
  z: number;
}

export function generateFengshuiCommentary(
  position: Position3D,
  height: number,
  dragonAngle: number
): string {
  const waterComments = [
    "水口方位",
    "来水去处",
    "水局格局",
    "明堂水势",
  ];
  const mountainComments = [
    "龙脉走势",
    "靠山方位",
    "案山朝向",
    "玄武垂头",
  ];
  const auspiciousComments = [
    "宜放置招财符",
    "宜设文昌塔",
    "宜挂八卦镜",
    "宜植松柏",
    "宜开南门",
    "宜立泰山石",
    "宜修蓄水池",
    "宜安财神位",
  ];
  const directions = [
    "北",
    "北偏东15度",
    "北偏东30度",
    "东北偏北15度",
    "东北",
    "东北偏东15度",
    "东偏北30度",
    "东偏北15度",
    "东",
    "东偏南15度",
    "东偏南30度",
    "东南偏东15度",
    "东南",
    "东南偏南15度",
    "南偏东30度",
    "南偏东15度",
    "南",
    "南偏西15度",
    "南偏西30度",
    "西南偏南15度",
    "西南",
    "西南偏西15度",
    "西偏南30度",
    "西偏南15度",
    "西",
    "西偏北15度",
    "西偏北30度",
    "西北偏西15度",
    "西北",
    "西北偏北15度",
    "北偏西30度",
    "北偏西15度",
  ];
  const { mountain } = angleTo24Mountain(dragonAngle);
  const random = Math.abs(
    Math.sin(position.x * 12.9898 + position.z * 78.233 + height * 43.758) *
      43758.5453
  );
  const r = random - Math.floor(random);
  const templateIdx = Math.floor(r * waterComments.length);
  const dirIdx = Math.floor(((r * 1000) % 1) * directions.length);
  const auspIdx = Math.floor(((r * 100000) % 1) * auspiciousComments.length);
  if (height > 100) {
    return `此地${mountainComments[templateIdx]}：${mountain}·${directions[dirIdx]}，${auspiciousComments[auspIdx]}`;
  }
  return `此地${waterComments[templateIdx]}：${mountain}·${directions[dirIdx]}，${auspiciousComments[auspIdx]}`;
}

interface Camera {
  position: Position3D;
  rotation: {
    yaw: number;
    pitch: number;
  };
  fov: number;
}

export function worldToScreen(
  position: Position3D,
  camera: Camera,
  width: number,
  height: number
): { x: number; y: number; depth: number } {
  const { position: camPos, rotation } = camera;
  const dx = position.x - camPos.x;
  const dy = position.y - camPos.y;
  const dz = position.z - camPos.z;
  const cosYaw = Math.cos(-rotation.yaw);
  const sinYaw = Math.sin(-rotation.yaw);
  const cosPitch = Math.cos(-rotation.pitch);
  const sinPitch = Math.sin(-rotation.pitch);
  const x1 = dx * cosYaw - dz * sinYaw;
  const z1 = dx * sinYaw + dz * cosYaw;
  const y2 = dy * cosPitch - z1 * sinPitch;
  const z2 = dy * sinPitch + z1 * cosPitch;
  const f = 1 / Math.tan(camera.fov / 2);
  const aspect = width / height;
  const screenX = (f * x1) / (aspect * z2 + 0.0001);
  const screenY = (f * y2) / (z2 + 0.0001);
  return {
    x: (screenX + 1) * width * 0.5,
    y: (1 - screenY) * height * 0.5,
    depth: z2,
  };
}
