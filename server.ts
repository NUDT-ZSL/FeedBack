import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

interface Question {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

interface PlayerScore {
  nickname: string;
  avatar: number;
  score: number;
  timeInSeconds: number;
}

const QUESTIONS_BANK: Omit<Question, 'id'>[] = [
  { question: '世界上最高的山峰是哪一座？', options: ['乔戈里峰', '珠穆朗玛峰', '干城章嘉峰', '洛子峰'], correctIndex: 1 },
  { question: 'HTML代表什么？', options: ['高级文本标记语言', '超文本标记语言', '家庭工具标记语言', '超链接文本标记语言'], correctIndex: 1 },
  { question: '太阳系中最大的行星是？', options: ['地球', '土星', '木星', '海王星'], correctIndex: 2 },
  { question: '水的化学式是？', options: ['CO2', 'H2O', 'O2', 'NaCl'], correctIndex: 1 },
  { question: '谁写了《哈姆雷特》？', options: ['查尔斯·狄更斯', '威廉·莎士比亚', '马克·吐温', '简·奥斯汀'], correctIndex: 1 },
  { question: '光速大约是多少？', options: ['30万公里/秒', '15万公里/秒', '50万公里/秒', '10万公里/秒'], correctIndex: 0 },
  { question: '人体最大的器官是？', options: ['心脏', '肝脏', '皮肤', '大脑'], correctIndex: 2 },
  { question: '一年有多少天（非闰年）？', options: ['364天', '365天', '366天', '367天'], correctIndex: 1 },
  { question: '世界上最大的海洋是？', options: ['大西洋', '印度洋', '太平洋', '北冰洋'], correctIndex: 2 },
  { question: 'JavaScript是什么类型的语言？', options: ['编译型语言', '汇编语言', '解释型语言', '机器语言'], correctIndex: 2 },
  { question: '中国的首都是？', options: ['上海', '北京', '广州', '深圳'], correctIndex: 1 },
  { question: '埃菲尔铁塔位于哪个城市？', options: ['伦敦', '柏林', '巴黎', '罗马'], correctIndex: 2 },
  { question: '地球上有多少个大洲？', options: ['5个', '6个', '7个', '8个'], correctIndex: 2 },
  { question: '电脑的CPU代表什么？', options: ['中央处理器', '随机存取存储器', '只读存储器', '显卡'], correctIndex: 0 },
  { question: '世界上人口最多的国家是？', options: ['美国', '印度', '中国', '印尼'], correctIndex: 1 },
  { question: '彩虹有几种颜色？', options: ['5种', '6种', '7种', '8种'], correctIndex: 2 },
  { question: '月球绕地球一周大约需要多长时间？', options: ['7天', '14天', '28天', '365天'], correctIndex: 2 },
  { question: '光合作用主要发生在植物的哪个部分？', options: ['根部', '茎部', '叶子', '花朵'], correctIndex: 2 },
  { question: '世界上最长的河流是？', options: ['亚马逊河', '尼罗河', '长江', '密西西比河'], correctIndex: 1 },
  { question: 'AI代表什么？', options: ['自动集成', '人工智能', '高级接口', '应用集成'], correctIndex: 1 },
];

let leaderboard: PlayerScore[] = [];

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

app.get('/api/questions', (_req, res) => {
  const selected = shuffleArray(QUESTIONS_BANK)
    .slice(0, 10)
    .map((q, idx) => ({
      ...q,
      id: `q-${Date.now()}-${idx}`
    }));
  res.json(selected);
});

app.post('/api/submit', (req, res) => {
  const { nickname, avatar, score, timeInSeconds } = req.body;

  if (!nickname || typeof score !== 'number' || typeof timeInSeconds !== 'number') {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  const existingIndex = leaderboard.findIndex(p => p.nickname === nickname);

  if (existingIndex >= 0) {
    const existing = leaderboard[existingIndex];
    if (
      score > existing.score ||
      (score === existing.score && timeInSeconds < existing.timeInSeconds)
    ) {
      leaderboard[existingIndex] = {
        nickname,
        avatar: avatar ?? existing.avatar,
        score,
        timeInSeconds
      };
    }
  } else {
    leaderboard.push({
      nickname,
      avatar: avatar ?? 0,
      score,
      timeInSeconds
    });
  }

  leaderboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.timeInSeconds - b.timeInSeconds;
  });

  res.json({ success: true });
});

app.get('/api/leaderboard', (_req, res) => {
  const top10 = leaderboard.slice(0, 10);
  res.json(top10);
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
