import { SimConfig, StreamEvent } from "@/engine";

/** 生成带突发流量、乱序和缺来源的示例事件流。 */
export function generateSample(seed = 1): {
  events: StreamEvent[];
  config: SimConfig;
} {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const sources = ["web", "iot", "mobile"];
  const events: StreamEvent[] = [];
  let id = 0;
  for (let t = 0; t < 12; t += 0.5 + rand() * 0.3) {
    // t∈[4,7) 突发三倍流量
    const burst = t >= 4 && t < 7 ? 3 : 1;
    for (let k = 0; k < burst; k++) {
      events.push({
        id: `evt-${id++}`,
        sourceId: rand() < 0.05 ? undefined : sources[Math.floor(rand() * sources.length)],
        arrivalTime: Math.round((t + (rand() < 0.2 ? -0.3 : 0)) * 100) / 100,
      });
    }
  }
  const config: SimConfig = {
    baseConsumeRate: 2,
    baseCapacity: 6,
    tiers: [
      {
        id: "t1-half", label: "50%降采样", threshold: 4, consumeRate: 3,
        action: { type: "downsample", keepRatio: 0.5 },
      },
      {
        id: "t2-buffer", label: "扩容到12", threshold: 7, consumeRate: 5,
        action: { type: "expandBuffer", capacity: 12 },
      },
      {
        id: "t3-pause", label: "暂停iot", threshold: 10, releaseBelow: 4, consumeRate: 6,
        action: { type: "pauseSource", sources: ["iot"] },
      },
      {
        id: "t4-drop", label: "全量丢弃", threshold: 14, releaseBelow: 6, consumeRate: 8,
        action: { type: "drop" },
      },
    ],
  };
  return { events, config };
}
