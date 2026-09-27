import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

let events = [
  {
    id: uuidv4(),
    date: '2024-03-15',
    location: '西湖',
    country: '中国',
    description: '清晨漫步西湖断桥，烟雨中的江南水乡如诗如画。品尝了楼外楼的东坡肉和西湖醋鱼，正宗的杭帮菜让人回味无穷。傍晚在雷峰塔上俯瞰整个西湖的落日余晖，金色洒在湖面上美得令人窒息。',
    tags: ['风景', '美食'],
    images: [
      'https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=800',
      'https://images.unsplash.com/photo-1599571234909-29ed5d1321d6?w=800',
    ],
  },
  {
    id: uuidv4(),
    date: '2024-07-22',
    location: '京都清水寺',
    country: '日本',
    description: '夏日的京都，漫步在祗园的花见小路，偶遇一位优雅的艺妓。清水寺的木质舞台俯瞰整个京都城，周围郁郁葱葱的古树映衬着朱红的建筑。夜晚在先斗町的川床享用怀石料理，听着鸭川的潺潺流水。',
    tags: ['人文', '风景'],
    images: [
      'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800',
      'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800',
      'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800',
    ],
  },
  {
    id: uuidv4(),
    date: '2023-12-25',
    location: '北海道小樽',
    country: '日本',
    description: '白色圣诞节的小樽运河，雪灯祭的点点烛火在雪夜中摇曳。玻璃工房里亲手制作了一个音乐盒作为纪念。海鲜市场的海胆饭鲜甜无比，滑雪场上摔了无数次却笑得很开心。温泉旅馆的露天风吕，看着雪花飘落泡在汤里，此生难忘。',
    tags: ['风景', '美食', '人文'],
    images: [
      'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800',
      'https://images.unsplash.com/photo-1491002052546-bf38f186af56?w=800',
    ],
  },
  {
    id: uuidv4(),
    date: '2025-01-10',
    location: '冰岛雷克雅未克',
    country: '冰岛',
    description: '世界尽头的极光之旅！黑沙滩上玄武岩柱如同巨人的风琴，杰古沙龙冰河湖里漂浮的蓝色冰块像钻石一样闪耀。最激动的是在郊外看到了漫天舞动的绿色极光，那一刻所有的寒冷和等待都值得了。',
    tags: ['风景'],
    images: [
      'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=800',
      'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800',
    ],
  },
  {
    id: uuidv4(),
    date: '2024-10-01',
    location: '成都宽窄巷子',
    country: '中国',
    description: '天府之国的美食之旅！从早上的龙抄手担担面开始，中午的麻辣火锅让人欲罢不能，晚上的串串香配着唯怡豆奶。在人民公园的鹤鸣茶社喝了盖碗茶，掏耳朵的师傅手法娴熟。熊猫基地的滚滚们太可爱了，抱着竹子啃得津津有味。',
    tags: ['美食', '人文'],
    images: [
      'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800',
      'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800',
    ],
  },
];

app.get('/api/events', (_req, res) => {
  const sorted = [...events].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(sorted);
});

app.post('/api/events', (req, res) => {
  const { date, location, country, description, tags, images } = req.body;
  if (!date || !location || !country || !description) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  const newEvent = {
    id: uuidv4(),
    date,
    location,
    country,
    description,
    tags: tags || [],
    images: (images || []).slice(0, 3),
  };
  events.push(newEvent);
  res.status(201).json(newEvent);
});

app.get('/api/events/filter', (req, res) => {
  const { year, country, tag } = req.query;
  let filtered = [...events];
  if (year) {
    filtered = filtered.filter((e) => e.date.startsWith(String(year)));
  }
  if (country && country !== '') {
    filtered = filtered.filter((e) => e.country === String(country));
  }
  if (tag && tag !== '') {
    filtered = filtered.filter((e) => e.tags.includes(String(tag)));
  }
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(filtered);
});

app.post('/api/export', (req, res) => {
  const { ids } = req.body;
  let selected = ids && ids.length > 0 ? events.filter((e) => ids.includes(e.id)) : events;
  selected = [...selected].sort((a, b) => new Date(a.date) - new Date(b.date));
  const dateStr = new Date().toISOString().slice(0, 10);
  let markdown = `# 我的旅行记忆\n\n导出日期：${dateStr}\n\n---\n\n`;
  selected.forEach((e, idx) => {
    markdown += `## ${idx + 1}. ${e.location}\n\n`;
    markdown += `**时间**：${e.date}\n\n`;
    markdown += `**地点**：${e.country} · ${e.location}\n\n`;
    markdown += `**标签**：${e.tags.map((t) => '#' + t).join(' ')}\n\n`;
    markdown += `### 描述\n\n${e.description}\n\n`;
    if (e.images && e.images.length > 0) {
      markdown += `### 照片\n\n`;
      e.images.forEach((img, i) => {
        markdown += `![${e.location}-${i + 1}](${img})\n\n`;
      });
    }
    markdown += `---\n\n`;
  });
  res.json({
    markdown,
    filename: `旅行记忆_${dateStr}.md`,
  });
});

app.listen(PORT, () => {
  console.log(`Travel Timeline API server running at http://localhost:${PORT}`);
});
