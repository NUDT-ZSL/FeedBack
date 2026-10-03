// Offline test double for the slice of the Phaser API used by TradeManager.
// No browser, DOM or canvas is required. Randomness is a deterministic,
// seedable PRNG so suites are reproducible; hooks allow a suite to pin the
// next random result (used to drive prices/inventory to exact boundaries).

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class RngController {
  constructor() {
    this.reset(1);
  }

  reset(seed) {
    this.seed = seed >>> 0;
    this._source = mulberry32(this.seed);
    // One-shot pins: next call returns exactly this value once.
    this.fixedFloat = null;
    this.fixedInt = null;
    // Sticky pins: stay in effect until explicitly cleared. Useful when a
    // single production call (e.g. registerStation) performs many draws.
    this.stickyFloat = null;
    this.stickyInt = null;
  }

  drawFloat() {
    if (this.stickyFloat !== null) return this.stickyFloat;
    if (this.fixedFloat !== null) {
      const v = this.fixedFloat;
      this.fixedFloat = null;
      return v;
    }
    return this._source();
  }

  drawInt() {
    if (this.stickyInt !== null) return this.stickyInt;
    if (this.fixedInt !== null) {
      const v = this.fixedInt;
      this.fixedInt = null;
      return v;
    }
    return this._source();
  }
}

export const rng = new RngController();

const Phaser = {
  Math: {
    Between(min, max) {
      if (rng.stickyInt !== null || rng.fixedInt !== null) return rng.drawInt();
      return Math.floor(min + rng.drawInt() * (max - min + 1));
    },
    FloatBetween(min, max) {
      if (rng.stickyFloat !== null || rng.fixedFloat !== null) return rng.drawFloat();
      return min + rng.drawFloat() * (max - min);
    },
    Clamp(value, min, max) {
      if (value < min) return min;
      if (value > max) return max;
      return value;
    }
  }
};

export default Phaser;
