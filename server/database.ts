import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.join(projectRoot, 'theater.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS actors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    main_role TEXT NOT NULL CHECK (main_role IN ('生', '旦', '净', '末', '丑')),
    secondary_roles TEXT,
    voice INTEGER NOT NULL CHECK (voice BETWEEN 1 AND 100),
    posture INTEGER NOT NULL CHECK (posture BETWEEN 1 AND 100),
    skill INTEGER NOT NULL CHECK (skill BETWEEN 1 AND 100),
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playbills (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    structure TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    playbill_id TEXT NOT NULL,
    name TEXT NOT NULL,
    character_type TEXT NOT NULL CHECK (character_type IN ('生', '旦', '净', '末', '丑')),
    color TEXT,
    actor_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playbill_id) REFERENCES playbills (id),
    FOREIGN KEY (actor_id) REFERENCES actors (id)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    playbill_id TEXT NOT NULL,
    duration INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playbill_id) REFERENCES playbills (id)
  );

  CREATE TABLE IF NOT EXISTS schedule_roles (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    card_pattern TEXT CHECK (card_pattern IN ('龙', '凤', '牡丹', '祥云')),
    FOREIGN KEY (schedule_id) REFERENCES schedules (id),
    FOREIGN KEY (role_id) REFERENCES roles (id),
    FOREIGN KEY (actor_id) REFERENCES actors (id)
  );

  CREATE TABLE IF NOT EXISTS performance_logs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT,
    date TEXT NOT NULL,
    playbill_id TEXT NOT NULL,
    main_actors TEXT,
    audience_reaction INTEGER CHECK (audience_reaction BETWEEN 1 AND 5),
    notes TEXT,
    stage_notes TEXT,
    lyric_changes TEXT,
    prop_damages TEXT,
    cast_changes TEXT,
    photo BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES schedules (id),
    FOREIGN KEY (playbill_id) REFERENCES playbills (id)
  );

  CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules (date);
  CREATE INDEX IF NOT EXISTS idx_logs_date ON performance_logs (date);
  CREATE INDEX IF NOT EXISTS idx_actors_main_role ON actors (main_role);
`);

type MainRole = '生' | '旦' | '净' | '末' | '丑';
type CardPattern = '龙' | '凤' | '牡丹' | '祥云';
type AudienceReaction = 1 | 2 | 3 | 4 | 5;
type PlaybillStructureType = 'act' | 'scene' | 'character' | 'sing' | 'action';

interface PlaybillStructure {
  id: string;
  type: PlaybillStructureType;
  name: string;
  content: string;
  children: PlaybillStructure[];
}

interface User {
  id: string;
  username: string;
  password: string;
  created_at: string;
}

interface Actor {
  id: string;
  name: string;
  main_role: MainRole;
  secondary_roles: string;
  voice: number;
  posture: number;
  skill: number;
  avatar: string | null;
  created_at: string;
}

interface Playbill {
  id: string;
  title: string;
  description: string;
  structure: string;
  created_at: string;
}

interface Role {
  id: string;
  playbill_id: string;
  name: string;
  character_type: MainRole;
  color: string | null;
  actor_id: string | null;
  created_at: string;
}

interface Schedule {
  id: string;
  date: string;
  playbill_id: string;
  duration: number | null;
  notes: string | null;
  created_at: string;
}

interface ScheduleRole {
  id: string;
  schedule_id: string;
  role_id: string;
  actor_id: string;
  card_pattern: CardPattern | null;
}

interface PerformanceLog {
  id: string;
  schedule_id: string | null;
  date: string;
  playbill_id: string;
  main_actors: string | null;
  audience_reaction: AudienceReaction | null;
  notes: string | null;
  stage_notes: string | null;
  lyric_changes: string | null;
  prop_damages: string | null;
  cast_changes: string | null;
  photo: Buffer | null;
  created_at: string;
}

function createGenericCRUD<T extends { id?: string }>(tableName: string) {
  const getAll = db.prepare(`SELECT * FROM ${tableName}`);
  const getById = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`);
  const deleteById = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);

  function getAllFn(): T[] {
    return getAll.all() as T[];
  }

  function getByIdFn(id: string): T | undefined {
    return getById.get(id) as T | undefined;
  }

  function createFn(data: Omit<T, 'id' | 'created_at'> & { id?: string }): T {
    const id = data.id || uuidv4();
    const keys = Object.keys(data).filter(k => k !== 'id');
    const values = [id, ...keys.map(k => (data as Record<string, unknown>)[k])];
    const placeholders = ['?', ...keys.map(() => '?')].join(', ');
    const columns = ['id', ...keys].join(', ');
    const stmt = db.prepare(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`);
    stmt.run(...values);
    return getByIdFn(id) as T;
  }

  function updateFn(id: string, data: Partial<Omit<T, 'id' | 'created_at'>>): T | undefined {
    const keys = Object.keys(data);
    if (keys.length === 0) return getByIdFn(id);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = [...keys.map(k => (data as Record<string, unknown>)[k]), id];
    const stmt = db.prepare(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`);
    stmt.run(...values);
    return getByIdFn(id);
  }

  function deleteFn(id: string): boolean {
    const result = deleteById.run(id);
    return result.changes > 0;
  }

  return {
    getAll: getAllFn,
    getById: getByIdFn,
    create: createFn,
    update: updateFn,
    delete: deleteFn,
  };
}

export const users = createGenericCRUD<User>('users');
export const actors = createGenericCRUD<Actor>('actors');
export const playbills = createGenericCRUD<Playbill>('playbills');
export const roles = createGenericCRUD<Role>('roles');
export const schedules = createGenericCRUD<Schedule>('schedules');
export const schedule_roles = createGenericCRUD<ScheduleRole>('schedule_roles');
export const performance_logs = createGenericCRUD<PerformanceLog>('performance_logs');

export function getRolesByPlaybillId(playbillId: string): Role[] {
  const stmt = db.prepare('SELECT * FROM roles WHERE playbill_id = ?');
  return stmt.all(playbillId) as Role[];
}

export function getScheduleRolesByScheduleId(scheduleId: string): ScheduleRole[] {
  const stmt = db.prepare('SELECT * FROM schedule_roles WHERE schedule_id = ?');
  return stmt.all(scheduleId) as ScheduleRole[];
}

export function getSchedulesByDateRange(startDate: string, endDate: string): Schedule[] {
  const stmt = db.prepare('SELECT * FROM schedules WHERE date BETWEEN ? AND ? ORDER BY date');
  return stmt.all(startDate, endDate) as Schedule[];
}

export function getPerformanceLogsByDateRange(startDate: string, endDate: string): PerformanceLog[] {
  const stmt = db.prepare('SELECT * FROM performance_logs WHERE date BETWEEN ? AND ? ORDER BY date');
  return stmt.all(startDate, endDate) as PerformanceLog[];
}

const actorCountStmt = db.prepare('SELECT COUNT(*) as count FROM actors');
const playbillCountStmt = db.prepare('SELECT COUNT(*) as count FROM playbills');

const actorData: { name: string; mainRole: MainRole; secondaryRoles: MainRole[]; voice: number; posture: number; skill: number }[] = [
  { name: '张文远', mainRole: '生', secondaryRoles: ['末'], voice: 85, posture: 88, skill: 90 },
  { name: '李相如', mainRole: '生', secondaryRoles: ['生'], voice: 92, posture: 87, skill: 89 },
  { name: '王梦龙', mainRole: '生', secondaryRoles: ['末'], voice: 78, posture: 95, skill: 82 },
  { name: '赵青云', mainRole: '生', secondaryRoles: ['丑'], voice: 88, posture: 83, skill: 91 },
  { name: '孙凤鸣', mainRole: '生', secondaryRoles: ['净'], voice: 90, posture: 91, skill: 87 },
  { name: '周玉书', mainRole: '生', secondaryRoles: ['旦'], voice: 83, posture: 89, skill: 93 },

  { name: '林黛玉', mainRole: '旦', secondaryRoles: ['生'], voice: 95, posture: 92, skill: 88 },
  { name: '崔莺莺', mainRole: '旦', secondaryRoles: ['旦'], voice: 89, posture: 94, skill: 91 },
  { name: '杜丽娘', mainRole: '旦', secondaryRoles: ['旦'], voice: 93, posture: 90, skill: 87 },
  { name: '白秀英', mainRole: '旦', secondaryRoles: ['丑'], voice: 86, posture: 88, skill: 92 },
  { name: '蔡文姬', mainRole: '旦', secondaryRoles: ['生'], voice: 91, posture: 85, skill: 94 },
  { name: '谢天香', mainRole: '旦', secondaryRoles: ['旦'], voice: 87, posture: 93, skill: 86 },

  { name: '包公严', mainRole: '净', secondaryRoles: ['生'], voice: 88, posture: 90, skill: 85 },
  { name: '曹孟德', mainRole: '净', secondaryRoles: ['净'], voice: 92, posture: 87, skill: 93 },
  { name: '张翼德', mainRole: '净', secondaryRoles: ['净'], voice: 85, posture: 94, skill: 89 },
  { name: '尉迟恭', mainRole: '净', secondaryRoles: ['生'], voice: 90, posture: 91, skill: 87 },
  { name: '关云长', mainRole: '净', secondaryRoles: ['净'], voice: 87, posture: 88, skill: 92 },
  { name: '楚霸王', mainRole: '净', secondaryRoles: ['生'], voice: 93, posture: 86, skill: 90 },

  { name: '吴太白', mainRole: '末', secondaryRoles: ['生'], voice: 84, posture: 82, skill: 88 },
  { name: '郑元和', mainRole: '末', secondaryRoles: ['末'], voice: 89, posture: 85, skill: 90 },
  { name: '陈季常', mainRole: '末', secondaryRoles: ['丑'], voice: 81, posture: 87, skill: 85 },
  { name: '蒋子龙', mainRole: '末', secondaryRoles: ['生'], voice: 86, posture: 83, skill: 89 },
  { name: '柳梦梅', mainRole: '末', secondaryRoles: ['末'], voice: 88, posture: 84, skill: 91 },
  { name: '韩夫子', mainRole: '末', secondaryRoles: ['末'], voice: 83, posture: 86, skill: 87 },

  { name: '时三郎', mainRole: '丑', secondaryRoles: ['旦'], voice: 80, posture: 92, skill: 94 },
  { name: '蒋干卿', mainRole: '丑', secondaryRoles: ['丑'], voice: 85, posture: 89, skill: 91 },
  { name: '高力士', mainRole: '丑', secondaryRoles: ['净'], voice: 78, posture: 93, skill: 88 },
  { name: '牛皋', mainRole: '丑', secondaryRoles: ['丑'], voice: 82, posture: 90, skill: 93 },
  { name: '程咬金', mainRole: '丑', secondaryRoles: ['丑'], voice: 87, posture: 88, skill: 89 },
  { name: '娄阿鼠', mainRole: '丑', secondaryRoles: ['丑'], voice: 79, posture: 91, skill: 92 },
];

const classicPlaybills: {
  title: string;
  description: string;
  structure: PlaybillStructure;
  roles: { name: string; characterType: MainRole; color: string }[];
}[] = [
  {
    title: '牡丹亭',
    description: '明代汤显祖的代表作，讲述杜丽娘与柳梦梅的爱情故事，是中国戏曲史上的经典之作。',
    structure: {
      id: uuidv4(),
      type: 'act',
      name: '全剧',
      content: '',
      children: [
        {
          id: uuidv4(),
          type: 'scene',
          name: '第一出 惊梦',
          content: '杜丽娘游园惊梦，与柳梦梅相遇',
          children: [
            { id: uuidv4(), type: 'character', name: '杜丽娘', content: '南安太守杜宝之女', children: [] },
            { id: uuidv4(), type: 'character', name: '柳梦梅', content: '穷书生', children: [] },
            { id: uuidv4(), type: 'sing', name: '皂罗袍', content: '原来姹紫嫣红开遍', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第二出 寻梦',
          content: '杜丽娘相思成疾',
          children: [
            { id: uuidv4(), type: 'action', name: '寻梦', content: '杜丽娘后花园寻梦', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第三出 写真',
          content: '杜丽娘自画肖像',
          children: [
            { id: uuidv4(), type: 'sing', name: '二郎神', content: '自恨红颜多命薄', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第四出 还魂',
          content: '杜丽娘还魂与柳梦梅相聚',
          children: [
            { id: uuidv4(), type: 'action', name: '还魂', content: '杜丽娘起死回生', children: [] },
          ],
        },
      ],
    },
    roles: [
      { name: '杜丽娘', characterType: '旦', color: '#E91E63' },
      { name: '柳梦梅', characterType: '生', color: '#2196F3' },
      { name: '杜宝', characterType: '末', color: '#4CAF50' },
      { name: '春香', characterType: '丑', color: '#FF9800' },
      { name: '石道姑', characterType: '净', color: '#9C27B0' },
    ],
  },
  {
    title: '西厢记',
    description: '元代王实甫的代表作，讲述张生与崔莺莺的爱情故事，被誉为"天下第一杂剧"。',
    structure: {
      id: uuidv4(),
      type: 'act',
      name: '全剧',
      content: '',
      children: [
        {
          id: uuidv4(),
          type: 'scene',
          name: '第一出 惊艳',
          content: '张生普救寺初见崔莺莺',
          children: [
            { id: uuidv4(), type: 'character', name: '崔莺莺', content: '崔相国之女', children: [] },
            { id: uuidv4(), type: 'character', name: '张珙', content: '书生张君瑞', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第二出 听琴',
          content: '张生月下弹琴，崔莺莺听琴',
          children: [
            { id: uuidv4(), type: 'sing', name: '凤求凰', content: '有美人兮，见之不忘', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第三出 传书',
          content: '红娘传书递简',
          children: [
            { id: uuidv4(), type: 'character', name: '红娘', content: '崔莺莺侍女', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第四出 长亭送别',
          content: '崔夫人答应婚事，张生进京赶考',
          children: [
            { id: uuidv4(), type: 'sing', name: '端正好', content: '碧云天，黄花地', children: [] },
          ],
        },
      ],
    },
    roles: [
      { name: '崔莺莺', characterType: '旦', color: '#E91E63' },
      { name: '张珙', characterType: '生', color: '#2196F3' },
      { name: '红娘', characterType: '丑', color: '#FF9800' },
      { name: '崔夫人', characterType: '净', color: '#9C27B0' },
      { name: '白马将军', characterType: '净', color: '#F44336' },
    ],
  },
  {
    title: '窦娥冤',
    description: '元代关汉卿的代表作，讲述窦娥被冤枉致死，感天动地的悲剧故事。',
    structure: {
      id: uuidv4(),
      type: 'act',
      name: '全剧',
      content: '',
      children: [
        {
          id: uuidv4(),
          type: 'scene',
          name: '第一出 法场',
          content: '窦娥被押赴法场问斩',
          children: [
            { id: uuidv4(), type: 'character', name: '窦娥', content: '窦天章之女', children: [] },
            { id: uuidv4(), type: 'sing', name: '滚绣球', content: '地也，你不分好歹何为地', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第二出 三桩誓愿',
          content: '窦娥立下三桩誓愿',
          children: [
            { id: uuidv4(), type: 'action', name: '誓愿', content: '血溅白练、六月飞雪、亢旱三年', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第三出 昭雪',
          content: '窦天章为女昭雪',
          children: [
            { id: uuidv4(), type: 'character', name: '窦天章', content: '窦娥之父，廉访使', children: [] },
          ],
        },
      ],
    },
    roles: [
      { name: '窦娥', characterType: '旦', color: '#E91E63' },
      { name: '窦天章', characterType: '末', color: '#4CAF50' },
      { name: '桃杌', characterType: '净', color: '#F44336' },
      { name: '蔡婆婆', characterType: '丑', color: '#FF9800' },
      { name: '张驴儿', characterType: '丑', color: '#9C27B0' },
    ],
  },
  {
    title: '长生殿',
    description: '清代洪昇的代表作，讲述唐玄宗与杨贵妃的爱情悲剧故事。',
    structure: {
      id: uuidv4(),
      type: 'act',
      name: '全剧',
      content: '',
      children: [
        {
          id: uuidv4(),
          type: 'scene',
          name: '第一出 定情',
          content: '七夕长生殿盟誓',
          children: [
            { id: uuidv4(), type: 'character', name: '杨贵妃', content: '名玉环，唐玄宗贵妃', children: [] },
            { id: uuidv4(), type: 'character', name: '唐玄宗', content: '李隆基，大唐天子', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第二出 霓裳羽衣',
          content: '杨贵妃舞霓裳羽衣曲',
          children: [
            { id: uuidv4(), type: 'sing', name: '霓裳羽衣曲', content: '天仙子', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第三出 马嵬坡',
          content: '安史之乱，玄宗西逃',
          children: [
            { id: uuidv4(), type: 'action', name: '赐死', content: '杨贵妃被赐死马嵬坡', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第四出 重圆',
          content: '玄宗与玉环在天上重圆',
          children: [
            { id: uuidv4(), type: 'sing', name: '哭像', content: '在天愿作比翼鸟', children: [] },
          ],
        },
      ],
    },
    roles: [
      { name: '杨贵妃', characterType: '旦', color: '#E91E63' },
      { name: '唐玄宗', characterType: '生', color: '#2196F3' },
      { name: '安禄山', characterType: '净', color: '#F44336' },
      { name: '郭子仪', characterType: '末', color: '#4CAF50' },
      { name: '高力士', characterType: '丑', color: '#FF9800' },
    ],
  },
  {
    title: '桃花扇',
    description: '清代孔尚任的代表作，讲述侯方域与李香君的爱情故事，反映南明兴亡。',
    structure: {
      id: uuidv4(),
      type: 'act',
      name: '全剧',
      content: '',
      children: [
        {
          id: uuidv4(),
          type: 'scene',
          name: '第一出 眠香',
          content: '侯方域与李香君相识相恋',
          children: [
            { id: uuidv4(), type: 'character', name: '李香君', content: '秦淮名妓', children: [] },
            { id: uuidv4(), type: 'character', name: '侯方域', content: '明末文人', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第二出 却奁',
          content: '李香君拒绝阮大铖的妆奁',
          children: [
            { id: uuidv4(), type: 'action', name: '却奁', content: '李香君却奁明志', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第三出 守楼',
          content: '李香君守楼拒婚，血溅桃花扇',
          children: [
            { id: uuidv4(), type: 'action', name: '守楼', content: '李香君以死明志，血溅扇面', children: [] },
          ],
        },
        {
          id: uuidv4(),
          type: 'scene',
          name: '第四出 入道',
          content: '南明灭亡，二人双双入道',
          children: [
            { id: uuidv4(), type: 'sing', name: '哀江南', content: '残山梦最真，旧境丢难掉', children: [] },
          ],
        },
      ],
    },
    roles: [
      { name: '李香君', characterType: '旦', color: '#E91E63' },
      { name: '侯方域', characterType: '生', color: '#2196F3' },
      { name: '阮大铖', characterType: '丑', color: '#F44336' },
      { name: '史可法', characterType: '末', color: '#4CAF50' },
      { name: '杨龙友', characterType: '净', color: '#9C27B0' },
    ],
  },
];

function initActors() {
  const result = actorCountStmt.get() as { count: number };
  if (result.count > 0) {
    console.log('Actors already initialized, skipping...');
    return;
  }

  console.log('Initializing 30 actors...');
  const insertStmt = db.prepare(
    'INSERT INTO actors (id, name, main_role, secondary_roles, voice, posture, skill, avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction((actors: typeof actorData) => {
    for (const actor of actors) {
      const id = uuidv4();
      insertStmt.run(
        id,
        actor.name,
        actor.mainRole,
        JSON.stringify(actor.secondaryRoles),
        actor.voice,
        actor.posture,
        actor.skill,
        null
      );
    }
  });

  transaction(actorData);
  console.log('30 actors initialized successfully!');
}

function initPlaybills() {
  const result = playbillCountStmt.get() as { count: number };
  if (result.count > 0) {
    console.log('Playbills already initialized, skipping...');
    return;
  }

  console.log('Initializing 5 classic playbills...');
  const insertPlaybillStmt = db.prepare(
    'INSERT INTO playbills (id, title, description, structure) VALUES (?, ?, ?, ?)'
  );
  const insertRoleStmt = db.prepare(
    'INSERT INTO roles (id, playbill_id, name, character_type, color, actor_id) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction((playbills: typeof classicPlaybills) => {
    for (const playbill of playbills) {
      const playbillId = uuidv4();
      insertPlaybillStmt.run(
        playbillId,
        playbill.title,
        playbill.description,
        JSON.stringify(playbill.structure)
      );

      for (const role of playbill.roles) {
        const roleId = uuidv4();
        insertRoleStmt.run(
          roleId,
          playbillId,
          role.name,
          role.characterType,
          role.color,
          null
        );
      }
    }
  });

  transaction(classicPlaybills);
  console.log('5 classic playbills initialized successfully!');
}

export function initDatabase() {
  console.log('Initializing database...');
  initActors();
  initPlaybills();
  console.log('Database initialization complete!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initDatabase();
  db.close();
  process.exit(0);
}

export default db;
