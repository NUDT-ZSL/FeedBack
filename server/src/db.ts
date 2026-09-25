/**
 * 数据库初始化模块
 * 使用 lowdb 实现轻量级本地文件数据库
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ==================== 类型定义 ====================

/**
 * 用户表结构
 */
export interface User {
  id: string;
  username: string;
  password: string;
  createdAt: string;
}

/**
 * 目录表结构
 */
export interface Directory {
  id: string;
  name: string;
  userId: string;
  parentId: string | null;
  createdAt: string;
}

/**
 * 文档历史记录条目
 */
export interface HistoryEntry {
  version: number;
  content: string;
  timestamp: string;
}

/**
 * 文档表结构
 */
export interface Document {
  id: string;
  title: string;
  directoryId: string | null;
  content: string;
  version: number;
  userId: string;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 数据库整体结构
 */
export interface DatabaseSchema {
  users: User[];
  directories: Directory[];
  documents: Document[];
}

// ==================== 数据库单例初始化 ====================

// 获取当前文件所在目录路径（兼容 ESM 和 CommonJS）
let dirname: string;
try {
  dirname = path.dirname(fileURLToPath(import.meta.url));
} catch {
  dirname = __dirname;
}

// 数据库文件存储目录
const dataDir = path.join(dirname, '..', 'data');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 数据库文件完整路径
const dbFilePath = path.join(dataDir, 'db.json');

// 数据库默认初始数据
const defaultData: DatabaseSchema = {
  users: [],
  directories: [],
  documents: [],
};

// 创建 lowdb 适配器
const adapter = new JSONFile<DatabaseSchema>(dbFilePath);

// 实例化数据库
const db = new Low<DatabaseSchema>(adapter, defaultData);

/**
 * 初始化数据库：从磁盘加载数据，如文件不存在则写入默认值
 */
async function initDatabase(): Promise<void> {
  await db.read();
  // 确保数据库结构完整（兼容旧版本数据文件）
  if (!db.data) {
    db.data = { ...defaultData };
  }
  if (!db.data.users) db.data.users = [];
  if (!db.data.directories) db.data.directories = [];
  if (!db.data.documents) db.data.documents = [];
  await db.write();
}

// 立即执行初始化
initDatabase().catch((err) => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});

// ==================== 工具函数 ====================

/**
 * 生成唯一 ID（基于时间戳 + 随机数）
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 获取当前 ISO 格式时间字符串
 */
export function now(): string {
  return new Date().toISOString();
}

export { db };
export default db;
