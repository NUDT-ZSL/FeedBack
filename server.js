import express from 'express';
import cors from 'cors';
import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const destinationBaseTimes = {
  '长安': 120,
  '洛阳': 90,
  '扬州': 150,
  '成都': 180,
  '荆州': 100,
  '幽州': 200,
  '凉州': 240,
  '广州': 210,
};

const urgencyMultipliers = {
  'urgent': 0.5,
  'normal': 1.0,
  'regular': 2.0,
};

let db;

async function initDatabase() {
  const SQL = await initSqlJs({
    locateFile: file => `https://sql.js.org/dist/${file}`
  });

  db = new SQL.Database();

  db.run(`
    CREATE TABLE letters (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      destination TEXT NOT NULL,
      urgency TEXT NOT NULL,
      weight REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      estimatedDeliveryTime INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE horses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      currentLoad REAL NOT NULL DEFAULT 0,
      maxLoad REAL NOT NULL DEFAULT 50,
      restCooldownEnd INTEGER,
      assignedTaskId TEXT
    )
  `);

  db.run(`
    CREATE TABLE fleets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      horseIds TEXT NOT NULL DEFAULT '[]',
      currentLocation TEXT NOT NULL DEFAULT '驿站',
      totalLoad REAL NOT NULL DEFAULT 0,
      maxLoad REAL NOT NULL DEFAULT 150,
      status TEXT NOT NULL DEFAULT 'idle'
    )
  `);

  db.run(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      letterId TEXT NOT NULL,
      horseId TEXT NOT NULL,
      fleetId TEXT,
      departureTime INTEGER NOT NULL,
      estimatedArrivalTime INTEGER NOT NULL,
      actualArrivalTime INTEGER,
      status TEXT NOT NULL DEFAULT 'in_progress',
      FOREIGN KEY (letterId) REFERENCES letters(id),
      FOREIGN KEY (horseId) REFERENCES horses(id),
      FOREIGN KEY (fleetId) REFERENCES fleets(id)
    )
  `);

  const horseNames = ['赤兔', '的卢', '绝影', '爪黄飞电', '乌云踏雪', '照夜玉狮子'];
  horseNames.forEach((name, index) => {
    db.run(
      `INSERT INTO horses (id, name, status, currentLoad, maxLoad, restCooldownEnd, assignedTaskId) VALUES (?, ?, 'idle', 0, 50, NULL, NULL)`,
      [`horse-${index + 1}`, name]
    );
  });

  db.run(
    `INSERT INTO fleets (id, name, horseIds, currentLocation, totalLoad, maxLoad, status) VALUES (?, ?, '[]', '驿站', 0, 150, 'idle')`,
    ['fleet-1', '龙队']
  );
  db.run(
    `INSERT INTO fleets (id, name, horseIds, currentLocation, totalLoad, maxLoad, status) VALUES (?, ?, '[]', '驿站', 0, 150, 'idle')`,
    ['fleet-2', '虎队']
  );

  console.log('Database initialized successfully');
}

function queryToObjects(result) {
  if (!result || !result.columns || !result.values) return [];
  return result.values.map(row => {
    const obj = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

function calculateEstimatedTime(destination, urgency) {
  const baseTime = destinationBaseTimes[destination] || 120;
  const multiplier = urgencyMultipliers[urgency] || 1.0;
  return Math.round(baseTime * multiplier);
}

app.get('/api/letters', (req, res) => {
  try {
    const result = db.exec('SELECT * FROM letters ORDER BY createdAt DESC');
    const letters = result.length > 0 ? queryToObjects(result[0]) : [];
    res.json({ success: true, data: letters });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/letters', (req, res) => {
  try {
    const { sender, receiver, destination, urgency, weight } = req.body;
    const id = uuidv4();
    const estimatedDeliveryTime = calculateEstimatedTime(destination, urgency);
    const createdAt = Date.now();

    db.run(
      `INSERT INTO letters (id, sender, receiver, destination, urgency, weight, status, estimatedDeliveryTime, createdAt) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, sender, receiver, destination, urgency, weight, estimatedDeliveryTime, createdAt]
    );

    const result = db.exec('SELECT * FROM letters WHERE id = ?', [id]);
    const letter = queryToObjects(result[0])[0];
    res.json({ success: true, data: letter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/letters/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    db.run(`UPDATE letters SET status = ? WHERE id = ?`, [status, id]);
    const result = db.exec('SELECT * FROM letters WHERE id = ?', [id]);
    const letter = queryToObjects(result[0])[0];
    res.json({ success: true, data: letter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/letters/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.run(`DELETE FROM letters WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/horses', (req, res) => {
  try {
    const result = db.exec('SELECT * FROM horses ORDER BY id');
    const horses = result.length > 0 ? queryToObjects(result[0]) : [];
    res.json({ success: true, data: horses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/horses/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, currentLoad, assignedTaskId } = req.body;
    db.run(
      `UPDATE horses SET status = ?, currentLoad = ?, assignedTaskId = ? WHERE id = ?`,
      [status, currentLoad, assignedTaskId, id]
    );
    const result = db.exec('SELECT * FROM horses WHERE id = ?', [id]);
    const horse = queryToObjects(result[0])[0];
    res.json({ success: true, data: horse });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/horses/:id/rest', (req, res) => {
  try {
    const { id } = req.params;
    const restCooldownEnd = Date.now() + 30000;
    db.run(
      `UPDATE horses SET status = 'resting', restCooldownEnd = ?, assignedTaskId = NULL WHERE id = ?`,
      [restCooldownEnd, id]
    );
    const result = db.exec('SELECT * FROM horses WHERE id = ?', [id]);
    const horse = queryToObjects(result[0])[0];
    res.json({ success: true, data: horse });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tasks', (req, res) => {
  try {
    const result = db.exec(`
      SELECT t.*, l.destination, l.urgency, l.weight, h.name as horseName
      FROM tasks t
      JOIN letters l ON t.letterId = l.id
      JOIN horses h ON t.horseId = h.id
      ORDER BY t.departureTime DESC
    `);
    const tasks = result.length > 0 ? queryToObjects(result[0]) : [];
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { letterId, horseId } = req.body;

    const horseResult = db.exec('SELECT * FROM horses WHERE id = ?', [horseId]);
    const horse = queryToObjects(horseResult[0])[0];
    if (!horse) {
      return res.status(404).json({ success: false, error: '马匹不存在' });
    }
    if (horse.status !== 'idle') {
      return res.status(400).json({ success: false, error: '马匹不在空闲状态' });
    }

    const letterResult = db.exec('SELECT * FROM letters WHERE id = ?', [letterId]);
    const letter = queryToObjects(letterResult[0])[0];
    if (!letter) {
      return res.status(404).json({ success: false, error: '信件不存在' });
    }

    if (horse.currentLoad + letter.weight > horse.maxLoad) {
      return res.status(400).json({ success: false, error: '马匹载重超限' });
    }

    const taskId = uuidv4();
    const departureTime = Date.now();
    const estimatedArrivalTime = departureTime + letter.estimatedDeliveryTime * 60 * 1000;

    db.run(
      `INSERT INTO tasks (id, letterId, horseId, departureTime, estimatedArrivalTime, status) VALUES (?, ?, ?, ?, ?, 'in_progress')`,
      [taskId, letterId, horseId, departureTime, estimatedArrivalTime]
    );

    const newLoad = horse.currentLoad + letter.weight;
    db.run(
      `UPDATE horses SET status = 'transit', currentLoad = ?, assignedTaskId = ? WHERE id = ?`,
      [newLoad, taskId, horseId]
    );

    db.run(`UPDATE letters SET status = 'assigned' WHERE id = ?`, [letterId]);

    const result = db.exec(`
      SELECT t.*, l.destination, l.urgency, l.weight, h.name as horseName
      FROM tasks t
      JOIN letters l ON t.letterId = l.id
      JOIN horses h ON t.horseId = h.id
      WHERE t.id = ?
    `, [taskId]);
    const task = queryToObjects(result[0])[0];

    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, actualArrivalTime } = req.body;

    const updateFields = [];
    const updateValues = [];

    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (actualArrivalTime !== undefined) {
      updateFields.push('actualArrivalTime = ?');
      updateValues.push(actualArrivalTime);
    }

    if (updateFields.length > 0) {
      updateValues.push(id);
      db.run(`UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);

      if (status === 'completed' || status === 'delayed') {
        const taskResult = db.exec('SELECT * FROM tasks WHERE id = ?', [id]);
        const task = queryToObjects(taskResult[0])[0];
        if (task) {
          db.run(`UPDATE letters SET status = 'delivered' WHERE id = ?`, [task.letterId]);
          db.run(
            `UPDATE horses SET status = 'idle', currentLoad = 0, assignedTaskId = NULL WHERE id = ?`,
            [task.horseId]
          );
        }
      }
    }

    const result = db.exec(`
      SELECT t.*, l.destination, l.urgency, l.weight, h.name as horseName
      FROM tasks t
      JOIN letters l ON t.letterId = l.id
      JOIN horses h ON t.horseId = h.id
      WHERE t.id = ?
    `, [id]);
    const task = queryToObjects(result[0])[0];
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tasks/history', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const countResult = db.exec('SELECT COUNT(*) as total FROM tasks');
    const total = countResult[0]?.values[0]?.[0] || 0;

    const result = db.exec(`
      SELECT t.*, l.destination, l.urgency, l.weight, h.name as horseName
      FROM tasks t
      JOIN letters l ON t.letterId = l.id
      JOIN horses h ON t.horseId = h.id
      ORDER BY t.departureTime DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const tasks = result.length > 0 ? queryToObjects(result[0]) : [];
    const hasMore = offset + limit < total;

    res.json({
      success: true,
      data: {
        tasks,
        total,
        page,
        limit,
        hasMore
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/statistics', (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = todayStart.getTime();

    const todayResult = db.exec(
      'SELECT COUNT(*) as count FROM tasks WHERE departureTime >= ? AND status = ?',
      [todayTimestamp, 'completed']
    );
    const todayDeliveries = todayResult[0]?.values[0]?.[0] || 0;

    const completedResult = db.exec(
      `SELECT actualArrivalTime, departureTime, estimatedArrivalTime 
       FROM tasks 
       WHERE status = 'completed' OR status = 'delayed'`
    );
    const completedTasks = completedResult.length > 0 ? queryToObjects(completedResult[0]) : [];

    let averageDeliveryTime = 0;
    let overtimeRate = 0;

    if (completedTasks.length > 0) {
      const totalTime = completedTasks.reduce((sum, task) => {
        const actual = task.actualArrivalTime || task.estimatedArrivalTime;
        return sum + (actual - task.departureTime);
      }, 0);
      averageDeliveryTime = Math.round(totalTime / completedTasks.length / 60000);

      const delayedCount = completedTasks.filter(task => {
        const actual = task.actualArrivalTime || Date.now();
        return actual > task.estimatedArrivalTime;
      }).length;
      overtimeRate = Math.round((delayedCount / completedTasks.length) * 100);
    }

    res.json({
      success: true,
      data: {
        todayDeliveries,
        averageDeliveryTime,
        overtimeRate
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/fleets', (req, res) => {
  try {
    const result = db.exec('SELECT * FROM fleets ORDER BY id');
    const fleets = result.length > 0 ? queryToObjects(result[0]) : [];
    res.json({ success: true, data: fleets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function checkTaskCompletion() {
  const now = Date.now();
  const result = db.exec(`
    SELECT t.*, h.restCooldownEnd
    FROM tasks t
    LEFT JOIN horses h ON t.horseId = h.id
    WHERE t.status = 'in_progress'
  `);
  const tasks = result.length > 0 ? queryToObjects(result[0]) : [];

  tasks.forEach(task => {
    if (task.estimatedArrivalTime <= now) {
      const isDelayed = now > task.estimatedArrivalTime;
      const status = isDelayed ? 'delayed' : 'completed';
      db.run(
        `UPDATE tasks SET status = ?, actualArrivalTime = ? WHERE id = ?`,
        [status, now, task.id]
      );
      db.run(`UPDATE letters SET status = 'delivered' WHERE id = ?`, [task.letterId]);
      db.run(
        `UPDATE horses SET status = 'idle', currentLoad = 0, assignedTaskId = NULL WHERE id = ?`,
        [task.horseId]
      );
    }
  });

  const horseResult = db.exec(`
    SELECT * FROM horses WHERE status = 'resting' AND restCooldownEnd <= ?
  `, [now]);
  const restingHorses = horseResult.length > 0 ? queryToObjects(horseResult[0]) : [];
  restingHorses.forEach(horse => {
    db.run(
      `UPDATE horses SET status = 'idle', restCooldownEnd = NULL WHERE id = ?`,
      [horse.id]
    );
  });
}

setInterval(checkTaskCompletion, 1000);

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});
