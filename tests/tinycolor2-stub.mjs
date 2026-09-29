// Minimal offline stub for the subset of the tinycolor2 API used by
// GradientEngine: tinycolor(input).toRgb() and tinycolor(input).toHexString().
// Supports #rgb / #rrggbb / #rrggbbaa hex strings, rgb()/rgba() strings and
// { r, g, b, a? } objects. This lets the test-suite run with zero installed
// dependencies (no network, no node_modules).

function clampChannel(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseColor(input) {
  if (input && typeof input === 'object') {
    return {
      r: clampChannel(input.r),
      g: clampChannel(input.g),
      b: clampChannel(input.b),
      a: input.a === undefined ? 1 : Number(input.a),
    };
  }
  const str = String(input).trim();
  const hexMatch = str.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map(ch => ch + ch)
        .join('');
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgbMatch = str.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i
  );
  if (rgbMatch) {
    return {
      r: clampChannel(rgbMatch[1]),
      g: clampChannel(rgbMatch[2]),
      b: clampChannel(rgbMatch[3]),
      a: rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4]),
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function toHex2(value) {
  return clampChannel(value).toString(16).padStart(2, '0');
}

class TinyColorStub {
  constructor(input) {
    this._rgb = parseColor(input);
  }

  toRgb() {
    return { ...this._rgb };
  }

  toHexString() {
    const { r, g, b } = this._rgb;
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }
}

export default function tinycolor(input) {
  return new TinyColorStub(input);
}
