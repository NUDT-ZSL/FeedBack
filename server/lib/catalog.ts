import fs from 'fs';
import path from 'path';
import { Catalog } from './types';

export const DEFAULT_CATALOG: Catalog = {
  fillings: [
    {
      id: '1',
      name: '红豆沙',
      description: '江南红豆，细腻香甜',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=red%20bean%20paste%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '2',
      name: '莲蓉',
      description: '莲子清香，入口即化',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=lotus%20seed%20paste%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '3',
      name: '芝麻',
      description: '黑芝麻香，营养丰富',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=black%20sesame%20paste%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '4',
      name: '桂花',
      description: '金秋桂花，香气四溢',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=osmanthus%20flower%20jam%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '5',
      name: '枣泥',
      description: '红枣滋养，甜而不腻',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=red%20date%20paste%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '6',
      name: '抹茶',
      description: '日式抹茶，清香回甘',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=matcha%20green%20tea%20paste%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '7',
      name: '芒果',
      description: '热带芒果，鲜甜多汁',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=mango%20jam%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '8',
      name: '榴莲',
      description: '猫山王榴莲，香浓醇厚',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=durian%20paste%20close%20up%20macro%20food%20photography&image_size=square',
    },
    {
      id: '9',
      name: '巧克力',
      description: '比利时巧克力，丝滑浓郁',
      image:
        'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=chocolate%20ganache%20close%20up%20macro%20food%20photography&image_size=square',
    },
  ],
  molds: [
    { id: '1', name: '圆形', shape: 'circle', capacity: 3 },
    { id: '2', name: '方形', shape: 'square', capacity: 3 },
    { id: '3', name: '梅花形', shape: 'plum', capacity: 2 },
    { id: '4', name: '扇形', shape: 'fan', capacity: 1 },
    { id: '5', name: '寿桃形', shape: 'peach', capacity: 2 },
    { id: '6', name: '动物形', shape: 'animal', capacity: 1 },
  ],
};

export function catalogPath(dataDir: string): string {
  return path.join(dataDir, 'catalog.json');
}

export function getCatalog(dataDir: string): Catalog {
  const file = catalogPath(dataDir);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CATALOG, null, 2), 'utf-8');
    return DEFAULT_CATALOG;
  }
  const catalog: Catalog = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(catalog.fillings) || !Array.isArray(catalog.molds)) {
    throw new Error('catalog data is malformed');
  }
  return catalog;
}

export function saveCatalog(dataDir: string, catalog: Catalog): void {
  fs.writeFileSync(catalogPath(dataDir), JSON.stringify(catalog, null, 2), 'utf-8');
}
