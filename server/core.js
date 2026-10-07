/**
 * 驿站调度核心状态机（唯一事实源）。
 *
 * 状态链路：信件 pending -> assigned -> delivered
 *          马匹 idle -> transit -> idle；idle -> resting -> idle（冷却到期自动恢复）
 *          任务 in_progress -> completed / delayed / cancelled
 *
 * 所有状态变化只允许通过本模块的函数发生：
 *   addLetter / dispatchTask / reportArrival / rollbackTask / restHorse / deleteLetter / reconcile
 * 读接口（list 系列与 getStatistics）一律先 reconcile()，保证任意时刻三者状态与统计口径互相印证。
 *
 * 时钟通过 now() 注入，离线验证脚本可用虚拟时钟确定性推进。
 */
import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LETTER_STATUS = { PENDING: 'pending', ASSIGNED: 'assigned', DELIVERED: 'delivered' };
export const HORSE_STATUS = { IDLE: 'idle', TRANSIT: 'transit', RESTING: 'resting' };
export const TASK_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DELAYED: 'delayed',
  CANCELLED: 'cancelled',
};

export class DomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

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

/** 预计送达时长（逻辑分钟），派单时据此固定 estimatedArrivalTime，抵达与超时判定共用同一口径。 */
export function calculateEstimatedTime(destination, urgency) {
  const baseTime = destinationBaseTimes[destination] || 120;
  const multiplier = urgencyMultipliers[urgency] || 1.0;
  return Math.round(baseTime * multiplier);
}

function resolveSqlWasm(file) {
  const local = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
  if (fs.existsSync(local)) return local;
  return `https://sql.js.org/dist/${file}`;
}

export async function createStation({
  now = () => Date.now(),
  restCooldownMs = 30000,
  timeScale = 1,
} = {}) {
  const SQL = await initSqlJs({ locateFile: resolveSqlWasm });
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
      status TEXT NOT NULL DEFAULT 'in_progress'
    )
  `);

  const horseNames = ['赤兔', '的卢', '绝影', '爪黄飞电', '乌云踏雪', '照夜玉狮子'];
  horseNames.forEach((name, index) => {
    db.run(
      `INSERT INTO horses (id, name, status, currentLoad, maxLoad, restCooldownEnd, assignedTaskId) VALUES (?, ?, 'idle', 0, 50, NULL, NULL)`,
      [`horse-${index + 1}`, name],
    );
  });
  db.run(`INSERT INTO fleets (id, name, horseIds, currentLocation, totalLoad, maxLoad, status) VALUES ('fleet-1', '龙队', '[]', '驿站', 0, 150, 'idle')`);
  db.run(`INSERT INTO fleets (id, name, horseIds, currentLocation, totalLoad, maxLoad, status) VALUES ('fleet-2', '虎队', '[]', '驿站', 0, 150, 'idle')`);

  function queryAll(sql, params = []) {
    const result = db.exec(sql, params);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  function queryOne(sql, params = []) {
    return queryAll(sql, params)[0] || null;
  }

  const TASK_SELECT = `
    SELECT t.*,
           COALESCE(l.destination, '（信件已删除）') AS destination,
           COALESCE(l.urgency, '-') AS urgency,
           COALESCE(l.weight, 0) AS weight,
           h.name AS horseName
    FROM tasks t
    LEFT JOIN letters l ON t.letterId = l.id
    JOIN horses h ON t.horseId = h.id
  `;

  function getTask(taskId) {
    return queryOne(`${TASK_SELECT} WHERE t.id = ?`, [taskId]);
  }

  function getLetter(letterId) {
    return queryOne('SELECT * FROM letters WHERE id = ?', [letterId]);
  }

  function getHorse(horseId) {
    return queryOne('SELECT * FROM horses WHERE id = ?', [horseId]);
  }

  /**
   * 任务结算的唯一入口：以派单时固定的 estimatedArrivalTime 为唯一判定口径。
   * actualArrivalTime <= estimatedArrivalTime -> completed，否则 delayed。
   * 同事务联动：信件 -> delivered，马匹 -> idle（仅当马匹当前仍挂在该任务上）。
   */
  function settleTask(task, actualArrivalTime) {
    const status = actualArrivalTime <= task.estimatedArrivalTime
      ? TASK_STATUS.COMPLETED
      : TASK_STATUS.DELAYED;
    db.run('UPDATE tasks SET status = ?, actualArrivalTime = ? WHERE id = ?', [status, actualArrivalTime, task.id]);
    db.run(`UPDATE letters SET status = 'delivered' WHERE id = ? AND status = 'assigned'`, [task.letterId]);
    db.run(
      `UPDATE horses SET status = 'idle', currentLoad = 0, assignedTaskId = NULL WHERE id = ? AND assignedTaskId = ?`,
      [task.horseId, task.id],
    );
    return status;
  }

  /**
   * 统一对账：让所有“时间到期”的状态变化收敛到同一处。
   * 1) 预计到达时刻已到的在途任务，按预计送达时刻结算（actualArrivalTime = estimatedArrivalTime）。
   * 2) 休息冷却到期的马匹自动回到 idle。
   * 定时器与所有读接口都调用它，保证任意时刻三视图一致。
   */
  function reconcile() {
    const nowTs = now();
    const dueTasks = queryAll(
      `SELECT * FROM tasks WHERE status = 'in_progress' AND estimatedArrivalTime <= ?`,
      [nowTs],
    );
    for (const task of dueTasks) {
      settleTask(task, task.estimatedArrivalTime);
    }
    db.run(
      `UPDATE horses SET status = 'idle', restCooldownEnd = NULL
       WHERE status = 'resting' AND restCooldownEnd IS NOT NULL AND restCooldownEnd <= ?`,
      [nowTs],
    );
    return { settledTaskIds: dueTasks.map((t) => t.id) };
  }

  function addLetter({ sender, receiver, destination, urgency, weight }) {
    if (!sender || !receiver || !destination) {
      throw new DomainError('INVALID_LETTER', '发件人、收件人、目的地不能为空');
    }
    const numericWeight = Number(weight);
    if (!Number.isFinite(numericWeight) || numericWeight <= 0) {
      throw new DomainError('INVALID_LETTER', '信件重量必须为正数');
    }
    const id = uuidv4();
    const estimatedDeliveryTime = calculateEstimatedTime(destination, urgency);
    db.run(
      `INSERT INTO letters (id, sender, receiver, destination, urgency, weight, status, estimatedDeliveryTime, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, sender, receiver, destination, urgency, numericWeight, estimatedDeliveryTime, now()],
    );
    return getLetter(id);
  }

  /** 派单：信件必须 pending（拒绝重复派单），马匹必须 idle 且载重不超限。 */
  function dispatchTask({ letterId, horseId }) {
    reconcile();
    const letter = getLetter(letterId);
    if (!letter) throw new DomainError('LETTER_NOT_FOUND', '信件不存在', 404);
    if (letter.status !== LETTER_STATUS.PENDING) {
      throw new DomainError('LETTER_NOT_PENDING', '信件不在待派发状态，无法重复派单', 409);
    }
    const horse = getHorse(horseId);
    if (!horse) throw new DomainError('HORSE_NOT_FOUND', '马匹不存在', 404);
    if (horse.status !== HORSE_STATUS.IDLE) {
      throw new DomainError('HORSE_NOT_IDLE', '马匹不在空闲状态', 409);
    }
    if (horse.currentLoad + letter.weight > horse.maxLoad) {
      throw new DomainError('HORSE_OVERLOAD', '马匹载重超限');
    }

    const taskId = uuidv4();
    const departureTime = now();
    const estimatedArrivalTime = departureTime + letter.estimatedDeliveryTime * 60000 * timeScale;
    db.run(
      `INSERT INTO tasks (id, letterId, horseId, departureTime, estimatedArrivalTime, status)
       VALUES (?, ?, ?, ?, ?, 'in_progress')`,
      [taskId, letterId, horseId, departureTime, estimatedArrivalTime],
    );
    db.run(
      `UPDATE horses SET status = 'transit', currentLoad = currentLoad + ?, assignedTaskId = ? WHERE id = ?`,
      [letter.weight, taskId, horseId],
    );
    db.run(`UPDATE letters SET status = 'assigned' WHERE id = ?`, [letterId]);
    return getTask(taskId);
  }

  /**
   * 上报到达（外部到达事件）：仅在途任务可结算，超时与否按派单时确定的
   * estimatedArrivalTime 判定——晚于预计时刻即 delayed。
   * 注意不先做自动对账：若到达事件先于对账触发，以上报时刻为准记迟到；
   * 若无人上报，reconcile 会在预计时刻按准时自动结算。
   */
  function reportArrival(taskId, arrivalTime) {
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw new DomainError('TASK_NOT_FOUND', '任务不存在', 404);
    if (task.status !== TASK_STATUS.IN_PROGRESS) {
      throw new DomainError('TASK_ALREADY_SETTLED', '任务已结算，无法重复上报到达', 409);
    }
    const actual = Math.max(arrivalTime ?? now(), task.departureTime);
    settleTask(task, actual);
    return getTask(taskId);
  }

  /** 异常回退：在途任务取消，信件回到待派发，马匹释放为空闲。 */
  function rollbackTask(taskId) {
    reconcile();
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw new DomainError('TASK_NOT_FOUND', '任务不存在', 404);
    if (task.status !== TASK_STATUS.IN_PROGRESS) {
      throw new DomainError('TASK_NOT_IN_PROGRESS', '仅在途任务可以回退', 409);
    }
    db.run(`UPDATE tasks SET status = 'cancelled' WHERE id = ?`, [taskId]);
    db.run(`UPDATE letters SET status = 'pending' WHERE id = ? AND status = 'assigned'`, [task.letterId]);
    db.run(
      `UPDATE horses SET status = 'idle', currentLoad = 0, assignedTaskId = NULL WHERE id = ? AND assignedTaskId = ?`,
      [task.horseId, task.id],
    );
    return getTask(taskId);
  }

  /** 休息：仅空闲马匹可进入休息，冷却到期由 reconcile 自动恢复 idle。 */
  function restHorse(horseId) {
    reconcile();
    const horse = getHorse(horseId);
    if (!horse) throw new DomainError('HORSE_NOT_FOUND', '马匹不存在', 404);
    if (horse.status !== HORSE_STATUS.IDLE) {
      throw new DomainError('HORSE_NOT_IDLE', '仅空闲马匹可以安排休息', 409);
    }
    db.run(
      `UPDATE horses SET status = 'resting', restCooldownEnd = ?, assignedTaskId = NULL WHERE id = ?`,
      [now() + restCooldownMs, horseId],
    );
    return getHorse(horseId);
  }

  /** 删除信件：存在在途任务的信件明确拒绝删除，避免悬空任务。 */
  function deleteLetter(letterId) {
    reconcile();
    const letter = getLetter(letterId);
    if (!letter) throw new DomainError('LETTER_NOT_FOUND', '信件不存在', 404);
    const activeTask = queryOne(
      `SELECT id FROM tasks WHERE letterId = ? AND status = 'in_progress'`,
      [letterId],
    );
    if (activeTask) {
      throw new DomainError('LETTER_IN_TRANSIT', '信件存在在途任务，无法删除', 409);
    }
    db.run('DELETE FROM letters WHERE id = ?', [letterId]);
  }

  function listLetters() {
    reconcile();
    return queryAll('SELECT * FROM letters ORDER BY createdAt DESC');
  }

  function listHorses() {
    reconcile();
    return queryAll('SELECT * FROM horses ORDER BY id');
  }

  function listFleets() {
    return queryAll('SELECT * FROM fleets ORDER BY id');
  }

  function listTasks() {
    reconcile();
    return queryAll(`${TASK_SELECT} ORDER BY t.departureTime DESC`);
  }

  function listHistory(page = 1, limit = 20) {
    reconcile();
    const offset = (page - 1) * limit;
    const total = queryOne('SELECT COUNT(*) AS total FROM tasks').total;
    const tasks = queryAll(`${TASK_SELECT} ORDER BY t.departureTime DESC LIMIT ? OFFSET ?`, [limit, offset]);
    return { tasks, total, page, limit, hasMore: offset + limit < total };
  }

  /**
   * 统计口径（与明细同源，先 reconcile 再统计）：
   * - todayDeliveries：今日实际送达（completed + delayed，按 actualArrivalTime 落在今日）
   * - averageDeliveryTime：已完结任务 actualArrivalTime - departureTime 的平均（逻辑分钟）
   * - overtimeRate：已完结任务中 delayed 的占比（%）
   */
  function getStatistics() {
    reconcile();
    const todayStart = new Date(now());
    todayStart.setHours(0, 0, 0, 0);
    const todayDeliveries = queryOne(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE status IN ('completed', 'delayed') AND actualArrivalTime >= ?`,
      [todayStart.getTime()],
    ).count;
    const finished = queryAll(
      `SELECT departureTime, estimatedArrivalTime, actualArrivalTime, status
       FROM tasks WHERE status IN ('completed', 'delayed')`,
    );
    let averageDeliveryTime = 0;
    let overtimeRate = 0;
    if (finished.length > 0) {
      const totalTime = finished.reduce((sum, t) => sum + (t.actualArrivalTime - t.departureTime), 0);
      averageDeliveryTime = Math.round(totalTime / finished.length / 60000 / timeScale);
      const delayedCount = finished.filter((t) => t.status === 'delayed').length;
      overtimeRate = Math.round((delayedCount / finished.length) * 100);
    }
    return { todayDeliveries, averageDeliveryTime, overtimeRate };
  }

  return {
    db,
    reconcile,
    addLetter,
    dispatchTask,
    reportArrival,
    rollbackTask,
    restHorse,
    deleteLetter,
    getLetter,
    getHorse,
    getTask,
    listLetters,
    listHorses,
    listFleets,
    listTasks,
    listHistory,
    getStatistics,
  };
}
