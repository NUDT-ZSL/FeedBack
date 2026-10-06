import {
  GameState,
  Soldier,
  WallSegment,
  Position,
  BreakoutEvent,
  SortieDirection,
  GRID_WIDTH,
  WALL_ROW,
  MAX_MORALE,
  SOLDIER_MOVE_RANGE,
  DEFENDER_GRAIN_UPKEEP_PER_TURN,
  BREAKOUT_GRAIN_COST_PER_SOLDIER,
  BREAKOUT_MORALE_REQUIRED,
  ROUT_MORALE_THRESHOLD,
  HOLD_MORALE_DECAY,
  BREAKOUT_CASUALTY_MORALE,
  BREAKOUT_ESCAPE_MORALE,
  WALL_DEFENSE_COVER_BONUS,
  WALL_DEFENSE_FAILURE_PENALTY,
  WALL_DEFENSE_MAX,
  ARROWS_PER_REBEL_SUPPRESSED,
  REBEL_INTERCEPT_KILL,
  SORTIE_THREAT_RANGE
} from './types';
import { getDistance, isInCity } from './GameLogic';

export interface SortieExit {
  direction: SortieDirection;
  x: number;
}

export interface BreakoutResult {
  soldiers: Soldier[];
  defenders: GameState['defenders'];
  arrows: number;
  events: BreakoutEvent[];
}

const clampMorale = (v: number): number => Math.max(0, Math.min(MAX_MORALE, v));

const gateX = (): number => Math.floor(GRID_WIDTH / 2);

/** 已被摧毁（耐久归零）的城墙段，即守军可选择的突围出口 */
export const getBreachedExits = (wallSegments: WallSegment[]): SortieExit[] => {
  const exits: SortieExit[] = [];
  for (const seg of wallSegments) {
    if (seg.durability > 0) continue;
    if (seg.isGate) {
      exits.push({ direction: 'gate', x: seg.position.x });
    } else if (seg.position.x < gateX()) {
      exits.push({ direction: 'leftFlank', x: seg.position.x });
    } else {
      exits.push({ direction: 'rightFlank', x: seg.position.x });
    }
  }
  const priority: SortieDirection[] = ['gate', 'leftFlank', 'rightFlank'];
  return exits.sort(
    (a, b) => priority.indexOf(a.direction) - priority.indexOf(b.direction) || a.x - b.x
  );
};

const directionLabel = (d: SortieDirection): string =>
  d === 'gate' ? '城门缺口' : d === 'leftFlank' ? '左翼城墙缺口' : '右翼城墙缺口';

/** 出口附近（城外一侧）封堵的起义军数量 */
const countThreat = (soldiers: Soldier[], exitX: number): number =>
  soldiers.filter(
    s =>
      s.side === 'rebels' &&
      s.health > 0 &&
      !s.isDying &&
      !isInCity(s.position) &&
      Math.abs(s.position.x - exitX) <= SORTIE_THREAT_RANGE
  ).length;

const makeEvent = (
  turn: number,
  phase: BreakoutEvent['phase'],
  message: string,
  data: BreakoutEvent['data']
): BreakoutEvent => ({ turn, phase, message, data });

/**
 * 城门破坏后的守军突围与士气连锁结算。
 *
 * 每回合固定按以下顺序结算（同一回合内不会重复结算）：
 *   1. 军粮 upkeep —— 补给线被切断，守军每回合固定耗粮；
 *   2. 突围决策   —— 按当前士气与剩余军粮决定是否突围、突围方向与投入兵力；
 *   3. 突围执行   —— 投入兵力耗粮并向缺口移动，到达缺口即出城；
 *   4. 箭矢拦截   —— 城墙残余段落放箭掩护突围，拦截封堵缺口的起义军；
 *   5. 士气连锁   —— 拦截结果一次性结算士气与残余城墙防守强度；
 *   6. 溃散判定   —— 士气跌破阈值或军粮耗尽时守军转为溃散。
 *
 * 所有分支（军粮不足、士气过低、无可用缺口、无人可派等）都会产出
 * 可观察的 BreakoutEvent，而不是静默跳过。
 */
export const resolveBreakoutPhase = (state: GameState): BreakoutResult => {
  const events: BreakoutEvent[] = [];
  const turn = state.turn;
  const defenders = { ...state.defenders };
  let arrows = state.resources.arrows;
  let soldiers = state.soldiers.map(s => ({ ...s }));

  // 城门未破坏：连锁不触发，原有逻辑完全不变
  if (!state.gateDestroyed) {
    return { soldiers, defenders, arrows, events };
  }

  // 同回合防重入：保证同一士兵不被重复计入突围、士气不被重复扣减
  if (state.breakoutSettledTurn === turn) {
    return { soldiers, defenders, arrows, events };
  }

  const garrisonOf = (list: Soldier[]) =>
    list.filter(s => s.side === 'imperial' && s.health > 0 && !s.isDying && isInCity(s.position));

  // ---- 1. 军粮 upkeep ----
  const grainBeforeUpkeep = defenders.grain;
  defenders.grain = Math.max(0, defenders.grain - DEFENDER_GRAIN_UPKEEP_PER_TURN);
  events.push(
    makeEvent(turn, 'decision', `补给线被切断，守军耗粮 ${DEFENDER_GRAIN_UPKEEP_PER_TURN}（${grainBeforeUpkeep} → ${defenders.grain}）`, {
      grainBefore: grainBeforeUpkeep,
      grainAfter: defenders.grain,
      grainCost: DEFENDER_GRAIN_UPKEEP_PER_TURN
    })
  );

  // ---- 2. 突围决策 ----
  const exits = getBreachedExits(state.wallSegments);
  const garrison = garrisonOf(soldiers);
  const moraleBeforeDecision = defenders.morale;

  let exit: SortieExit | null = null;
  let committed: Soldier[] = [];
  let decisionReason = '';

  if (defenders.status === 'routed' || defenders.status === 'escaped') {
    decisionReason = '守军已溃散或撤出，不再组织突围';
  } else if (garrison.length === 0) {
    decisionReason = '城内已无可战守军';
    defenders.status = 'escaped';
  } else if (defenders.grain <= 0) {
    decisionReason = '军粮耗尽，守军无力突围，军心崩溃';
  } else if (defenders.morale <= ROUT_MORALE_THRESHOLD) {
    decisionReason = `士气 ${defenders.morale} 已跌破溃散阈值 ${ROUT_MORALE_THRESHOLD}，无人听令`;
  } else if (defenders.morale < BREAKOUT_MORALE_REQUIRED) {
    decisionReason = `士气 ${defenders.morale} 不足以组织突围（需 ${BREAKOUT_MORALE_REQUIRED}），守军依托残余城墙坚守`;
  } else if (exits.length === 0) {
    decisionReason = '城墙其余段落完好，唯一缺口被堵，守军暂守待变';
  } else {
    // 选择封堵最薄弱的缺口；并列时按 城门 > 左翼 > 右翼 的固定优先级
    exit = exits.reduce((best, e) => (countThreat(soldiers, e.x) < countThreat(soldiers, best.x) ? e : best));
    const affordable = Math.floor(defenders.grain / BREAKOUT_GRAIN_COST_PER_SOLDIER);
    const willing = Math.max(1, Math.floor(defenders.morale / 25));
    const commitCount = Math.min(garrison.length, affordable, willing);
    if (commitCount <= 0) {
      decisionReason = `军粮仅 ${defenders.grain}，不足以支撑任何士兵突围（每人需 ${BREAKOUT_GRAIN_COST_PER_SOLDIER}），守军被迫坚守`;
      exit = null;
    } else {
      // 按与缺口的距离从近到远投入兵力，每个士兵只计入一次
      committed = [...garrison]
        .sort((a, b) => getDistance(a.position, { x: exit!.x, y: WALL_ROW }) - getDistance(b.position, { x: exit!.x, y: WALL_ROW }))
        .slice(0, commitCount);
      decisionReason =
        committed.length < garrison.length
          ? `军粮/士气有限，仅投入 ${committed.length}/${garrison.length} 名守军突围`
          : `守军全体 ${committed.length} 人组织突围`;
    }
  }

  events.push(
    makeEvent(
      turn,
      'decision',
      exit
        ? `突围决策：${decisionReason}，方向【${directionLabel(exit.direction)}】，投入 ${committed.length} 人`
        : `突围决策：${decisionReason}`,
      {
        reason: decisionReason,
        direction: exit?.direction,
        exitX: exit?.x,
        committed: committed.length,
        moraleBefore: moraleBeforeDecision,
        grainBefore: defenders.grain,
        garrisonBefore: garrison.length,
        breachedCount: exits.length
      }
    )
  );

  // ---- 3. 突围执行（耗粮 + 向缺口机动）----
  let moved = 0;
  let escapedThisTurn = 0;
  if (exit && committed.length > 0) {
    const grainBeforeSortie = defenders.grain;
    const exitPos: Position = { x: exit.x, y: WALL_ROW };
    const committedIds = new Set(committed.map(s => s.id));

    soldiers = soldiers.map(s => {
      if (!committedIds.has(s.id) || s.inSortie) return s;
      const dist = getDistance(s.position, exitPos);
      let newPos = { ...s.position };
      if (dist <= SOLDIER_MOVE_RANGE) {
        newPos = { ...exitPos };
        escapedThisTurn += 1;
      } else {
        const step = SOLDIER_MOVE_RANGE / dist;
        newPos = {
          x: Math.round(s.position.x + (exitPos.x - s.position.x) * step),
          y: Math.round(s.position.y + (exitPos.y - s.position.y) * step)
        };
        moved += 1;
      }
      return { ...s, position: newPos, inSortie: true };
    });

    const grainCost = committed.length * BREAKOUT_GRAIN_COST_PER_SOLDIER;
    defenders.grain = Math.max(0, defenders.grain - grainCost);
    defenders.escapedCount += escapedThisTurn;
    defenders.status = 'breaking';
    // 成功出城的士兵离开战场
    soldiers = soldiers.filter(s => !(committedIds.has(s.id) && s.position.x === exit!.x && s.position.y === WALL_ROW));

    events.push(
      makeEvent(
        turn,
        'sortie',
        `突围执行：${committed.length} 人耗粮 ${grainCost}（${grainBeforeSortie} → ${defenders.grain}），${moved} 人向【${directionLabel(exit.direction)}】机动，${escapedThisTurn} 人冲出城外`,
        {
          direction: exit.direction,
          exitX: exit.x,
          committed: committed.length,
          moved,
          escaped: escapedThisTurn,
          grainBefore: grainBeforeSortie,
          grainAfter: defenders.grain,
          grainCost
        }
      )
    );
  }

  // ---- 4. 箭矢拦截：残余城墙放箭掩护突围 ----
  let casualties = 0;
  let threat = 0;
  let suppressed = 0;
  if (exit && committed.length > 0) {
    threat = countThreat(state.soldiers, exit.x);
    suppressed = Math.min(threat, Math.floor(arrows / ARROWS_PER_REBEL_SUPPRESSED));
    const arrowsUsed = suppressed * ARROWS_PER_REBEL_SUPPRESSED;
    const arrowsBefore = arrows;
    arrows = Math.max(0, arrows - arrowsUsed);
    const unsuppressed = threat - suppressed;
    casualties = Math.min(committed.length - escapedThisTurn, unsuppressed * REBEL_INTERCEPT_KILL);

    if (casualties > 0) {
      // 未冲出且被截杀的士兵阵亡（从仍在城内的投入兵力中按顺序扣除，每人只计一次）
      const remainingCommitted = soldiers.filter(s => s.inSortie && committed.some(c => c.id === s.id));
      const deadIds = new Set(remainingCommitted.slice(0, casualties).map(s => s.id));
      soldiers = soldiers.filter(s => !deadIds.has(s.id));
      defenders.casualtyCount += casualties;
    }

    const coverRatio = threat === 0 ? 1 : suppressed / threat;
    events.push(
      makeEvent(
        turn,
        'interception',
        threat === 0
          ? `箭矢拦截：缺口方向无起义军封堵，突围未受拦截（箭矢 ${arrowsBefore.toFixed(1)} 未动用）`
          : `箭矢拦截：${threat} 名起义军封堵缺口，城上放箭压制 ${suppressed} 人（耗箭 ${arrowsUsed} 筒，${arrowsBefore.toFixed(1)} → ${arrows.toFixed(1)}），${casualties} 名突围士兵被截杀`,
        {
          direction: exit.direction,
          exitX: exit.x,
          threat,
          suppressed,
          coverRatio,
          arrowsBefore,
          arrowsAfter: arrows,
          arrowsUsed,
          casualties,
          committed: committed.length,
          escaped: escapedThisTurn
        }
      )
    );
  }

  // ---- 5. 士气连锁 + 残余城墙防守强度（一次性结算，绝不重复扣减）----
  const wallDefenseBefore = defenders.wallDefense;
  const moraleBeforeChain = defenders.morale;
  let moraleDelta = 0;
  let chainNote = '';

  if (exit && committed.length > 0) {
    moraleDelta += escapedThisTurn * BREAKOUT_ESCAPE_MORALE;
    moraleDelta -= casualties * BREAKOUT_CASUALTY_MORALE;
    if (casualties > 0) {
      defenders.wallDefense = Math.max(0, defenders.wallDefense - WALL_DEFENSE_FAILURE_PENALTY);
      chainNote = `掩护失败，残余城墙防守强度 -${WALL_DEFENSE_FAILURE_PENALTY}`;
    } else if (threat > 0) {
      defenders.wallDefense = Math.min(WALL_DEFENSE_MAX, defenders.wallDefense + WALL_DEFENSE_COVER_BONUS);
      chainNote = `箭雨掩护成功，残余城墙防守强度 +${WALL_DEFENSE_COVER_BONUS}`;
    } else {
      chainNote = '突围未遇抵抗，城墙防守强度不变';
    }
  } else if (defenders.status === 'holding') {
    moraleDelta -= HOLD_MORALE_DECAY;
    chainNote = `坚守待变，士气每回合 -${HOLD_MORALE_DECAY}`;
  }

  defenders.morale = clampMorale(defenders.morale + moraleDelta);
  events.push(
    makeEvent(
      turn,
      'morale',
      `士气连锁：${moraleDelta >= 0 ? '+' : ''}${moraleDelta}（${moraleBeforeChain} → ${defenders.morale}）；${chainNote}（${wallDefenseBefore} → ${defenders.wallDefense}）`,
      {
        moraleBefore: moraleBeforeChain,
        moraleAfter: defenders.morale,
        moraleDelta,
        wallDefenseBefore,
        wallDefenseAfter: defenders.wallDefense,
        escaped: escapedThisTurn,
        casualties
      }
    )
  );

  // ---- 6. 溃散判定 ----
  const statusBefore = defenders.status;
  const garrisonAfter = garrisonOf(soldiers);
  if (defenders.status !== 'routed' && defenders.status !== 'escaped') {
    if (defenders.morale <= ROUT_MORALE_THRESHOLD || defenders.grain <= 0) {
      defenders.status = 'routed';
      const fled = garrisonAfter.length;
      soldiers = soldiers.filter(s => !(s.side === 'imperial' && isInCity(s.position)));
      events.push(
        makeEvent(
          turn,
          'rout',
          `守军溃散：${defenders.grain <= 0 ? '军粮耗尽' : `士气 ${defenders.morale} 跌破阈值 ${ROUT_MORALE_THRESHOLD}`}，残余 ${fled} 名守军弃城而逃，城墙防守强度归零`,
          {
            reason: defenders.grain <= 0 ? 'grain-exhausted' : 'morale-collapsed',
            statusBefore,
            statusAfter: 'routed',
            moraleAfter: defenders.morale,
            grainAfter: defenders.grain,
            garrisonBefore: garrisonAfter.length,
            garrisonAfter: 0,
            wallDefenseBefore: defenders.wallDefense,
            wallDefenseAfter: 0
          }
        )
      );
      defenders.wallDefense = 0;
    } else if (garrisonAfter.length === 0 && defenders.escapedCount > 0) {
      defenders.status = 'escaped';
      events.push(
        makeEvent(turn, 'rout', `守军全部撤出杭州城（累计突围 ${defenders.escapedCount} 人），城池易主`, {
          reason: 'all-escaped',
          statusBefore,
          statusAfter: 'escaped',
          garrisonBefore: 0,
          garrisonAfter: 0
        })
      );
    } else if (statusBefore === 'breaking' && garrisonAfter.length > 0) {
      defenders.status = 'holding';
    }
  }

  return { soldiers, defenders, arrows, events };
};
