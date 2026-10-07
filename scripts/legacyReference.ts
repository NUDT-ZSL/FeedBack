// Verbatim copy of the pre-refactor implementations from src/utils.ts.
// Used only by verify-parity.ts to prove the refactor changed no behavior.

type LegacyMountain =
  | "壬" | "子" | "癸" | "丑" | "艮" | "寅" | "甲" | "卯"
  | "乙" | "辰" | "巽" | "巳" | "丙" | "午" | "丁" | "未"
  | "坤" | "申" | "庚" | "酉" | "辛" | "戌" | "乾" | "亥";

type LegacyDirection = "乾" | "坤" | "震" | "巽" | "坎" | "离" | "艮" | "兑";

const MOUNTAINS: LegacyMountain[] = [
  "壬", "子", "癸", "丑", "艮", "寅", "甲", "卯",
  "乙", "辰", "巽", "巳", "丙", "午", "丁", "未",
  "坤", "申", "庚", "酉", "辛", "戌", "乾", "亥",
];

const DIRECTIONS: LegacyDirection[] = [
  "坎", "坎", "坎", "艮", "艮", "艮", "震", "震",
  "震", "巽", "巽", "巽", "离", "离", "离", "坤",
  "坤", "坤", "兑", "兑", "兑", "乾", "乾", "乾",
];

export function legacyAngleTo24Mountain(angle: number): {
  mountain: LegacyMountain;
  direction: LegacyDirection;
} {
  const normalized = ((angle % 360) + 360) % 360;
  const index = Math.floor((normalized + 7.5) / 15) % 24;
  return {
    mountain: MOUNTAINS[index],
    direction: DIRECTIONS[index],
  };
}

interface LegacyPosition3D {
  x: number;
  y: number;
  z: number;
}

export function legacyGenerateFengshuiCommentary(
  position: LegacyPosition3D,
  height: number,
  dragonAngle: number
): string {
  const waterComments = ["水口方位", "来水去处", "水局格局", "明堂水势"];
  const mountainComments = ["龙脉走势", "靠山方位", "案山朝向", "玄武垂头"];
  const auspiciousComments = [
    "宜放置招财符", "宜设文昌塔", "宜挂八卦镜", "宜植松柏",
    "宜开南门", "宜立泰山石", "宜修蓄水池", "宜安财神位",
  ];
  const directions = [
    "北", "北偏东15度", "北偏东30度", "东北偏北15度",
    "东北", "东北偏东15度", "东偏北30度", "东偏北15度",
    "东", "东偏南15度", "东偏南30度", "东南偏东15度",
    "东南", "东南偏南15度", "南偏东30度", "南偏东15度",
    "南", "南偏西15度", "南偏西30度", "西南偏南15度",
    "西南", "西南偏西15度", "西偏南30度", "西偏南15度",
    "西", "西偏北15度", "西偏北30度", "西北偏西15度",
    "西北", "西北偏北15度", "北偏西30度", "北偏西15度",
  ];
  const { mountain } = legacyAngleTo24Mountain(dragonAngle);
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
