import { HerbData } from '../../types';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 从最近的可采集草药中确定性选择（距离相同时取下标最小者，与 GameManager 的遍历顺序一致） */
export function findCollectibleHerb(
  playerPos: Vec3Like,
  herbs: Array<{ data: HerbData }>,
  radius: number
): number {
  let foundIndex = -1;
  let nearestDistance = Infinity;
  for (let i = 0; i < herbs.length; i++) {
    const p = herbs[i].data.position;
    const dx = p.x - playerPos.x;
    const dy = p.y - playerPos.y;
    const dz = p.z - playerPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < radius && distance < nearestDistance) {
      nearestDistance = distance;
      foundIndex = i;
    }
  }
  return foundIndex;
}
