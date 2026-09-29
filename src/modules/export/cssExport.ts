const COLOR_NAMES = [
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
  "muted",
];

export function generateCSSVariables(colors: string[]): string {
  if (colors.length === 0) return "/* 暂无颜色 */";
  return colors
    .map((color, i) => {
      const name = COLOR_NAMES[i] || `color-${i + 1}`;
      return `  --${name}: ${color.toUpperCase()};`;
    })
    .join("\n");
}

export function formatCSSCode(colors: string[]): string {
  return `:root {\n${generateCSSVariables(colors)}\n}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
      return true;
    } finally {
      textArea.remove();
    }
  } catch {
    return false;
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

export function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000000";
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export function darkenColor(hex: string, percent: number = 0.15): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 - percent))));
  return (
    "#" +
    [adjust(rgb.r), adjust(rgb.g), adjust(rgb.b)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export function isValidHex(color: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
}

export function normalizeHex(color: string): string {
  let c = color.trim();
  if (!c.startsWith("#")) c = "#" + c;
  if (/^#([A-Fa-f0-9]{3})$/.test(c)) {
    c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  return c.toUpperCase();
}
