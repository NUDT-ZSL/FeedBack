import { CharacterConfig, BattleLogEntry, BattleResult, BattleStats, SkillConfig } from '../src/types';

interface RuntimeCharacter extends CharacterConfig {
  currentHp: number;
  cooldowns: Map<string, number>;
  shieldAmount: number;
}

function createRuntimeCharacter(char: CharacterConfig): RuntimeCharacter {
  const cooldowns = new Map<string, number>();
  char.skills.forEach((skill) => cooldowns.set(skill.id, 0));
  return {
    ...char,
    maxHp: char.hp,
    currentHp: char.hp,
    cooldowns,
    shieldAmount: 0,
  };
}

function calculateDamage(attacker: RuntimeCharacter, defender: RuntimeCharacter, baseDamage: number): number {
  const rawDamage = attacker.attack + baseDamage;
  const reducedDamage = Math.max(1, rawDamage - defender.defense * 0.5);
  const variance = 0.9 + Math.random() * 0.2;
  return Math.round(reducedDamage * variance);
}

function selectAction(char: RuntimeCharacter): { type: 'attack' | 'skill'; skill?: SkillConfig } {
  const availableSkills = char.skills.filter((skill) => (char.cooldowns.get(skill.id) || 0) === 0);

  if (availableSkills.length > 0 && Math.random() > 0.3) {
    const randomSkill = availableSkills[Math.floor(Math.random() * availableSkills.length)];
    return { type: 'skill', skill: randomSkill };
  }

  return { type: 'attack' };
}

export function simulateBattle(player1Config: CharacterConfig, player2Config: CharacterConfig): BattleResult {
  const player1 = createRuntimeCharacter(player1Config);
  const player2 = createRuntimeCharacter(player2Config);

  const logs: BattleLogEntry[] = [];
  let turn = 0;
  const maxTurns = 100;
  let timestamp = 0;

  const stats: { player1: BattleStats; player2: BattleStats } = {
    player1: {
      totalDamage: 0,
      totalHeal: 0,
      skillHitRate: 0,
      effectiveOutputTime: 0,
      skillsUsed: 0,
      totalActions: 0,
    },
    player2: {
      totalDamage: 0,
      totalHeal: 0,
      skillHitRate: 0,
      effectiveOutputTime: 0,
      skillsUsed: 0,
      totalActions: 0,
    },
  };

  const getStatKey = (char: RuntimeCharacter): 'player1' | 'player2' =>
    char.id === player1.id ? 'player1' : 'player2';

  const getOpponent = (char: RuntimeCharacter): RuntimeCharacter =>
    char.id === player1.id ? player2 : player1;

  while (player1.currentHp > 0 && player2.currentHp > 0 && turn < maxTurns) {
    turn++;

    const order = [player1, player2].sort((a, b) => b.speed - a.speed);

    for (const actor of order) {
      if (actor.currentHp <= 0) continue;
      if (getOpponent(actor).currentHp <= 0) break;

      const statKey = getStatKey(actor);
      stats[statKey].totalActions++;

      const action = selectAction(actor);

      if (action.type === 'attack') {
        const target = getOpponent(actor);
        let damage = calculateDamage(actor, target, 0);

        if (target.shieldAmount > 0) {
          const absorbed = Math.min(target.shieldAmount, damage);
          target.shieldAmount -= absorbed;
          damage -= absorbed;
        }

        target.currentHp = Math.max(0, target.currentHp - damage);
        stats[statKey].totalDamage += damage;

        logs.push({
          turn,
          actor: actor.name,
          action: 'attack',
          target: target.name,
          value: damage,
          remainingHp: target.currentHp,
          timestamp: timestamp++,
        });
      } else if (action.skill) {
        const skill = action.skill;
        actor.cooldowns.set(skill.id, skill.cooldown);
        stats[statKey].skillsUsed++;

        if (skill.type === 'heal') {
          const healAmount = Math.round(skill.damage * (1 + Math.random() * 0.2));
          const actualHeal = Math.min(healAmount, actor.maxHp - actor.currentHp);
          actor.currentHp = Math.min(actor.maxHp, actor.currentHp + healAmount);
          stats[statKey].totalHeal += actualHeal;

          logs.push({
            turn,
            actor: actor.name,
            action: 'heal',
            target: actor.name,
            value: actualHeal,
            remainingHp: actor.currentHp,
            skillName: skill.name,
            skillColor: skill.color,
            timestamp: timestamp++,
          });
        } else if (skill.type === 'shield') {
          const shieldAmount = Math.round(skill.damage * 1.5);
          actor.shieldAmount += shieldAmount;

          logs.push({
            turn,
            actor: actor.name,
            action: 'shield',
            target: actor.name,
            value: shieldAmount,
            remainingHp: actor.currentHp,
            skillName: skill.name,
            skillColor: skill.color,
            timestamp: timestamp++,
          });
        } else {
          const target = getOpponent(actor);
          let damage = calculateDamage(actor, target, skill.damage);

          if (target.shieldAmount > 0) {
            const absorbed = Math.min(target.shieldAmount, damage);
            target.shieldAmount -= absorbed;
            damage -= absorbed;
          }

          target.currentHp = Math.max(0, target.currentHp - damage);
          stats[statKey].totalDamage += damage;

          logs.push({
            turn,
            actor: actor.name,
            action: 'skill',
            target: target.name,
            value: damage,
            remainingHp: target.currentHp,
            skillName: skill.name,
            skillColor: skill.color,
            timestamp: timestamp++,
          });
        }
      }
    }

    [player1, player2].forEach((char) => {
      char.cooldowns.forEach((cd, skillId) => {
        if (cd > 0) char.cooldowns.set(skillId, cd - 1);
      });
    });
  }

  const winner =
    player1.currentHp > 0 && player2.currentHp <= 0
      ? player1.name
      : player2.currentHp > 0 && player1.currentHp <= 0
      ? player2.name
      : null;

  const totalActionsP1 = stats.player1.totalActions || 1;
  const totalActionsP2 = stats.player2.totalActions || 1;

  stats.player1.skillHitRate =
    totalActionsP1 > 0 ? Math.round((stats.player1.skillsUsed / totalActionsP1) * 100) : 0;
  stats.player2.skillHitRate =
    totalActionsP2 > 0 ? Math.round((stats.player2.skillsUsed / totalActionsP2) * 100) : 0;

  stats.player1.effectiveOutputTime =
    logs.length > 0 ? Math.round((logs.filter((l) => l.actor === player1.name && l.value > 0).length / logs.length) * 100) : 0;
  stats.player2.effectiveOutputTime =
    logs.length > 0 ? Math.round((logs.filter((l) => l.actor === player2.name && l.value > 0).length / logs.length) * 100) : 0;

  return {
    winner,
    logs,
    stats,
    turns: turn,
  };
}
