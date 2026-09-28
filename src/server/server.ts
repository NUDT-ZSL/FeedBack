import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

interface Comment {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}

interface Work {
  id: string;
  artistId: string;
  title: string;
  series: string;
  scale: string;
  material: string;
  images: string[];
  story: string;
  forSale: boolean;
  likes: number;
  comments: Comment[];
  heat: number;
}

interface Exhibition {
  id: string;
  curatorId: string;
  title: string;
  coverImage: string;
  description: string;
  startDate: string;
  endDate: string;
  maxWorks: number;
  workIds: string[];
}

interface Artist {
  id: string;
  name: string;
  avatar: string;
  role: 'artist' | 'curator';
}

const artists: Artist[] = [
  { id: 'a1', name: '林墨山', avatar: 'https://picsum.photos/seed/a1/200/200', role: 'artist' },
  { id: 'a2', name: '陈锈', avatar: 'https://picsum.photos/seed/a2/200/200', role: 'curator' },
  { id: 'a3', name: '叶青鸢', avatar: 'https://picsum.photos/seed/a3/200/200', role: 'artist' },
];

const works: Work[] = [
  {
    id: 'w1',
    artistId: 'a1',
    title: '崩塌的教堂',
    series: '末日废墟系列',
    scale: '1:35',
    material: '树脂、石膏、铜丝',
    images: [
      'https://picsum.photos/seed/w1a/600/400',
      'https://picsum.photos/seed/w1b/600/400',
      'https://picsum.photos/seed/w1c/600/400',
    ],
    story: '这座教堂曾是一座城市的信仰中心，末日来临时尖顶率先折断，彩绘玻璃碎裂如雨。林墨山用0.3mm铜丝模拟了断裂的钢筋骨架，每一块碎石都经过手工打磨，还原了重力牵引下的自然裂纹。窗框上残留的玫瑰窗碎片，是整件作品中最脆弱也最动人的部分。',
    forSale: true,
    likes: 42,
    comments: [
      { id: 'c1', userId: 'a3', content: '彩绘玻璃的碎片处理得太精妙了，仿佛能听到碎裂的声音', createdAt: '2025-03-15T10:30:00Z' },
      { id: 'c2', userId: 'a2', content: '铜丝骨架的张力表现极佳', createdAt: '2025-03-16T14:20:00Z' },
    ],
    heat: 46,
  },
  {
    id: 'w2',
    artistId: 'a3',
    title: '荒芜站台',
    series: '末日废墟系列',
    scale: '1:24',
    material: '木质、亚克力、铁锈漆',
    images: [
      'https://picsum.photos/seed/w2a/600/400',
      'https://picsum.photos/seed/w2b/600/400',
    ],
    story: '最后一班列车驶离后，站台再没有等来归人。叶青鸢用真实的铁锈漆让月台栏杆呈现氧化质感，站牌上的站名已经模糊不清。长椅上落满灰尘，一只被遗忘的行李箱半开着，里面空无一物。这是整个系列中最安静的一件作品。',
    forSale: false,
    likes: 38,
    comments: [
      { id: 'c3', userId: 'a1', content: '行李箱的细节让人心酸，空无一物比满载更沉重', createdAt: '2025-03-18T09:15:00Z' },
    ],
    heat: 40,
  },
  {
    id: 'w3',
    artistId: 'a1',
    title: '断裂的高架桥',
    series: '末日废墟系列',
    scale: '1:48',
    material: '树脂、水泥、LED微光',
    images: [
      'https://picsum.photos/seed/w3a/600/400',
      'https://picsum.photos/seed/w3b/600/400',
      'https://picsum.photos/seed/w3c/600/400',
    ],
    story: '高架桥从中间断裂，截面露出层层钢筋。林墨山在桥体内部嵌入LED微光，模拟末日前最后的电力闪烁。桥面上还停着一辆生锈的微型汽车，车门半开，仿佛司机刚刚逃离。桥下散落着从桥面坠落的混凝土碎块，苔藓已开始在缝隙中蔓延。',
    forSale: true,
    likes: 55,
    comments: [
      { id: 'c4', userId: 'a2', content: 'LED闪烁的效果让人感受到最后一线生机的消逝', createdAt: '2025-03-20T16:45:00Z' },
      { id: 'c5', userId: 'a3', content: '苔藓的蔓延预示着自然对文明的重新接管', createdAt: '2025-03-21T11:00:00Z' },
    ],
    heat: 59,
  },
  {
    id: 'w4',
    artistId: 'a2',
    title: '蒸汽研磨机',
    series: '蒸汽朋克系列',
    scale: '1:12',
    material: '黄铜、紫铜管、微型齿轮组',
    images: [
      'https://picsum.photos/seed/w4a/600/400',
      'https://picsum.photos/seed/w4b/600/400',
      'https://picsum.photos/seed/w4c/600/400',
    ],
    story: '陈锈亲手打磨了128个微型齿轮，每个齿轮直径仅2mm，咬合精度达到0.05mm。蒸汽研磨机是这家咖啡馆的核心设备，据说能将咖啡豆研磨至分子级别。黄铜锅炉上刻着晦涩的炼金术符号，蒸汽从紫铜管道中缓缓溢出。这是一件可以实际运转的机械模型。',
    forSale: true,
    likes: 67,
    comments: [
      { id: 'c6', userId: 'a1', content: '128个齿轮的咬合堪称奇迹，这才是真正的匠心', createdAt: '2025-04-02T13:30:00Z' },
    ],
    heat: 69,
  },
  {
    id: 'w5',
    artistId: 'a3',
    title: '气压传送装置',
    series: '蒸汽朋克系列',
    scale: '1:18',
    material: '紫铜、玻璃管、皮革',
    images: [
      'https://picsum.photos/seed/w5a/600/400',
      'https://picsum.photos/seed/w5b/600/400',
    ],
    story: '咖啡豆通过这组气压管道从仓库传送到研磨机，全程不接触人力。叶青鸢用吹制玻璃管模拟透明的输送管道，可以看到内部的微型咖啡豆在气压推动下滑行。皮革密封圈经过老化处理，呈现出常年的使用痕迹。管道交汇处有手动阀门，黄铜标牌上写着"严禁超压"。',
    forSale: false,
    likes: 31,
    comments: [
      { id: 'c7', userId: 'a2', content: '玻璃管内的微缩咖啡豆太有趣了，细节满分', createdAt: '2025-04-05T15:10:00Z' },
      { id: 'c8', userId: 'a1', content: '皮革密封圈的老化处理非常真实', createdAt: '2025-04-06T09:45:00Z' },
    ],
    heat: 35,
  },
  {
    id: 'w6',
    artistId: 'a2',
    title: '黄铜吧台',
    series: '蒸汽朋克系列',
    scale: '1:16',
    material: '黄铜、胡桃木、微型霓虹管',
    images: [
      'https://picsum.photos/seed/w6a/600/400',
      'https://picsum.photos/seed/w6b/600/400',
      'https://picsum.photos/seed/w6c/600/400',
    ],
    story: '吧台是整间咖啡馆的灵魂所在。胡桃木台面下藏着蒸汽管道网络，黄铜装饰件上镶嵌着微型压力表。陈锈在吧台后方的酒架上安装了微型霓虹管，暖橘色的光芒透过各色瓶身折射出迷离的光晕。吧台上的手冲壶和量杯都是可以取下的独立配件，每一件都经过抛光处理。',
    forSale: true,
    likes: 48,
    comments: [],
    heat: 48,
  },
];

const exhibitions: Exhibition[] = [
  {
    id: 'e1',
    curatorId: 'a2',
    title: '末日废墟',
    coverImage: 'https://picsum.photos/seed/e1cover/800/400',
    description: '当文明的光芒熄灭，废墟中只剩下风的低语。林墨山与叶青鸢联手打造的三件微缩模型，将末世之后的荒凉与诗意凝固在方寸之间。每一块碎石、每一缕锈迹，都在诉说着消逝的故事。',
    startDate: '2025-03-01',
    endDate: '2025-06-30',
    maxWorks: 10,
    workIds: ['w1', 'w2', 'w3'],
  },
  {
    id: 'e2',
    curatorId: 'a2',
    title: '蒸汽朋克咖啡馆',
    coverImage: 'https://picsum.photos/seed/e2cover/800/400',
    description: '齿轮转动，蒸汽升腾。陈锈构想了一间存在于平行维度的蒸汽朋克咖啡馆，三件精密微缩模型共同构建了这个充满机械美学与咖啡香气的幻想空间。每件作品都可以实际运转或互动，是工艺与想象力的极致融合。',
    startDate: '2025-04-01',
    endDate: '2025-09-30',
    maxWorks: 8,
    workIds: ['w4', 'w5', 'w6'],
  },
];

const TOKEN_USER_MAP: Record<string, string> = {
  'token-a1': 'a1',
  'token-a2': 'a2',
  'token-a3': 'a3',
};

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未授权，请先登录' });
    return;
  }
  const token = authHeader.slice(7);
  const userId = TOKEN_USER_MAP[token];
  if (!userId) {
    res.status(401).json({ error: 'Token 无效' });
    return;
  }
  (req as express.Request & { userId?: string }).userId = userId;
  next();
}

function getUserId(req: express.Request): string | undefined {
  return (req as express.Request & { userId?: string }).userId;
}

const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/auth/login', (req, res) => {
  try {
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: '缺少 userId' });
      return;
    }
    const artist = artists.find((a) => a.id === userId);
    if (!artist) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    res.json({ token: `token-${userId}`, user: artist });
  } catch (err) {
    res.status(500).json({ error: '登录失败' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const artist = artists.find((a) => a.id === userId);
    if (!artist) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    res.json(artist);
  } catch (err) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

app.get('/api/exhibitions', (_req, res) => {
  try {
    const result = exhibitions.map((ex) => ({
      ...ex,
      workCount: ex.workIds.length,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exhibitions' });
  }
});

app.post('/api/exhibitions', authMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const artist = artists.find((a) => a.id === userId);
    if (!artist || artist.role !== 'curator') {
      res.status(403).json({ error: '仅策展人可以创建展览' });
      return;
    }
    const { curatorId, title, coverImage, description, startDate, endDate, maxWorks, workIds } = req.body;
    const exhibition: Exhibition = {
      id: uuidv4(),
      curatorId,
      title,
      coverImage,
      description,
      startDate,
      endDate,
      maxWorks,
      workIds: workIds ?? [],
    };
    exhibitions.push(exhibition);
    res.status(201).json(exhibition);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create exhibition' });
  }
});

app.get('/api/exhibitions/:id', (req, res) => {
  try {
    const exhibition = exhibitions.find((ex) => ex.id === req.params.id);
    if (!exhibition) {
      res.status(404).json({ error: 'Exhibition not found' });
      return;
    }
    const exhibitionWorks = exhibition.workIds
      .map((wid) => works.find((w) => w.id === wid))
      .filter((w): w is Work => w !== undefined);
    res.json({ ...exhibition, works: exhibitionWorks, workCount: exhibition.workIds.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exhibition' });
  }
});

app.put('/api/exhibitions/:id/order', authMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const exhibition = exhibitions.find((ex) => ex.id === req.params.id);
    if (!exhibition) {
      res.status(404).json({ error: 'Exhibition not found' });
      return;
    }
    if (exhibition.curatorId !== userId) {
      res.status(403).json({ error: '仅该展览的策展人可以修改作品顺序' });
      return;
    }
    const { workIds } = req.body as { workIds: string[] };
    exhibition.workIds = workIds;
    res.json(exhibition);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update exhibition order' });
  }
});

app.post('/api/works', authMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const { artistId, title, series, scale, material, images, story, forSale } = req.body;
    const work: Work = {
      id: uuidv4(),
      artistId: artistId ?? userId,
      title,
      series,
      scale,
      material,
      images,
      story,
      forSale,
      likes: 0,
      comments: [],
      heat: 0,
    };
    works.push(work);
    res.status(201).json(work);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create work' });
  }
});

app.get('/api/works/:id', (req, res) => {
  try {
    const work = works.find((w) => w.id === req.params.id);
    if (!work) {
      res.status(404).json({ error: 'Work not found' });
      return;
    }
    res.json(work);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch work' });
  }
});

app.post('/api/works/:id/like', authMiddleware, (req, res) => {
  try {
    const work = works.find((w) => w.id === req.params.id);
    if (!work) {
      res.status(404).json({ error: 'Work not found' });
      return;
    }
    work.likes += 1;
    work.heat = work.likes + work.comments.length * 2;
    res.json(work);
  } catch (err) {
    res.status(500).json({ error: 'Failed to like work' });
  }
});

app.post('/api/works/:id/comment', authMiddleware, (req, res) => {
  try {
    const work = works.find((w) => w.id === req.params.id);
    if (!work) {
      res.status(404).json({ error: 'Work not found' });
      return;
    }
    const userId = getUserId(req);
    const { content } = req.body as { content: string };
    const comment: Comment = {
      id: uuidv4(),
      userId: userId!,
      content,
      createdAt: new Date().toISOString(),
    };
    work.comments.push(comment);
    work.heat = work.likes + work.comments.length * 2;
    res.status(201).json(work);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

app.get('/api/artists', (_req, res) => {
  try {
    res.json(artists);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

app.listen(3001, () => {
  console.log('Server running on http://localhost:3001');
});
