import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

const petsMap = new Map();
const diariesMap = new Map();

const seedPets = [
  {
    id: 'pet-1',
    name: '咪咪',
    species: 'cat',
    breed: '英短蓝猫',
    age: 2,
    gender: 'female',
    avatar: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute%20british%20shorthair%20blue%20cat%20portrait&image_size=square',
    status: 'home',
    createdAt: new Date().toISOString()
  },
  {
    id: 'pet-2',
    name: '旺财',
    species: 'dog',
    breed: '金毛寻回犬',
    age: 3,
    gender: 'male',
    avatar: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=golden%20retriever%20dog%20portrait%20happy&image_size=square',
    status: 'fostering',
    createdAt: new Date().toISOString()
  },
  {
    id: 'pet-3',
    name: '雪球',
    species: 'rabbit',
    breed: '荷兰垂耳兔',
    age: 1,
    gender: 'female',
    avatar: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute%20holland%20lop%20rabbit%20white%20fluffy&image_size=square',
    status: 'home',
    createdAt: new Date().toISOString()
  }
];

const seedDiaries = [
  {
    id: 'diary-1',
    petId: 'pet-1',
    petName: '咪咪',
    images: [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cat%20eating%20food%20bowl%20cozy%20home&image_size=square_hd'
    ],
    content: '今天咪咪吃得很香，猫粮全部吃光了。下午在阳台晒了一会儿太阳，精神很好，没有异常。',
    mood: 'happy',
    likes: 12,
    liked: false,
    comments: [
      { id: 'c-1', username: '邻居小王', content: '咪咪好可爱！', createdAt: new Date(Date.now() - 3600000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: 'diary-2',
    petId: 'pet-2',
    petName: '旺财',
    images: [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=golden%20retriever%20walking%20in%20park%20sunny&image_size=square_hd',
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=happy%20dog%20playing%20with%20ball&image_size=square_hd'
    ],
    content: '早上带旺财去公园遛了一个小时，玩得特别开心，追着球跑了好久。回家喝了一大盆水。',
    mood: 'playful',
    likes: 25,
    liked: false,
    comments: [],
    createdAt: new Date(Date.now() - 14400000).toISOString()
  },
  {
    id: 'diary-3',
    petId: 'pet-3',
    petName: '雪球',
    images: [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute%20rabbit%20sleeping%20cozy%20bedding&image_size=square_hd'
    ],
    content: '雪球今天大部分时间都在打盹，喂了一些胡萝卜和提摩西草，吃得不多但还算正常。',
    mood: 'sleepy',
    likes: 8,
    liked: false,
    comments: [
      { id: 'c-2', username: '兔妈', content: '垂耳兔就是爱睡觉~', createdAt: new Date(Date.now() - 1800000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 21600000).toISOString()
  },
  {
    id: 'diary-4',
    petId: 'pet-2',
    petName: '旺财',
    images: [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=dog%20resting%20on%20couch%20relaxed&image_size=square_hd'
    ],
    content: '今天旺财有点没精神，狗粮只吃了一半，可能是天气太热了。晚上再观察一下。',
    mood: 'normal',
    likes: 5,
    liked: false,
    comments: [],
    createdAt: new Date(Date.now() - 28800000).toISOString()
  },
  {
    id: 'diary-5',
    petId: 'pet-1',
    petName: '咪咪',
    images: [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=sick%20cat%20at%20vet%20clinic%20worried&image_size=square_hd'
    ],
    content: '咪咪今天有点呕吐，带去医院看了，医生说可能是毛球症，开了化毛膏。需要观察两天。',
    mood: 'sick',
    likes: 15,
    liked: false,
    comments: [
      { id: 'c-3', username: '猫奴小李', content: '希望咪咪快点好起来！', createdAt: new Date(Date.now() - 5400000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 36000000).toISOString()
  },
  {
    id: 'diary-6',
    petId: 'pet-1',
    petName: '咪咪',
    images: [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cat%20playing%20with%20yarn%20ball&image_size=square_hd'
    ],
    content: '咪咪已经完全康复了！今天追着毛线球玩了好久，食欲也恢复了，又变成那个活泼的小猫咪了。',
    mood: 'happy',
    likes: 30,
    liked: false,
    comments: [
      { id: 'c-4', username: '@邻居小王', content: '太好了！', createdAt: new Date(Date.now() - 900000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 43200000).toISOString()
  }
];

seedPets.forEach(pet => petsMap.set(pet.id, pet));
seedDiaries.forEach(diary => diariesMap.set(diary.id, diary));

app.get('/api/pets', (req, res) => {
  try {
    const pets = Array.from(petsMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({ data: pets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pets', upload.single('avatar'), (req, res) => {
  try {
    const { name, species, breed, age, gender } = req.body;
    let avatar = req.file ? `/uploads/${req.file.filename}` : '';
    
    if (!avatar) {
      const prompts = {
        cat: 'cute%20cat%20portrait%20fluffy',
        dog: 'cute%20dog%20portrait%20friendly',
        rabbit: 'cute%20rabbit%20portrait%20fluffy',
        other: 'cute%20pet%20portrait%20adorable'
      };
      avatar = `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${prompts[species] || prompts.other}&image_size=square`;
    }

    const pet = {
      id: 'pet-' + Date.now(),
      name,
      species,
      breed,
      age: parseInt(age),
      gender,
      avatar,
      status: 'home',
      createdAt: new Date().toISOString()
    };
    
    petsMap.set(pet.id, pet);
    res.json({ data: pet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/pets/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const pet = petsMap.get(id);
    
    if (!pet) {
      return res.status(404).json({ error: '宠物不存在' });
    }
    
    pet.status = status;
    petsMap.set(id, pet);
    res.json({ data: pet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pets/:id/diaries', (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const diaries = Array.from(diariesMap.values())
      .filter(d => d.petId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    
    res.json({ data: diaries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pets/:id', (req, res) => {
  try {
    const { id } = req.params;
    const pet = petsMap.get(id);
    
    if (!pet) {
      return res.status(404).json({ error: '宠物不存在' });
    }
    
    res.json({ data: pet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/diaries', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    
    const allDiaries = Array.from(diariesMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    const total = allDiaries.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const data = allDiaries.slice(startIndex, endIndex);
    const hasMore = endIndex < total;
    
    res.json({ data, hasMore, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diaries', upload.array('images', 3), (req, res) => {
  try {
    const { petId, petName, content, mood } = req.body;
    const images = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
    
    const diary = {
      id: 'diary-' + Date.now(),
      petId,
      petName,
      images,
      content,
      mood,
      likes: 0,
      liked: false,
      comments: [],
      createdAt: new Date().toISOString()
    };
    
    diariesMap.set(diary.id, diary);
    res.json({ data: diary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/community/diaries', (req, res) => {
  try {
    const { breed, mood } = req.query;
    
    let diaries = Array.from(diariesMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    if (breed && breed !== 'all') {
      const petIds = Array.from(petsMap.values())
        .filter(p => p.breed === breed || p.species === breed)
        .map(p => p.id);
      diaries = diaries.filter(d => petIds.includes(d.petId));
    }
    
    if (mood && mood !== 'all') {
      diaries = diaries.filter(d => d.mood === mood);
    }
    
    res.json({ data: diaries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diaries/:id/like', (req, res) => {
  try {
    const { id } = req.params;
    const diary = diariesMap.get(id);
    
    if (!diary) {
      return res.status(404).json({ error: '日记不存在' });
    }
    
    diary.liked = !diary.liked;
    diary.likes += diary.liked ? 1 : -1;
    diariesMap.set(id, diary);
    
    res.json({ data: { likes: diary.likes, liked: diary.liked } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diaries/:id/comment', (req, res) => {
  try {
    const { id } = req.params;
    const { username, content } = req.body;
    const diary = diariesMap.get(id);
    
    if (!diary) {
      return res.status(404).json({ error: '日记不存在' });
    }
    
    const comment = {
      id: 'comment-' + Date.now(),
      username,
      content,
      createdAt: new Date().toISOString()
    };
    
    diary.comments.push(comment);
    diariesMap.set(id, diary);
    
    res.json({ data: comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🐾 宠物寄养日记服务器运行在 http://localhost:${PORT}`);
  console.log(`📦 已加载 ${petsMap.size} 只宠物，${diariesMap.size} 篇日记`);
});
