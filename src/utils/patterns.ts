import { OverlayPattern } from '../types';

export const PRESET_PATTERNS: Omit<OverlayPattern, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>[] = [
  {
    id: 'landscape-1',
    name: '山水',
    category: 'landscape',
    svgData: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <path d="M10,180 Q50,100 80,140 T150,120 T190,160 L190,190 L10,190 Z" fill="none" stroke="#3a6b8a" stroke-width="1.5"/>
        <path d="M30,150 Q60,80 90,120 T140,100 T180,130" fill="none" stroke="#4a7c59" stroke-width="1"/>
        <circle cx="160" cy="50" r="20" fill="none" stroke="#d4a017" stroke-width="1"/>
        <path d="M20,60 Q40,30 60,50 Q80,30 100,60" fill="none" stroke="#9a8a7a" stroke-width="0.8"/>
      </svg>
    `,
  },
  {
    id: 'bird-1',
    name: '花鸟',
    category: 'bird',
    svgData: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <ellipse cx="100" cy="120" rx="40" ry="25" fill="none" stroke="#8b6f47" stroke-width="1.5"/>
        <circle cx="120" cy="100" r="15" fill="none" stroke="#8b6f47" stroke-width="1.5"/>
        <path d="M135,95 L150,90 L135,100" fill="none" stroke="#c0392b" stroke-width="1.5"/>
        <circle cx="125" cy="98" r="2" fill="#1a1a1a"/>
        <path d="M60,120 Q40,80 30,60 Q50,70 65,100" fill="none" stroke="#4a7c59" stroke-width="1"/>
        <path d="M70,130 Q50,150 35,170" fill="none" stroke="#4a7c59" stroke-width="1"/>
        <path d="M85,110 Q95,90 105,110" fill="none" stroke="#d4a017" stroke-width="1"/>
      </svg>
    `,
  },
  {
    id: 'figure-1',
    name: '人物',
    category: 'figure',
    svgData: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <circle cx="100" cy="60" r="20" fill="none" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="M100,80 L100,140" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="M100,95 L70,120" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="M100,95 L130,120" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="M100,140 L80,190" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="M100,140 L120,190" stroke="#1a1a1a" stroke-width="1.5"/>
        <path d="M80,70 Q100,50 120,70" fill="none" stroke="#3a6b8a" stroke-width="2"/>
        <path d="M75,90 Q100,85 125,90 L130,150 L70,150 Z" fill="none" stroke="#c0392b" stroke-width="1.5"/>
      </svg>
    `,
  },
  {
    id: 'landscape-2',
    name: '远山',
    category: 'landscape',
    svgData: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <path d="M10,160 L40,100 L70,130 L100,80 L130,120 L160,90 L190,160" fill="none" stroke="#3a6b8a" stroke-width="1"/>
        <path d="M10,180 L30,140 L60,160 L90,130 L120,150 L150,120 L190,180" fill="none" stroke="#4a7c59" stroke-width="1.5"/>
        <path d="M50,70 Q70,50 90,70" fill="none" stroke="#9a8a7a" stroke-width="0.8"/>
        <path d="M120,60 Q140,40 160,60" fill="none" stroke="#9a8a7a" stroke-width="0.8"/>
      </svg>
    `,
  },
  {
    id: 'bird-2',
    name: '梅兰',
    category: 'bird',
    svgData: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <path d="M100,20 L100,180" stroke="#8b6f47" stroke-width="2"/>
        <path d="M100,60 L70,40" stroke="#8b6f47" stroke-width="1"/>
        <path d="M100,90 L130,70" stroke="#8b6f47" stroke-width="1"/>
        <path d="M100,120 L80,110" stroke="#8b6f47" stroke-width="1"/>
        <path d="M100,150 L140,140" stroke="#8b6f47" stroke-width="1"/>
        <circle cx="70" cy="40" r="8" fill="none" stroke="#c0392b" stroke-width="1.5"/>
        <circle cx="130" cy="70" r="8" fill="none" stroke="#f5e6d3" stroke="1.5"/>
        <circle cx="80" cy="110" r="8" fill="none" stroke="#c0392b" stroke-width="1.5"/>
        <circle cx="140" cy="140" r="8" fill="none" stroke="#f5e6d3" stroke-width="1.5"/>
      </svg>
    `,
  },
  {
    id: 'figure-2',
    name: '仕女',
    category: 'figure',
    svgData: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <ellipse cx="100" cy="55" rx="18" ry="22" fill="none" stroke="#1a1a1a" stroke-width="1"/>
        <path d="M82,45 Q100,30 118,45" fill="none" stroke="#1a1a1a" stroke-width="2"/>
        <path d="M85,65 Q100,70 115,65" fill="none" stroke="#c0392b" stroke-width="1"/>
        <circle cx="93" cy="55" r="1.5" fill="#1a1a1a"/>
        <circle cx="107" cy="55" r="1.5" fill="#1a1a1a"/>
        <path d="M100,77 L100,120" stroke="#1a1a1a" stroke-width="1"/>
        <path d="M100,90 L75,110" stroke="#1a1a1a" stroke-width="1"/>
        <path d="M100,90 L125,110" stroke="#1a1a1a" stroke-width="1"/>
        <path d="M75,110 Q70,180 85,190 L115,190 Q130,180 125,110" fill="none" stroke="#3a6b8a" stroke-width="1.5"/>
        <path d="M70,100 Q65,130 75,150" fill="none" stroke="#4a7c59" stroke-width="1"/>
      </svg>
    `,
  },
];
