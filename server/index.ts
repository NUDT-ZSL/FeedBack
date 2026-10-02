import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { TeaPattern, GalleryItem } from '../src/types';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const patterns: TeaPattern[] = [
  {
    id: 'pine_crane',
    type: 'pine_crane',
    name: '松鹤延年',
    poem: '亭亭山上松，瑟瑟谷中风。\n风声一何盛，松枝一何劲。',
    paths: [
      { points: [[20, 80], [25, 60], [22, 50], [28, 45], [25, 40], [30, 35], [28, 30]], strokeWidth: 3 },
      { points: [[30, 35], [35, 40], [40, 38], [45, 42], [50, 40]], strokeWidth: 2 },
      { points: [[50, 60], [55, 50], [60, 45], [58, 40], [65, 35], [70, 38], [75, 35]], strokeWidth: 3 },
      { points: [[60, 55], [65, 58], [70, 55], [72, 50], [68, 48], [65, 50]], strokeWidth: 2 },
      { points: [[50, 50], [52, 45], [48, 42], [45, 45], [47, 48]], strokeWidth: 1.5 },
    ]
  },
  {
    id: 'butterflies',
    type: 'butterflies',
    name: '双蝶戏花',
    poem: '庄生晓梦迷蝴蝶，望帝春心托杜鹃。\n沧海月明珠有泪，蓝田日暖玉生烟。',
    paths: [
      { points: [[30, 50], [35, 40], [45, 38], [50, 45], [48, 55], [40, 60], [32, 58], [30, 50]], strokeWidth: 2 },
      { points: [[30, 50], [35, 55], [40, 58], [45, 55], [48, 48], [45, 42], [38, 40], [32, 45], [30, 50]], strokeWidth: 2 },
      { points: [[50, 45], [55, 48], [58, 52], [55, 56], [50, 55], [48, 50], [50, 45]], strokeWidth: 1.5 },
      { points: [[55, 55], [60, 50], [65, 52], [68, 58], [65, 62], [60, 60], [57, 56], [55, 55]], strokeWidth: 2 },
      { points: [[55, 55], [58, 60], [62, 62], [65, 58], [63, 54], [58, 52], [55, 55]], strokeWidth: 2 },
      { points: [[40, 50], [42, 52], [45, 50], [43, 48], [40, 50]], strokeWidth: 1 },
      { points: [[58, 56], [60, 58], [62, 56], [60, 54], [58, 56]], strokeWidth: 1 },
    ]
  },
  {
    id: 'landscape',
    type: 'landscape',
    name: '山水清远',
    poem: '空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。',
    paths: [
      { points: [[10, 70], [20, 50], [30, 60], [40, 45], [50, 55], [60, 40], [70, 50], [80, 35], [90, 45], [95, 55]], strokeWidth: 2 },
      { points: [[10, 75], [25, 72], [40, 74], [55, 70], [70, 73], [85, 68], [95, 72]], strokeWidth: 1.5 },
      { points: [[30, 45], [35, 35], [40, 40], [45, 30], [50, 35], [55, 28], [60, 32]], strokeWidth: 1.5 },
      { points: [[20, 55], [25, 50], [30, 52], [35, 48]], strokeWidth: 1 },
      { points: [[65, 45], [70, 40], [75, 42], [80, 38]], strokeWidth: 1 },
      { points: [[45, 60], [50, 55], [55, 58], [60, 52], [65, 55]], strokeWidth: 2 },
    ]
  },
  {
    id: 'orchid_bamboo',
    type: 'orchid_bamboo',
    name: '兰竹清韵',
    poem: '咬定青山不放松，立根原在破岩中。\n千磨万击还坚劲，任尔东西南北风。',
    paths: [
      { points: [[25, 80], [28, 60], [30, 45], [32, 35], [35, 25]], strokeWidth: 3 },
      { points: [[30, 60], [25, 55], [22, 50], [20, 45], [18, 40]], strokeWidth: 2 },
      { points: [[30, 50], [35, 45], [40, 48], [45, 42], [50, 45]], strokeWidth: 2 },
      { points: [[55, 75], [58, 65], [62, 58], [65, 50], [68, 45]], strokeWidth: 3 },
      { points: [[62, 58], [68, 55], [72, 52], [75, 48]], strokeWidth: 2 },
      { points: [[58, 65], [52, 62], [48, 58], [45, 55]], strokeWidth: 2 },
      { points: [[20, 40], [18, 35], [22, 32], [25, 35], [23, 38]], strokeWidth: 1.5 },
      { points: [[45, 42], [43, 38], [47, 35], [50, 38], [48, 41]], strokeWidth: 1.5 },
    ]
  },
];

let galleryStore: GalleryItem[] = [];

app.get('/api/patterns/random', (_req: Request, _res: Response) => {
  const randomIndex = Math.floor(Math.random() * patterns.length);
  const pattern = { ...patterns[randomIndex], id: uuidv4() };
  res.json(pattern);
});

app.get('/api/patterns', (_req: Request, _res: Response) => {
  res.json(patterns);
});

app.post('/api/gallery', (req: Request, res: Response) => {
  try {
    const item = req.body as Omit<GalleryItem, 'id' | 'createdAt'>;
    const newItem: GalleryItem = {
      ...item,
      id: uuidv4(),
      createdAt: Date.now(),
    };
    galleryStore = [newItem, ...galleryStore].slice(0, 20);
    res.json(newItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save gallery item' });
  }
});

app.get('/api/gallery', (_req: Request, res: Response) => {
  res.json(galleryStore);
});

app.delete('/api/gallery/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const initialLength = galleryStore.length;
  galleryStore = galleryStore.filter(item => item.id !== id);
  if (galleryStore.length < initialLength) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Item not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Tea competition server running on port ${PORT}`);
});
