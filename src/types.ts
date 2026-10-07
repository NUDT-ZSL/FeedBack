export enum WoodType {
  Pine = 'pine',
  Rosewood = 'rosewood',
  Boxwood = 'boxwood',
}

export interface WoodProperties {
  weight: number;
  toughness: number;
  durability: number;
  hardness: number;
}

export const woodProperties: Record<WoodType, WoodProperties> = {
  [WoodType.Pine]: {
    weight: 450,
    toughness: 60,
    durability: 50,
    hardness: 40,
  },
  [WoodType.Rosewood]: {
    weight: 850,
    toughness: 85,
    durability: 90,
    hardness