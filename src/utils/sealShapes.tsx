export interface SealShapeProps {
  color?: string;
  size?: number;
}

const dropShadowFilter = `
  <filter id="seal-shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur" />
    <feOffset in="blur" dx="1" dy="1" result="offsetBlur" />
    <feComponentTransfer in="offsetBlur" result="shadow">
      <feFuncA type="linear" slope="0.4" />
    </feComponentTransfer>
    <feMerge>
      <feMergeNode in="shadow" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
`;

export function GourdSeal({ color = '#c0392b', size = 64 }: SealShapeProps) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 64 77" fill="none">
      <defs dangerouslySetInnerHTML={{ __html: dropShadowFilter }} />
      <path
        d="M32 5C20 5 12 15 12 25C12 32 16 38 20 41C14 45 10 53 10 60C10 70 20 75 32 75C44 75 54 70 54 60C54 53 50 45 44 41C48 38 52 32 52 25C52 15 44 5 32 5Z"
        fill={color}
        filter="url(#seal-shadow)"
      />
      <text
        x="32"
        y="52"
        textAnchor="middle"
        fill="white"
        fontSize="28"
        fontFamily="'Ma Shan Zheng', cursive"
        style={{ fontWeight: 'bold' }}
      >
        永
      </text>
    </svg>
  );
}

export function SquareSeal({ color = '#c0392b', size = 64 }: SealShapeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs dangerouslySetInnerHTML={{ __html: dropShadowFilter }} />
      <rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="4"
        fill={color}
        filter="url(#seal-shadow)"
      />
      <rect x="8" y="8" width="48" height="48" rx="2" fill="none" stroke="white" strokeWidth="1" opacity="0.5" />
      <text
        x="32"
        y="44"
        textAnchor="middle"
        fill="white"
        fontSize="32"
        fontFamily="'Ma Shan Zheng', cursive"
        style={{ fontWeight: 'bold' }}
      >
        赏
      </text>
    </svg>
  );
}

export function CircleSeal({ color = '#c0392b', size = 64 }: SealShapeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs dangerouslySetInnerHTML={{ __html: dropShadowFilter }} />
      <circle
        cx="32"
        cy="32"
        r="28"
        fill={color}
        filter="url(#seal-shadow)"
      />
      <circle cx="32" cy="32" r="24" fill="none" stroke="white" strokeWidth="1" opacity="0.5" />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        fill="white"
        fontSize="30"
        fontFamily="'Ma Shan Zheng', cursive"
        style={{ fontWeight: 'bold' }}
      >
        藏
      </text>
    </svg>
  );
}

export function OvalSeal({ color = '#c0392b', size = 64 }: SealShapeProps) {
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 64 48" fill="none">
      <defs dangerouslySetInnerHTML={{ __html: dropShadowFilter }} />
      <ellipse
        cx="32"
        cy="24"
        rx="28"
        ry="20"
        fill={color}
        filter="url(#seal-shadow)"
      />
      <ellipse cx="32" cy="24" rx="24" ry="16" fill="none" stroke="white" strokeWidth="1" opacity="0.5" />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        fill="white"
        fontSize="26"
        fontFamily="'Ma Shan Zheng', cursive"
        style={{ fontWeight: 'bold' }}
      >
        鉴
      </text>
    </svg>
  );
}

export function RectSeal({ color = '#c0392b', size = 64 }: SealShapeProps) {
  return (
    <svg width={size * 1.4} height={size} viewBox="0 0 90 64" fill="none">
      <defs dangerouslySetInnerHTML={{ __html: dropShadowFilter }} />
      <rect
        x="4"
        y="4"
        width="82"
        height="56"
        rx="4"
        fill={color}
        filter="url(#seal-shadow)"
      />
      <rect x="8" y="8" width="74" height="48" rx="2" fill="none" stroke="white" strokeWidth="1" opacity="0.5" />
      <text
        x="45"
        y="44"
        textAnchor="middle"
        fill="white"
        fontSize="32"
        fontFamily="'Ma Shan Zheng', cursive"
        style={{ fontWeight: 'bold' }}
      >
        玩
      </text>
    </svg>
  );
}

export const sealComponents = {
  gourd: GourdSeal,
  square: SquareSeal,
  circle: CircleSeal,
  oval: OvalSeal,
  rect: RectSeal,
};
