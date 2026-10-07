import type { BodySpec } from "./types.js";
import type { Vec3 } from "./vec3.js";

/**
 * 计算星体在时刻 t 的三维位置（纯函数，与渲染无关）。
 *
 * 坐标约定：观测者位于浑天仪中心（原点），y 轴指向天顶，
 * xz 平面为地平面（y < 0 即落入地平线以下）。
 *
 * 步骤：
 * 1. 真近点角 ν = phase0 + meanMotion * t
 * 2. 椭圆极坐标 r = a(1-e^2)/(1+e·cosν)，
 *    轨道平面坐标 (r·cosν, 0, r·sinν)（倾角 0 时轨道贴地平面）
 * 3. 绕 x 轴抬升轨道倾角 i，再绕 y 轴（天顶轴）旋转升交点黄经 Ω
 *
 * 输出仅由 (body, t) 决定，不携带任何历史状态，因此
 * 时间轴回退后再前进到同一时刻必然得到完全一致的结果。
 */
export function positionAt(body: BodySpec, t: number): Vec3 {
  const nu = body.phase0 + body.meanMotion * t;
  const e = body.eccentricity;
  const r = (body.semiMajorAxis * (1 - e * e)) / (1 + e * Math.cos(nu));

  const px = r * Math.cos(nu);
  const pz = r * Math.sin(nu);

  const cosI = Math.cos(body.inclination);
  const sinI = Math.sin(body.inclination);
  const y1 = -pz * sinI;
  const z1 = pz * cosI;

  const cosO = Math.cos(body.longitudeOfAscendingNode);
  const sinO = Math.sin(body.longitudeOfAscendingNode);
  return {
    x: px * cosO + z1 * sinO,
    y: y1,
    z: z1 * cosO - px * sinO,
  };
}
