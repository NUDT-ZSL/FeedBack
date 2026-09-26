import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const productConfig = {
  productName: 'Explorer',
  colors: [
    { id: 'dark-gray', name: '深灰', hex: '#333333' },
    { id: 'midnight-blue', name: '午夜蓝', hex: '#1B3A5C' },
    { id: 'forest-green', name: '森林绿', hex: '#2D5A3D' },
    { id: 'crimson-red', name: '绯红', hex: '#8B2500' },
    { id: 'silver', name: '银色', hex: '#C0C0C0' },
    { id: 'tech-blue', name: '科技蓝', hex: '#4A90D9' },
  ],
  materials: [
    { id: 'metallic', name: '金属', roughness: 0.35, metalness: 0.9 },
    { id: 'glossy', name: '光亮', roughness: 0.1, metalness: 0.6 },
    { id: 'matte', name: '哑光', roughness: 0.8, metalness: 0.1 },
  ],
  accessories: [
    {
      id: 'standard',
      name: '标准款',
      components: [],
    },
    {
      id: 'deluxe',
      name: '豪华款',
      components: [
        {
          type: 'rim' as const,
          geometry: 'torus' as const,
          position: [0, 0.6, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        },
      ],
    },
    {
      id: 'sport',
      name: '运动款',
      components: [
        {
          type: 'spoiler' as const,
          geometry: 'box' as const,
          position: [0, 1.8, -0.5] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
        },
        {
          type: 'wing' as const,
          geometry: 'box' as const,
          position: [-0.8, 1.5, -0.3] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          rotation: [0, 0, 0.2] as [number, number, number],
        },
        {
          type: 'wing' as const,
          geometry: 'box' as const,
          position: [0.8, 1.5, -0.3] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          rotation: [0, 0, -0.2] as [number, number, number],
        },
      ],
    },
  ],
  defaultConfig: {
    colorId: 'dark-gray',
    materialId: 'metallic',
    accessoryId: 'standard',
  },
};

app.get('/api/product-config', (_req, res) => {
  setTimeout(() => {
    res.json(productConfig);
  }, 500);
});

app.listen(PORT, () => {
  console.log(`Mock API server running at http://localhost:${PORT}`);
});
