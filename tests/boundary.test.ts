import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLunarEclipse,
  classifySolarEclipse,
  HYBRID_TOLERANCE,
  lunarUmbralMagnitude,
  solarMagnitude,
} from "../src/eclipse/index.ts";

describe("日食类型分界", () => {
  const sunR = 0.266;
  const moonR = 0.27;

  it("中心距恰好等于半径和时无食", () => {
    assert.equal(classifySolarEclipse(sunR, moonR, sunR + moonR), "none");
    assert.equal(
      classifySolarEclipse(sunR, moonR, sunR + moonR + 1e-12),
      "none",
    );
  });

  it("中心距略小于半径和时为偏食", () => {
    assert.equal(
      classifySolarEclipse(sunR, moonR, sunR + moonR - 1e-6),
      "solar-partial",
    );
  });

  it("中心距等于半径差时进入中心食", () => {
    const boundary = Math.abs(moonR - sunR);
    assert.equal(classifySolarEclipse(sunR, moonR, boundary - 1e-9), "solar-total");
    assert.equal(classifySolarEclipse(sunR, moonR, boundary + 1e-9), "solar-partial");
  });

  it("月径大于日径为全食，小于为环食", () => {
    assert.equal(classifySolarEclipse(0.266, 0.27, 0.001), "solar-total");
    assert.equal(classifySolarEclipse(0.27, 0.266, 0.001), "solar-annular");
  });

  it("全食与环食分界：半径差在混合容差内", () => {
    const nearlyEqual = 0.266 + HYBRID_TOLERANCE / 2;
    assert.equal(classifySolarEclipse(0.266, nearlyEqual, 0.0001), "solar-total");
    const justBeyond = 0.266 + HYBRID_TOLERANCE * 2;
    assert.equal(classifySolarEclipse(0.266, justBeyond, 0.0001), "solar-total");
    const annularSide = 0.266 - HYBRID_TOLERANCE * 2;
    assert.equal(classifySolarEclipse(0.266, annularSide, 0.0001), "solar-annular");
  });
});

describe("月食类型分界", () => {
  const umbral = 0.69;
  const penumbral = 1.22;
  const moonR = 0.25;

  it("中心距超出半影半径和时无食", () => {
    assert.equal(
      classifyLunarEclipse(umbral, penumbral, moonR, penumbral + moonR),
      "none",
    );
  });

  it("仅入半影为半影食", () => {
    assert.equal(
      classifyLunarEclipse(umbral, penumbral, moonR, penumbral + moonR - 1e-6),
      "lunar-penumbral",
    );
    assert.equal(
      classifyLunarEclipse(umbral, penumbral, moonR, umbral + moonR + 1e-9),
      "lunar-penumbral",
    );
  });

  it("触及本影为偏食，完全没入为全食", () => {
    assert.equal(
      classifyLunarEclipse(umbral, penumbral, moonR, umbral + moonR - 1e-9),
      "lunar-partial",
    );
    assert.equal(
      classifyLunarEclipse(umbral, penumbral, moonR, umbral - moonR),
      "lunar-total",
    );
    assert.equal(
      classifyLunarEclipse(umbral, penumbral, moonR, umbral - moonR + 1e-9),
      "lunar-partial",
    );
  });
});

describe("食分临界", () => {
  it("擦边时食分趋近于零且非负", () => {
    const sunR = 0.266;
    const moonR = 0.27;
    const grazing = solarMagnitude(sunR, moonR, sunR + moonR - 1e-9);
    assert.ok(grazing > 0 && grazing < 1e-6, `grazing magnitude ${grazing}`);
    assert.equal(solarMagnitude(sunR, moonR, sunR + moonR), 0);
    assert.equal(solarMagnitude(sunR, moonR, sunR + moonR + 1), 0);
  });

  it("食分随中心距单调递减", () => {
    const sunR = 0.266;
    const moonR = 0.27;
    let previous = Number.POSITIVE_INFINITY;
    for (let sep = 0; sep <= sunR + moonR; sep += 0.01) {
      const mag = solarMagnitude(sunR, moonR, sep);
      assert.ok(mag <= previous + 1e-12, `monotonicity broken at sep=${sep}`);
      previous = mag;
    }
  });

  it("月食食分在恰好触及本影时为零", () => {
    const umbral = 0.69;
    const moonR = 0.25;
    assert.equal(lunarUmbralMagnitude(umbral, moonR, umbral + moonR), 0);
    assert.ok(
      lunarUmbralMagnitude(umbral, moonR, umbral + moonR - 1e-6) > 0,
    );
  });
});
