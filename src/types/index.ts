export type CoinSide = 'zheng' | 'bei';

export type YaoType = 'lao-yang' | 'lao-yin' | 'shao-yang' | 'shao-yin';

export interface YaoResult {
  type: YaoType;
  isMoving: boolean;
  isYang: boolean;
}

export type YaoArray = [YaoResult, YaoResult, YaoResult, YaoResult, YaoResult, YaoResult];

export interface HexagramInfo {
  name: string;
  binary: string;
  decimal: number;
  description: string;
}

export interface HexagramMap {
  [key: string]: HexagramInfo;
}

export interface AnimationParams {
  rotation: number;
  bounce: number;
  duration: number;
}
