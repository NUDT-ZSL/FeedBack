import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataStore, Band, Schedule, Admin } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'festival-data.json');

const initialBands: Band[] = [
  {
    id: 'band-1',
    name: '星光乐队',
    description: '一支来自上海的独立摇滚乐队，成立于2019年，曲风融合英伦摇滚与电子元素。',
    genres: ['摇滚', '独立', '电子'],
    memberCount: 4,
    contact: 'starlight@example.com',
    status: 'approved',
    submittedAt: '2026-06-01T10:00:00Z'
  },
  {
    id: 'band-2',
    name: '午夜回响',
    description: '来自北京的后摇乐队，擅长用器乐讲述故事，现场极具感染力。',
    genres: ['后摇', '器乐'],
    memberCount: 5,
    contact: 'midnight@example.com',
    status: 'approved',
    submittedAt: '2026-06-02T14:30:00Z'
  },
  {
    id: 'band-3',
    name: '霓虹梦境',
    description: 'synth-pop 风格的电子乐队，女主唱嗓音梦幻，编曲复古时髦。',
    genres: ['电子', '流行', '合成器'],
    memberCount: 3,
    contact: 'neon@example.com',
    status: 'pending',
    submittedAt: '2026-06-10T09:15:00Z'
  },
  {
    id: 'band-4',
    name: '旧城故事',
    description: '民谣摇滚乐队，用歌词描绘城市中的人间烟火。',
    genres: ['民谣', '摇滚'],
    memberCount: 4,
    contact: 'oldtown@example.com',
    status: 'pending',
    submittedAt: '2026-06-12T16:45:00Z'
  },
  {
    id: 'band-5',
    name: '深海鲸鱼',
    description: '氛围音乐组合，专注于营造沉浸式听觉体验。',
    genres: ['氛围', '实验'],
    memberCount: 2,
    contact: 'deepsea@example.com',
    status: 'rejected',
    submittedAt: '2026-05-28T11:00:00Z'
  }
];

const initialSchedules: Schedule[] = [
  {
    id: 'sched-1',
    bandId: 'band-1',
    bandName: '星光乐队',
    stage: '主舞台',
    startTime: '2026-07-01T18:00:00',
    endTime: '2026-07-01T19:00:00',
    genres: ['摇滚', '独立', '电子']
  },
  {
    id: 'sched-2',
    bandId: 'band-2',
    bandName: '午夜回响',
    stage: '主舞台',
    startTime: '2026-07-01T20:00:00',
    endTime: '2026-07-01T21:30:00',
    genres: ['后摇', '器乐']
  },
  {
    id: 'sched-3',
    bandId: 'band-1',
    bandName: '星光乐队',
    stage: '副舞台',
    startTime: '2026-07-02T15:00:00',
    endTime: '2026-07-02T16:00:00',
    genres: ['摇滚', '独立', '电子']
  }
];

const initialAdmins: Admin[] = [
  {
    id: 'admin-1',
    username: 'admin',
    passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
  }
];

const defaultData: DataStore = {
  bands: [...initialBands],
  schedules: [...initialSchedules],
  admins: [...initialAdmins]
};

function loadData(): DataStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw) as DataStore;
      if (data.bands && data.schedules && data.admins) {
        return data;
      }
    }
  } catch (e) {
    console.error('读取数据文件失败，使用初始数据:', e);
  }
  return JSON.parse(JSON.stringify(defaultData));
}

function saveData(data: DataStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('写入数据文件失败:', e);
  }
}

export const store: DataStore = loadData();

export function persistStore(): void {
  saveData(store);
}
