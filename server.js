import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = new Database('incense.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS spices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('沉檀', '花香', '果香', '辛香', '草本')),
    effect_calm INTEGER NOT NULL DEFAULT 0,
    effect_damp INTEGER NOT NULL DEFAULT 0,
    effect_energy INTEGER NOT NULL DEFAULT 0,
    effect_warm INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS perfumes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    type TEXT NOT NULL CHECK(type IN ('线香', '香丸', '香饼')),
    effect_calm INTEGER NOT NULL DEFAULT 0,
    effect_damp INTEGER NOT NULL DEFAULT 0,
    effect_energy INTEGER NOT NULL DEFAULT 0,
    effect_warm INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS perfume_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    perfume_id TEXT NOT NULL,
    spice_id TEXT NOT NULL,
    percentage INTEGER NOT NULL,
    FOREIGN KEY (perfume_id) REFERENCES perfumes(id) ON DELETE CASCADE,
    FOREIGN KEY (spice_id) REFERENCES spices(id)
  );
`);

const initSpices = [
  ['spice_001', '沉香', '沉檀', 85, 20, 10, 30, '#3d2817', '沉水奇楠，香气醇厚绵长'],
  ['spice_002', '檀香', '沉檀', 60, 15, 25, 45, '#8b6914', '老山檀香，温润如玉'],
  ['spice_003', '玫瑰', '花香', 40, 5, 15, 20, '#c94c4c', '保加利亚玫瑰，甜香馥郁'],
  ['spice_004', '茉莉', '花香', 50, 10, 30, 15, '#f5f5dc', '双瓣茉莉，清雅脱俗'],
  ['spice_005', '桂花', '花香', 35, 25, 20, 55, '#daa520', '金桂飘香，甜而不腻'],
  ['spice_006', '柑橘', '果香', 20, 30, 60, 10, '#ffa500', '新会陈皮，理气健脾'],
  ['spice_007', '丁香', '辛香', 25, 55, 35, 70, '#8b4513', '公丁香，温中散寒'],
  ['spice_008', '艾草', '草本', 15, 80, 20, 40, '#556b2f', '陈艾绒，祛湿除瘴'],
];

const insertSpice = db.prepare(
  'INSERT OR IGNORE INTO spices (id, name, category, effect_calm, effect_damp, effect_energy, effect_warm, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
initSpices.forEach((spice) => insertSpice.run(...spice));

const initPerfumes = [
  {
    id: 'perfume_001',
    name: '安神助眠香',
    description: '夜深人静时焚一炷，助你安然入梦',
    tags: '安神,助眠,夜晚',
    type: '线香',
    effect_calm: 80,
    effect_damp: 15,
    effect_energy: 5,
    effect_warm: 25,
    ingredients: [
      { spiceId: 'spice_001', percentage: 50 },
      { spiceId: 'spice_002', percentage: 30 },
      { spiceId: 'spice_004', percentage: 20 },
    ],
  },
  {
    id: 'perfume_002',
    name: '祛湿除瘴香',
    description: '梅雨季节常备，驱散湿邪',
    tags: '祛湿,养生,居家',
    type: '香饼',
    effect_calm: 10,
    effect_damp: 75,
    effect_energy: 15,
    effect_warm: 50,
    ingredients: [
      { spiceId: 'spice_008', percentage: 60 },
      { spiceId: 'spice_007', percentage: 25 },
      { spiceId: 'spice_006', percentage: 15 },
    ],
  },
];

const insertPerfume = db.prepare(
  'INSERT OR IGNORE INTO perfumes (id, name, description, tags, type, effect_calm, effect_damp, effect_energy, effect_warm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertIngredient = db.prepare(
  'INSERT OR IGNORE INTO perfume_ingredients (perfume_id, spice_id, percentage) VALUES (?, ?, ?)'
);

initPerfumes.forEach((perfume) => {
  insertPerfume.run(
    perfume.id,
    perfume.name,
    perfume.description,
    perfume.tags,
    perfume.type,
    perfume.effect_calm,
    perfume.effect_damp,
    perfume.effect_energy,
    perfume.effect_warm
  );
  perfume.ingredients.forEach((ing) => {
    insertIngredient.run(perfume.id, ing.spiceId, ing.percentage);
  });
});

app.get('/api/spices', (req, res) => {
  try {
    const spices = db
      .prepare('SELECT * FROM spices')
      .all()
      .map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        effects: {
          安神: s.effect_calm,
          祛湿: s.effect_damp,
          提神: s.effect_energy,
          暖身: s.effect_warm,
        },
        color: s.color,
        description: s.description,
      }));
    res.json({ success: true, data: spices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/perfumes', (req, res) => {
  try {
    const perfumes = db.prepare('SELECT * FROM perfumes ORDER BY created_at DESC').all();
    const getIngredients = db.prepare(
      'SELECT spice_id, percentage FROM perfume_ingredients WHERE perfume_id = ?'
    );

    const result = perfumes.map((p) => {
      const ingredients = getIngredients.all(p.id).map((ing) => ({
        spiceId: ing.spice_id,
        percentage: ing.percentage,
      }));
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        tags: p.tags ? p.tags.split(',') : [],
        type: p.type,
        ingredients,
        effects: {
          安神: p.effect_calm,
          祛湿: p.effect_damp,
          提神: p.effect_energy,
          暖身: p.effect_warm,
        },
        createdAt: p.created_at,
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/perfumes', (req, res) => {
  try {
    const { name, description, tags, type, ingredients, effects } = req.body;

    if (!name || !type || !ingredients || ingredients.length === 0) {
      return res.status(400).json({
        success: false,
        error: '缺少必要字段：名称、类型、成分',
      });
    }

    const count = db.prepare('SELECT COUNT(*) as count FROM perfumes').get().count;
    if (count >= 12) {
      return res.status(400).json({
        success: false,
        error: '香匣已满，最多存放12支香品',
      });
    }

    const id = uuidv4();
    const insertP = db.prepare(
      'INSERT INTO perfumes (id, name, description, tags, type, effect_calm, effect_damp, effect_energy, effect_warm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertI = db.prepare(
      'INSERT INTO perfume_ingredients (perfume_id, spice_id, percentage) VALUES (?, ?, ?)'
    );

    const tagsStr = Array.isArray(tags) ? tags.join(',') : tags;

    const tx = db.transaction((perfumeId) => {
      insertP.run(
        perfumeId,
        name,
        description,
        tagsStr,
        type,
        effects.安神 || 0,
        effects.祛湿 || 0,
        effects.提神 || 0,
        effects.暖身 || 0
      );
      ingredients.forEach((ing) => {
        insertI.run(perfumeId, ing.spiceId, ing.percentage);
      });
    });

    tx(id);

    const newPerfume = db.prepare('SELECT * FROM perfumes WHERE id = ?').get(id);
    const newIngredients = getIngredients.all(id).map((ing) => ({
      spiceId: ing.spice_id,
      percentage: ing.percentage,
    }));

    res.json({
      success: true,
      data: {
        id: newPerfume.id,
        name: newPerfume.name,
        description: newPerfume.description,
        tags: newPerfume.tags ? newPerfume.tags.split(',') : [],
        type: newPerfume.type,
        ingredients: newIngredients,
        effects: {
          安神: newPerfume.effect_calm,
          祛湿: newPerfume.effect_damp,
          提神: newPerfume.effect_energy,
          暖身: newPerfume.effect_warm,
        },
        createdAt: newPerfume.created_at,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/perfumes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM perfumes WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res
        .status(404)
        .json({ success: false, error: '香品不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`瑞兰阁后端服务器运行在 http://localhost:${PORT}`);
});
