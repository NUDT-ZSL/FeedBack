class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
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

function generatePermutation(seed: number): number[] {
  const random = new SeededRandom(seed);
  const p: number[] = [];
  for (let i = 0; i < 256; i++) {
    p[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random.nextRange(0, i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
}

function perlinNoise2D(x: number, y: number, perm: number[]): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;

  x -= Math.floor(x);
  y -= Math.floor(y);

  const u = fade(x);
  const v = fade(y);

  const A = perm[X] + Y;
  const B = perm[X + 1] + Y;

  return lerp(
    lerp(grad(perm[A], x, y), grad(perm[B], x - 1, y), u),
    lerp(grad(perm[A + 1], x, y - 1), grad(perm[B + 1], x - 1, y - 1), u),
    v
  );
}

export function createNoiseCanvas(
  width: number,
  height: number,
  seed: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const perm = generatePermutation(seed);
  const random = new SeededRandom(seed);

  const scale = 0.02;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      let noiseVal = 0;
      let amplitude = 1;
      let frequency = scale;
      let maxValue = 0;

      for (let octave = 0; octave < 4; octave++) {
        noiseVal += perlinNoise2D(x * frequency, y * frequency, perm) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }

      noiseVal = (noiseVal / maxValue + 1) / 2;

      const fiberNoise = random.next();
      const fiberStrength = fiberNoise > 0.97 ? random.nextRange(0, 0.15) : 0;

      const baseR = 245;
      const baseG = 235;
      const baseB = 215;

      const variation = noiseVal * 20 - 10;

      let r = Math.floor(baseR + variation + fiberStrength * 50);
      let g = Math.floor(baseG + variation + fiberStrength * 40);
      let b = Math.floor(baseB + variation + fiberStrength * 30);

      const grain = random.nextRange(-5, 5);
      r += grain;
      g += grain;
      b += grain;

      r = Math.min(255, Math.max(200, r));
      g = Math.min(255, Math.max(190, g));
      b = Math.min(255, Math.max(170, b));

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function generatePaperTexture(seed: number): string {
  const canvas = createNoiseCanvas(512, 512, seed);
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 350);
  gradient.addColorStop(0, 'rgba(255, 250, 240, 0)');
  gradient.addColorStop(0.7, 'rgba(210, 190, 160, 0.1)');
  gradient.addColorStop(1, 'rgba(180, 160, 130, 0.3)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  const random = new SeededRandom(seed + 1000);
  for (let i = 0; i < 20; i++) {
    ctx.strokeStyle = `rgba(180, 150, 100, ${random.nextRange(0.02, 0.08)})`;
    ctx.lineWidth = random.nextRange(0.5, 2);
    ctx.beginPath();
    const startX = random.nextRange(0, 512);
    const startY = random.nextRange(0, 512);
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + random.nextRange(-100, 100),
      startY + random.nextRange(-50, 50),
      startX + random.nextRange(-100, 100),
      startY + random.nextRange(-50, 50),
      startX + random.nextRange(-150, 150),
      startY + random.nextRange(-100, 100)
    );
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
}

const watermarkTemplates: Record<string, string> = {
  竹韵: `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/>
        </filter>
      </defs>
      <circle cx="60" cy="60" r="55" fill="none" stroke="#c41e3a" stroke-width="3" opacity="0.9"/>
      <circle cx="60" cy="60" r="48" fill="none" stroke="#c41e3a" stroke-width="1" opacity="0.7"/>
      <g fill="#c41e3a" opacity="0.9" font-family="STKaiti, KaiTi, serif" font-weight="bold">
        <text x="60" y="40" text-anchor="middle" font-size="18">竹</text>
        <text x="60" y="62" text-anchor="middle" font-size="18">韵</text>
        <text x="60" y="84" text-anchor="middle" font-size="12">甲辰年</text>
      </g>
      <g stroke="#c41e3a" stroke-width="1.5" fill="none" opacity="0.6">
        <path d="M25 70 Q30 50 35 70 Q40 55 45 70" />
        <path d="M85 45 Q90 35 95 45 Q100 40 105 45" />
        <circle cx="30" cy="68" r="2" fill="#c41e3a" opacity="0.8"/>
        <circle cx="40" cy="62" r="1.5" fill="#c41e3a" opacity="0.7"/>
        <circle cx="90" cy="43" r="2" fill="#c41e3a" opacity="0.8"/>
        <circle cx="100" cy="48" r="1.5" fill="#c41e3a" opacity="0.7"/>
      </g>
    </svg>
  `,
  云鹤: `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/>
        </filter>
      </defs>
      <rect x="10" y="10" width="100" height="100" rx="8" fill="none" stroke="#c41e3a" stroke-width="3" opacity="0.9"/>
      <rect x="18" y="18" width="84" height="84" rx="4" fill="none" stroke="#c41e3a" stroke-width="1" opacity="0.7"/>
      <g fill="#c41e3a" opacity="0.9" font-family="STKaiti, KaiTi, serif" font-weight="bold">
        <text x="60" y="45" text-anchor="middle" font-size="16">云</text>
        <text x="60" y="70" text-anchor="middle" font-size="16">鹤</text>
      </g>
      <g stroke="#c41e3a" stroke-width="1.5" fill="none" opacity="0.5">
        <path d="M30 25 Q35 20 40 25 Q45 20 50 25" />
        <path d="M70 25 Q75 20 80 25 Q85 20 90 25" />
        <path d="M25 95 Q50 80 75 95 Q95 85 100 95" />
        <path d="M35 55 Q40 50 50 55 Q55 50 60 55 Q65 50 70 55" />
        <circle cx="40" cy="23" r="1.5" fill="#c41e3a" opacity="0.6"/>
        <circle cx="80" cy="23" r="1.5" fill="#c41e3a" opacity="0.6"/>
      </g>
    </svg>
  `,
  福寿: `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/>
        </filter>
      </defs>
      <circle cx="60" cy="60" r="55" fill="none" stroke="#c41e3a" stroke-width="4" opacity="0.9"/>
      <circle cx="60" cy="60" r="50" fill="none" stroke="#c41e3a" stroke-width="1" opacity="0.5"/>
      <circle cx="60" cy="60" r="45" fill="none" stroke="#c41e3a" stroke-width="1" opacity="0.5"/>
      <g fill="#c41e3a" opacity="0.95" font-family="STKaiti, KaiTi, serif" font-weight="bold">
        <text x="60" y="52" text-anchor="middle" font-size="28">福</text>
        <text x="60" y="88" text-anchor="middle" font-size="22">寿</text>
      </g>
      <g stroke="#c41e3a" stroke-width="1.5" fill="none" opacity="0.4">
        <path d="M20 60 Q15 50 20 40 Q25 50 20 60" />
        <path d="M100 60 Q105 50 100 40 Q95 50 100 60" />
        <path d="M60 20 Q50 15 40 20 Q50 25 60 20" />
        <path d="M60 100 Q50 105 40 100 Q50 95 60 100" />
      </g>
      <g fill="#c41e3a" opacity="0.6">
        <circle cx="25" cy="30" r="2"/>
        <circle cx="95" cy="30" r="2"/>
        <circle cx="25" cy="90" r="2"/>
        <circle cx="95" cy="90" r="2"/>
      </g>
    </svg>
  `,
  兰亭: `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/>
        </filter>
      </defs>
      <polygon points="60,5 115,35 115,85 60,115 5,85 5,35" fill="none" stroke="#c41e3a" stroke-width="3" opacity="0.9"/>
      <polygon points="60,15 105,40 105,80 60,105 15,80 15,40" fill="none" stroke="#c41e3a" stroke-width="1" opacity="0.6"/>
      <g fill="#c41e3a" opacity="0.9" font-family="STKaiti, KaiTi, serif" font-weight="bold">
        <text x="60" y="45" text-anchor="middle" font-size="18">兰</text>
        <text x="60" y="70" text-anchor="middle" font-size="18">亭</text>
        <text x="60" y="92" text-anchor="middle" font-size="10">羲之印</text>
      </g>
      <g stroke="#c41e3a" stroke-width="1" fill="none" opacity="0.4">
        <path d="M30 30 Q35 25 40 30" />
        <path d="M80 30 Q85 25 90 30" />
        <path d="M25 75 Q30 70 35 75" />
        <path d="M85 75 Q90 70 95 75" />
      </g>
      <g fill="#c41e3a" opacity="0.5">
        <circle cx="35" cy="28" r="1.5"/>
        <circle cx="85" cy="28" r="1.5"/>
        <circle cx="30" cy="73" r="1.5"/>
        <circle cx="90" cy="73" r="1.5"/>
      </g>
    </svg>
  `,
  山水: `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/>
        </filter>
      </defs>
      <rect x="8" y="8" width="104" height="104" fill="none" stroke="#c41e3a" stroke-width="3" opacity="0.9"/>
      <rect x="16" y="16" width="88" height="88" fill="none" stroke="#c41e3a" stroke-width="1" opacity="0.6"/>
      <g stroke="#c41e3a" stroke-width="2" fill="none" opacity="0.7">
        <path d="M20 85 L35 55 L50 70 L65 45 L80 65 L100 40" />
        <path d="M25 95 Q45 85 60 90 Q75 85 95 95" />
        <path d="M30 95 Q40 90 50 95 Q60 90 70 95 Q80 90 90 95" />
      </g>
      <g fill="#c41e3a" opacity="0.9" font-family="STKaiti, KaiTi, serif" font-weight="bold">
        <text x="60" y="35" text-anchor="middle" font-size="14">山</text>
        <text x="75" y="42" text-anchor="middle" font-size="14">水</text>
      </g>
      <g stroke="#c41e3a" stroke-width="1.5" fill="none" opacity="0.5">
        <circle cx="85" cy="30" r="6"/>
        <path d="M80 30 L90 30 M85 25 L85 35" />
      </g>
      <g fill="#c41e3a" opacity="0.4">
        <circle cx="75" cy="25" r="1"/>
        <circle cx="82" cy="22" r="0.8"/>
        <circle cx="90" cy="25" r="1"/>
      </g>
    </svg>
  `,
  墨韵: `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.8"/>
        </filter>
        <radialGradient id="inkGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style="stop-color:#c41e3a;stop-opacity:1" />
          <stop offset="70%" style="stop-color:#c41e3a;stop-opacity:0.8" />
          <stop offset="100%" style="stop-color:#c41e3a;stop-opacity:0.3" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="60" rx="52" ry="55" fill="url(#inkGrad)" opacity="0.85"/>
      <ellipse cx="60" cy="60" rx="48" ry="50" fill="none" stroke="#c41e3a" stroke-width="2" opacity="0.6"/>
      <g fill="#fff" opacity="0.95" font-family="STKaiti, KaiTi, serif" font-weight="bold">
        <text x="60" y="48" text-anchor="middle" font-size="20">墨</text>
        <text x="60" y="78" text-anchor="middle" font-size="20">韵</text>
      </g>
      <g fill="#c41e3a" opacity="0.4">
        <circle cx="20" cy="35" r="4"/>
        <circle cx="100" cy="40" r="5"/>
        <circle cx="25" cy="90" r="3"/>
        <circle cx="95" cy="85" r="4"/>
        <circle cx="15" cy="60" r="2.5"/>
        <circle cx="105" cy="65" r="3"/>
      </g>
      <g stroke="#c41e3a" stroke-width="1" fill="none" opacity="0.3">
        <path d="M30 25 Q40 20 50 28" />
        <path d="M70 28 Q80 20 90 25" />
        <path d="M30 95 Q45 88 55 95 Q70 88 85 95" />
      </g>
    </svg>
  `
};

export function generateWatermarkSVG(type: string): string {
  const validTypes = ['竹韵', '云鹤', '福寿', '兰亭', '山水', '墨韵'];
  
  if (!validTypes.includes(type)) {
    console.warn(`Unknown watermark type: ${type}. Using default '竹韵'.`);
    type = '竹韵';
  }

  const svg = watermarkTemplates[type];
  const encoded = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

export function generateScrollBackground(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, 0, 100);
  gradient.addColorStop(0, '#8b4513');
  gradient.addColorStop(0.15, '#d4a574');
  gradient.addColorStop(0.35, '#f5deb3');
  gradient.addColorStop(0.5, '#fff8dc');
  gradient.addColorStop(0.65, '#f5deb3');
  gradient.addColorStop(0.85, '#d4a574');
  gradient.addColorStop(1, '#8b4513');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 800, 100);

  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 800;
    const y = Math.random() * 100;
    ctx.fillStyle = `rgba(139, 69, 19, ${Math.random() * 0.1})`;
    ctx.fillRect(x, y, 1, 1);
  }

  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(139, 69, 19, ${0.1 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const y = 20 + Math.random() * 60;
    ctx.moveTo(0, y);
    for (let x = 0; x < 800; x += 20) {
      ctx.lineTo(x, y + Math.sin(x * 0.05) * 2);
    }
    ctx.stroke();
  }

  ctx.fillStyle = '#654321';
  ctx.fillRect(0, 0, 30, 100);
  ctx.fillRect(770, 0, 30, 100);

  const edgeGradient1 = ctx.createLinearGradient(0, 0, 30, 0);
  edgeGradient1.addColorStop(0, '#5c3317');
  edgeGradient1.addColorStop(0.5, '#8b4513');
  edgeGradient1.addColorStop(1, 'rgba(139, 69, 19, 0)');
  ctx.fillStyle = edgeGradient1;
  ctx.fillRect(0, 0, 30, 100);

  const edgeGradient2 = ctx.createLinearGradient(770, 0, 800, 0);
  edgeGradient2.addColorStop(0, 'rgba(139, 69, 19, 0)');
  edgeGradient2.addColorStop(0.5, '#8b4513');
  edgeGradient2.addColorStop(1, '#5c3317');
  ctx.fillStyle = edgeGradient2;
  ctx.fillRect(770, 0, 30, 100);

  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = `rgba(92, 51, 23, ${0.3 + Math.random() * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const y = i * 10;
    ctx.moveTo(5, y);
    ctx.lineTo(25, y);
    ctx.moveTo(775, y);
    ctx.lineTo(795, y);
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
}
