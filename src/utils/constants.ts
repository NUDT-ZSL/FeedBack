import type { DougongComponent, ComponentType } from '../types';

export const WOOD_COLORS = {
  lightPine: '#c9a66b',
  mediumPine: '#a67c52',
  darkPine: '#8b5a2b',
  goldenOak: '#d4a855',
  richMahogany: '#5a3a1a',
  lightOak: '#d4b896',
};

export const TENON_TYPES = {
  rectangular: '矩形榫',
  dovetail: '燕尾榫',
  mortise: '卯口',
  halfTenon: '半榫',
};

export const MORTISE_TYPES = {
  rectangular: '矩形卯',
  dovetail: '燕尾卯',
  throughMortise: '透卯',
  blindMortise: '半卯',
};

export const MATERIALS = {
  yellowPine: '黄松木',
  fir: '杉木',
  oak: '橡木',
  elm: '榆木',
};

const createComponent = (
  id: string,
  name: string,
  type: ComponentType,
  order: number,
  dimensions: { width: number; height: number; depth: number },
  position: { x: number; y: number; z: number },
  color: string,
  tenonType: string,
  mortiseType: string,
  material: string = MATERIALS.yellowPine
): DougongComponent => ({
  id,
  name,
  type,
  position: { ...position },
  rotation: { x: 0, y: 0, z: 0 },
  correctPosition: { ...position },
  correctRotation: { x: 0, y: 0, z: 0 },
  color,
  isAssembled: true,
  isSnapped: true,
  assemblyOrder: order,
  material,
  tenonType,
  mortiseType,
  dimensions,
  isAnimating: false,
  animationPhase: 'idle',
});

export const INITIAL_COMPONENTS: DougongComponent[] = [
  createComponent(
    'cap-block',
    '栌斗',
    'CapBlock' as ComponentType,
    1,
    { width: 32, height: 24, depth: 24 },
    { x: 0, y: 12, z: 0 },
    WOOD_COLORS.mediumPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'nidao-arch',
    '泥道拱',
    'ArchBracket' as ComponentType,
    2,
    { width: 96, height: 8, depth: 16 },
    { x: 0, y: 28, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.rectangular
  ),
  createComponent(
    'hua-arch-1',
    '华拱（第一层）',
    'ArchBracket' as ComponentType,
    3,
    { width: 16, height: 8, depth: 48 },
    { x: 0, y: 28, z: 0 },
    WOOD_COLORS.lightOak,
    TENON_TYPES.rectangular,
    MORTISE_TYPES.rectangular
  ),
  createComponent(
    'qixin-dou-1',
    '齐心斗（第一层）',
    'CorbelBracket' as ComponentType,
    4,
    { width: 16, height: 12, depth: 16 },
    { x: 0, y: 38, z: 0 },
    WOOD_COLORS.mediumPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'san-dou-left-1',
    '散斗（泥道拱左）',
    'CorbelBracket' as ComponentType,
    5,
    { width: 14, height: 10, depth: 14 },
    { x: -40, y: 34, z: 0 },
    WOOD_COLORS.darkPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'san-dou-right-1',
    '散斗（泥道拱右）',
    'CorbelBracket' as ComponentType,
    6,
    { width: 14, height: 10, depth: 14 },
    { x: 40, y: 34, z: 0 },
    WOOD_COLORS.darkPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'hua-arch-2',
    '华拱（第二层）',
    'ArchBracket' as ComponentType,
    7,
    { width: 16, height: 8, depth: 64 },
    { x: 0, y: 44, z: 0 },
    WOOD_COLORS.goldenOak,
    TENON_TYPES.rectangular,
    MORTISE_TYPES.rectangular
  ),
  createComponent(
    'ling-arch',
    '令拱',
    'ArchBracket' as ComponentType,
    8,
    { width: 80, height: 8, depth: 16 },
    { x: 0, y: 44, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.rectangular
  ),
  createComponent(
    'qixin-dou-2',
    '齐心斗（第二层）',
    'CorbelBracket' as ComponentType,
    9,
    { width: 16, height: 12, depth: 16 },
    { x: 0, y: 54, z: 0 },
    WOOD_COLORS.mediumPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'san-dou-left-2',
    '散斗（令拱左）',
    'CorbelBracket' as ComponentType,
    10,
    { width: 14, height: 10, depth: 14 },
    { x: -32, y: 50, z: 0 },
    WOOD_COLORS.darkPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'san-dou-right-2',
    '散斗（令拱右）',
    'CorbelBracket' as ComponentType,
    11,
    { width: 14, height: 10, depth: 14 },
    { x: 32, y: 50, z: 0 },
    WOOD_COLORS.darkPine,
    TENON_TYPES.mortise,
    MORTISE_TYPES.blindMortise
  ),
  createComponent(
    'shua-tou',
    '耍头',
    'Cantilever' as ComponentType,
    12,
    { width: 16, height: 12, depth: 72 },
    { x: 0, y: 60, z: 0 },
    WOOD_COLORS.richMahogany,
    TENON_TYPES.dovetail,
    MORTISE_TYPES.dovetail
  ),
];

export const SUBSTITUTE_WOOD_COMPONENT: DougongComponent = createComponent(
  'substitute-wood',
  '替木',
  'SubstituteWood' as ComponentType,
  13,
  { width: 64, height: 6, depth: 12 },
  { x: 0, y: 66, z: 0 },
  WOOD_COLORS.lightOak,
  TENON_TYPES.rectangular,
  MORTISE_TYPES.throughMortise,
  MATERIALS.fir
);

export const RAFTERS_COMPONENTS: DougongComponent[] = [
  createComponent(
    'rafter-1',
    '檐椽1',
    'Rafter' as ComponentType,
    14,
    { width: 6, height: 8, depth: 48 },
    { x: -24, y: 70, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.blindMortise,
    MATERIALS.fir
  ),
  createComponent(
    'rafter-2',
    '檐椽2',
    'Rafter' as ComponentType,
    15,
    { width: 6, height: 8, depth: 48 },
    { x: -12, y: 70, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.blindMortise,
    MATERIALS.fir
  ),
  createComponent(
    'rafter-3',
    '檐椽3',
    'Rafter' as ComponentType,
    16,
    { width: 6, height: 8, depth: 48 },
    { x: 0, y: 70, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.blindMortise,
    MATERIALS.fir
  ),
  createComponent(
    'rafter-4',
    '檐椽4',
    'Rafter' as ComponentType,
    17,
    { width: 6, height: 8, depth: 48 },
    { x: 12, y: 70, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.blindMortise,
    MATERIALS.fir
  ),
  createComponent(
    'rafter-5',
    '檐椽5',
    'Rafter' as ComponentType,
    18,
    { width: 6, height: 8, depth: 48 },
    { x: 24, y: 70, z: 0 },
    WOOD_COLORS.lightPine,
    TENON_TYPES.halfTenon,
    MORTISE_TYPES.blindMortise,
    MATERIALS.fir
  ),
];

export const SCENE_CONSTANTS = {
  backgroundColor: '#d4c4a8',
  backgroundColorCold: '#8b9a8b',
  groundColor: '#5a3a1a',
  ambientLightIntensity: 0.6,
  directionalLightIntensity: 1.2,
  directionalLightPosition: { x: 10, y: 15, z: 5 },
  minPolarAngle: Math.PI / 6,
  maxPolarAngle: Math.PI / 3,
  snapThreshold: 1,
  errorThreshold: 2,
  disassembleDistance: { min: 3, max: 5 },
  disassembleDuration: 500,
  flyInDuration: 1000,
  snapHighlightDuration: 300,
  errorFlashDuration: 200,
  errorFlashCount: 2,
};

export const ANIMATION_EASING = [0.25, 0.1, 0.25, 1] as [number, number, number, number];
