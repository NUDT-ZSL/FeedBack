import { SealFont } from '../types';

interface CharPath {
  xiaozhuan: string;
  miaozhuan: string;
  jiudiezhuan: string;
}

export const zhuanshuPaths: Record<string, CharPath> = {
  '印': {
    xiaozhuan: 'M20,10 L80,10 L80,30 L20,30 Z M30,40 L70,40 L70,60 L30,60 Z M25,70 L75,70 L75,90 L25,90 Z',
    miaozhuan: 'M15,15 L85,15 L85,35 L15,35 Z M35,40 L65,40 L65,65 L35,65 Z M20,70 L80,70 L80,85 L20,85 Z',
    jiudiezhuan: 'M10,10 L90,10 L90,25 L10,25 Z M10,30 L90,30 L90,45 L10,45 Z M20,50 L80,50 L80,65 L20,65 Z M10,70 L90,70 L90,85 L10,85 Z M10,90 L90,90 L90,95 L10,95 Z',
  },
  '章': {
    xiaozhuan: 'M20,10 L80,10 L80,25 L20,25 Z M40,30 L60,30 L60,50 L40,50 Z M25,55 L75,55 L75,70 L25,70 Z M30,75 L70,75 L70,95 L30,95 Z',
    miaozhuan: 'M15,12 L85,12 L85,28 L15,28 Z M35,35 L65,35 L65,55 L35,55 Z M20,60 L80,60 L80,75 L20,75 Z M25,80 L75,80 L75,95 L25,95 Z',
    jiudiezhuan: 'M10,8 L90,8 L90,22 L10,22 Z M10,28 L90,28 L90,42 L10,42 Z M30,48 L70,48 L70,62 L30,62 Z M10,68 L90,68 L90,82 L10,82 Z M10,88 L90,88 L90,95 L10,95 Z',
  },
  '书': {
    xiaozhuan: 'M20,10 L80,10 L80,20 L20,20 Z M30,25 L70,25 L70,35 L30,35 Z M25,40 L75,40 L75,50 L25,50 Z M45,55 L55,55 L55,95 L45,95 Z',
    miaozhuan: 'M15,12 L85,12 L85,25 L15,25 Z M25,30 L75,30 L75,45 L25,45 Z M20,50 L80,50 L80,65 L20,65 Z M40,70 L60,70 L60,95 L40,95 Z',
    jiudiezhuan: 'M10,8 L90,8 L90,20 L10,20 Z M10,26 L90,26 L90,38 L10,38 Z M10,44 L90,44 L90,56 L10,56 Z M42,62 L58,62 L58,74 L42,74 Z M42,80 L58,80 L58,95 L42,95 Z',
  },
  '画': {
    xiaozhuan: 'M20,10 L80,10 L80,20 L20,20 Z M15,25 L85,25 L85,35 L15,35 Z M30,40 L70,40 L70,60 L30,60 Z M20,65 L80,65 L80,75 L20,75 Z M25,80 L75,80 L75,95 L25,95 Z',
    miaozhuan: 'M15,10 L85,10 L85,22 L15,22 Z M10,28 L90,28 L90,40 L10,40 Z M35,45 L65,45 L65,60 L35,60 Z M15,65 L85,65 L85,77 L15,77 Z M20,82 L80,82 L80,95 L20,95 Z',
    jiudiezhuan: 'M10,8 L90,8 L90,18 L10,18 Z M10,24 L90,24 L90,34 L10,34 Z M10,40 L90,40 L90,50 L10,50 Z M30,56 L70,56 L70,66 L30,66 Z M10,72 L90,72 L90,82 L10,82 Z M10,88 L90,88 L90,95 L10,95 Z',
  },
};

export const generateSealPath = (char: string, font: SealFont): string => {
  if (zhuanshuPaths[char] && zhuanshuPaths[char][font]) {
    return zhuanshuPaths[char][font];
  }
  return generateDefaultPath(char, font);
};

const generateDefaultPath = (char: string, font: SealFont): string => {
  const basePaths: Record<SealFont, string> = {
    xiaozhuan: `M20,15 Q50,5 80,15 Q85,50 80,85 Q50,95 20,85 Q15,50 20,15 Z M35,35 Q50,30 65,35 Q65,50 65,65 Q50,70 35,65 Q35,50 35,35 Z`,
    miaozhuan: `M15,15 L85,15 L85,85 L15,85 Z M25,25 L75,25 L75,45 L25,45 Z M25,55 L75,55 L75,75 L25,75 Z`,
    jiudiezhuan: `M10,10 L90,10 L90,25 L10,25 Z M10,30 L90,30 L90,45 L10,45 Z M10,50 L90,50 L90,65 L10,65 Z M10,70 L90,70 L90,85 L10,85 Z M10,90 L90,90 L90,95 L10,95 Z`,
  };
  return basePaths[font];
};

export const addImperfection = (path: string, intensity: number = 2): string => {
  return path.replace(/([0-9.]+)/g, (match) => {
    const num = parseFloat(match);
    const jitter = (Math.random() - 0.5) * intensity;
    return (num + jitter).toFixed(2);
  });
};
