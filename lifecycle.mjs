/**
 * lifecycle.mjs — 驿站调度的状态机，信件/马匹/任务三方状态的唯一事实来源。
 *
 * 状态链路：
 *   信件: pending --派单--> assigned --抵达结算--> delivered
 *   马匹: idle --派单--> transit --抵达结算--> idle
 *         idle --休息--> resting --冷却到期--> idle
 *   任务: in_progress --抵达结算--> completed(准时) | delayed(超时)
 *
 * 口径约定：
 *   - 预计送达时间 estimatedArrivalTime 在派单时确定（出发时刻 + 信件预计分钟数），此后不再变化；
 *   - 抵达结算与超时判定都以它与实际抵达时刻比较得出，任务终态由同一函数推导；
 *   - 所有时间相关函数都显式接收 now 参数，便于离线测试注入假时钟。
 */
import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MINUTE_MS = 60 * 1000;
export const REST_COOLDOWN_MS = 30 * 1000;

export const LETTER_STATUS = Object.freeze({
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  DELIVERED: 'delivered',
});

export const HORSE_STATUS = Object.freeze({
  IDLE: 'idle',
  TRANSIT: 'transit',
  RESTING: 'resting',
});

export const TASK_STATUS = Object.freeze({
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DELAYED: 'delayed',
});

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
  urgent: 0.5,
  normal: 1.0,
  regular: 2.0,
};

/** 业务冲突错误，code 供程序判断，httpStatus 供 HTTP 层映射。 */
export class LifecycleError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function calculateEstimatedTime(destination, urgency) {
  const baseTime = destinationBaseTimes[destination] || 120;
  const multiplier = urgencyMultipliers[urgency] || 1.0;
  return Math.round(baseTime * multiplier);
}

function queryToObjects(result) {
  if (!result || !result.columns || !result.values) return [];
  return result.values.map((row) => {
    const obj = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/** 初始化内存数据库（wasm 从本地 node_modules 加载，可离线运行）。 */
export async function createDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
  });

  const db = new SQL.Database();

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

  // 同一封信任意时刻至多一个在途任务，从数据库层面杜绝重复派单。
  db.run(`
    CREATE UNIQUE INDEX uniq_inflight_task_per_letter
    ON tasks(letterId) WHERE status = 'in_progress'
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

  return db;
}

const TASK_VIEW_SQL = `
  SELECT t.*, COALESCE(l.destination, '（信件已删除）') AS destination,
         l.urgency, l.weight, h.name AS horseName
  FROM tasks t
  LEFT JOIN letters l ON t.letterId = l.id
  JOIN horses h ON t.horseId = h.id
`;

export function createStore(db) {
  const query = (sql, params = []) => {
    const result = db.exec(sql, params);
    return result.length > 0 ? queryToObjects(result[0]) : [];
  };

  const getLetter = (id) => query('SELECT * FROM letters WHERE id = ?', [id])[0];
  const getHorse = (id) => query('SELECT * FROM horses WHERE id = ?', [id])[0];
  const getTask = (id) => query('SELECT * FROM tasks WHERE id = ?', [id])[0];
  const getTaskView = (id) => query(`${TASK_VIEW_SQL} WHERE t.id = ?`, [id])[0];

  /**
   * 抵达结算的唯一入口：任务落终态、信件变已送达、马匹回空闲，
   * 终态由实际抵达时刻与派单时确定的预计送达时间比较得出。
   */
  function settleTaskRow(task, actualArrivalTime) {
    const status =
      actualArrivalTime > task.estimatedArrivalTime
        ? TASK_STATUS.DELAYED
        : TASK_STATUS.COMPLETED;
    db.run(`UPDATE tasks SET status = ?, actualArrivalTime = ? WHERE id = ?`, [
      status,
      actualArrivalTime,
      task.id,
    ]);
    db.run(`UPDATE letters SET status = ? WHERE id = ?`, [
      LETTER_STATUS.DELIVERED,
      task.letterId,
    ]);
    db.run(
      `UPDATE horses SET status = 'idle', currentLoad = 0, assignedTaskId = NULL WHERE id = ?`,
      [task.horseId]
    );
    return status;
  }

  return {
    // ---------- 信件 ----------
    listLetters() {
      return query('SELECT * FROM letters ORDER BY createdAt DESC');
    },

    createLetter({ sender, receiver, destination, urgency, weight }, now) {
      const id = uuidv4();
      const estimatedDeliveryTime = calculateEstimatedTime(destination, urgency);
      db.run(
        `INSERT INTO letters (id, sender, receiver, destination, urgency, weight, status, estimatedDeliveryTime, createdAt) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [id, sender, receiver, destination, urgency, weight, estimatedDeliveryTime, now]
      );
      return getLetter(id);
    },

    deleteLetter(id) {
      const letter = getLetter(id);
      if (!letter) {
        throw new LifecycleError('LETTER_NOT_FOUND', '信件不存在', 404);
      }
      const inflight = query(
        `SELECT id FROM tasks WHERE letterId = ? AND status = 'in_progress'`,
        [id]
      );
      if (letter.status === LETTER_STATUS.ASSIGNED || inflight.length > 0) {
        throw new LifecycleError('LETTER_IN_TRANSIT', '信件在途，无法删除', 409);
      }
      db.run(`DELETE FROM letters WHERE id = ?`, [id]);
    },

    // ---------- 马匹 ----------
    listHorses() {
      return query('SELECT * FROM horses ORDER BY id');
    },

    restHorse(id, now) {
      const horse = getHorse(id);
      if (!horse) {
        throw new LifecycleError('HORSE_NOT_FOUND', '马匹不存在', 404);
      }
      if (horse.status !== HORSE_STATUS.IDLE) {
        throw new LifecycleError(
          'HORSE_NOT_IDLE',
          horse.status === HORSE_STATUS.TRANSIT ? '马匹在途中，无法安排休息' : '马匹已在休息中',
          409
        );
      }
      db.run(
        `UPDATE horses SET status = 'resting', restCooldownEnd = ?, assignedTaskId = NULL WHERE id = ?`,
        [now + REST_COOLDOWN_MS, id]
      );
      return getHorse(id);
    },

    // ---------- 任务 ----------
    dispatch(letterId, horseId, now) {
      const letter = getLetter(letterId);
      if (!letter) {
        throw new LifecycleError('LETTER_NOT_FOUND', '信件不存在', 404);
      }
      if (letter.status !== LETTER_STATUS.PENDING) {
        throw new LifecycleError('LETTER_NOT_PENDING', '信件已派发或已送达，不能重复派单', 409);
      }
      const horse = getHorse(horseId);
      if (!horse) {
        throw new LifecycleError('HORSE_NOT_FOUND', '马匹不存在', 404);
      }
      if (horse.status !== HORSE_STATUS.IDLE) {
        throw new LifecycleError('HORSE_NOT_IDLE', '马匹不在空闲状态', 409);
      }
      if (horse.currentLoad + letter.weight > horse.maxLoad) {
        throw new LifecycleError('LOAD_EXCEEDED', '马匹载重超限', 400);
      }

      const taskId = uuidv4();
      const estimatedArrivalTime = now + letter.estimatedDeliveryTime * MINUTE_MS;
      try {
        db.run(
          `INSERT INTO tasks (id, letterId, horseId, departureTime, estimatedArrivalTime, status) VALUES (?, ?, ?, ?, ?, 'in_progress')`,
          [taskId, letterId, horseId, now, estimatedArrivalTime]
        );
      } catch (err) {
        if (String(err.message).includes('uniq_inflight_task_per_letter')) {
          throw new LifecycleError('LETTER_NOT_PENDING', '信件已有在途任务，不能重复派单', 409);
        }
        throw err;
      }
      db.run(
        `UPDATE horses SET status = 'transit', currentLoad = ?, assignedTaskId = ? WHERE id = ?`,
        [horse.currentLoad + letter.weight, taskId, horseId]
      );
      db.run(`UPDATE letters SET status = 'assigned' WHERE id = ?`, [letterId]);
      return getTaskView(taskId);
    },

    /** 手动结算（管理端强制抵达）：终态同样由预计送达时间推导，不接受外部指定。 */
    settleTask(taskId, now, actualArrivalTime) {
      const task = getTask(taskId);
      if (!task) {
        throw new LifecycleError('TASK_NOT_FOUND', '任务不存在', 404);
      }
      if (task.status !== TASK_STATUS.IN_PROGRESS) {
        throw new LifecycleError('TASK_ALREADY_SETTLED', '任务已结算，不能重复操作', 409);
      }
      settleTaskRow(task, actualArrivalTime ?? now);
      return getTaskView(taskId);
    },

    listTasks() {
      return query(`${TASK_VIEW_SQL} ORDER BY t.departureTime DESC`);
    },

    taskHistory(page = 1, limit = 20) {
      const offset = (page - 1) * limit;
      const total = query('SELECT COUNT(*) AS total FROM tasks')[0]?.total || 0;
      const tasks = query(`${TASK_VIEW_SQL} ORDER BY t.departureTime DESC LIMIT ? OFFSET ?`, [
        limit,
        offset,
      ]);
      return { tasks, total, page, limit, hasMore: offset + limit < total };
    },

    // ---------- 生命周期推进 ----------
    /**
     * 时钟推进：结算所有到达预计送达时刻的在途任务（按预计送达时刻准时抵达），
     * 并释放冷却到期的休息马匹。定时器与每次 API 读取都会调用它，
     * 保证任意视图读到的都是同一时刻的事实。
     */
    sweep(now) {
      const dueTasks = query(
        `SELECT * FROM tasks WHERE status = 'in_progress' AND estimatedArrivalTime <= ?`,
        [now]
      );
      dueTasks.forEach((task) => settleTaskRow(task, task.estimatedArrivalTime));

      const restedHorses = query(
        `SELECT * FROM horses WHERE status = 'resting' AND restCooldownEnd <= ?`,
        [now]
      );
      restedHorses.forEach((horse) => {
        db.run(`UPDATE horses SET status = 'idle', restCooldownEnd = NULL WHERE id = ?`, [
          horse.id,
        ]);
      });

      return {
        settledTaskIds: dueTasks.map((task) => task.id),
        releasedHorseIds: restedHorses.map((horse) => horse.id),
      };
    },

    // ---------- 统计 ----------
    statistics(now) {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);

      const todayDeliveries =
        query(
          `SELECT COUNT(*) AS count FROM tasks WHERE actualArrivalTime IS NOT NULL AND actualArrivalTime >= ?`,
          [dayStart.getTime()]
        )[0]?.count || 0;

      const settled = query(
        `SELECT departureTime, estimatedArrivalTime, actualArrivalTime FROM tasks WHERE status IN ('completed', 'delayed')`
      );

      let averageDeliveryTime = 0;
      let overtimeRate = 0;
      if (settled.length > 0) {
        const totalTime = settled.reduce(
          (sum, task) => sum + (task.actualArrivalTime - task.departureTime),
          0
        );
        averageDeliveryTime = Math.round(totalTime / settled.length / MINUTE_MS);
        const delayedCount = settled.filter(
          (task) => task.actualArrivalTime > task.estimatedArrivalTime
        ).length;
        overtimeRate = Math.round((delayedCount / settled.length) * 100);
      }

      return { todayDeliveries, averageDeliveryTime, overtimeRate };
    },

    // ---------- 车队 ----------
    listFleets() {
      return query('SELECT * FROM fleets ORDER BY id');
    },
  };
}
