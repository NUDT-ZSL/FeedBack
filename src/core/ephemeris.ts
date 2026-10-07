import type { BodySpec } from "./types.js";

const DEG = Math.PI / 180;

/**
 * 本地固定样例星历：六颗行星的轨道参数全部内置于仓库，
 * 不访问网络、不依赖任何外部星历服务，保证离线可复现。
 *
 * 参数刻意覆盖多种情形：
 * - 各星轨道倾角不同，推演中会周期性落入地平线以下；
 * - 月亮轨道最小、角速度最快，会频繁与其他星体发生互掩；
 * - 偏心率非零，距离与角半径随时间变化。
 */
export const SAMPLE_BODIES: readonly BodySpec[] = [
  {
    id: "mercury",
    name: "水星",
    semiMajorAxis: 6.2,
    eccentricity: 0.2,
    inclination: 8 * DEG,
    longitudeOfAscendingNode: 10 * DEG,
    meanMotion: 0.9,
    phase0: 0.3,
    radius: 0.3,
  },
  {
    id: "venus",
    name: "金星",
    semiMajorAxis: 7.0,
    eccentricity: 0.05,
    inclination: 15 * DEG,
    longitudeOfAscendingNode: 40 * DEG,
    meanMotion: 0.6,
    phase0: 1.1,
    radius: 0.45,
  },
  {
    id: "mars",
    name: "火星",
    semiMajorAxis: 8.0,
    eccentricity: 0.15,
    inclination: 20 * DEG,
    longitudeOfAscendingNode: 80 * DEG,
    meanMotion: 0.4,
    phase0: 2.4,
    radius: 0.4,
  },
  {
    id: "jupiter",
    name: "木星",
    semiMajorAxis: 9.0,
    eccentricity: 0.1,
    inclination: 5 * DEG,
    longitudeOfAscendingNode: 120 * DEG,
    meanMotion: 0.2,
    phase0: 3.6,
    radius: 0.6,
  },
  {
    id: "saturn",
    name: "土星",
    semiMajorAxis: 10.0,
    eccentricity: 0.08,
    inclination: 25 * DEG,
    longitudeOfAscendingNode: 160 * DEG,
    meanMotion: 0.12,
    phase0: 4.8,
    radius: 0.55,
  },
  {
    id: "moon",
    name: "月亮",
    semiMajorAxis: 5.6,
    eccentricity: 0.1,
    inclination: 35 * DEG,
    longitudeOfAscendingNode: 0,
    meanMotion: 1.6,
    phase0: 5.5,
    radius: 0.35,
  },
];
