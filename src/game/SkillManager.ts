import { BoardState, CellState, Skill, RuneColor } from '../types';
import { ChainDetector } from './ChainDetector';

export class SkillManager {
  mana: number = 0;
  skills: Skill[] = [
    { id: 'fullscan', name: '全屏扫描', manaCost: 30, description: '消除所有选中颜色的符文', icon: '�' },
    { id: 'colortransform', name: '颜色转换', manaCost: 20, description: '将选中符文变换为指定颜色', icon: '🎨' },
  ];
  cooldowns: Map<string, number> = new Map([
    ['fullscan', 0],
    ['colortransform', 0],
  ]);

  addMana(amount: number): void {
    this.mana = Math.min(100, this.mana + amount);
  }

  canUseSkill(skillId: string): boolean {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill) return false;
    return this.mana >= skill.manaCost && (this.cooldowns.get(skillId) ?? 0) === 0;
  }

  useSkill(
    skillId: string,
    board: BoardState,
    params: { color?: RuneColor; targetRow?: number; targetCol?: number; newColor?: RuneColor }
  ): { board: BoardState; eliminated: CellState[]; scoreGained: number } {
    if (!this.canUseSkill(skillId)) {
      return { board, eliminated: [], scoreGained: 0 };
    }

    const skill = this.skills.find(s => s.id === skillId)!;
    this.mana -= skill.manaCost;
    this.cooldowns.set(skillId, 3);

    if (skillId === 'fullscan' && params.color) {
      const eliminated: CellState[] = [];
      let newBoard = ChainDetector.cloneBoard(board);
      for (let r = 0; r < newBoard.length; r++) {
        for (let c = 0; c < newBoard[0].length; c++) {
          if (newBoard[r][c].color === params.color) {
            eliminated.push({ ...newBoard[r][c] });
            newBoard[r][c] = { ...newBoard[r][c], color: null };
          }
        }
      }
      newBoard = ChainDetector.applyGravity(newBoard);
      return { board: newBoard, eliminated, scoreGained: eliminated.length * 10 };
    }

    if (skillId === 'colortransform' && params.targetRow !== undefined && params.targetCol !== undefined && params.newColor) {
      let newBoard = ChainDetector.cloneBoard(board);
      const { targetRow, targetCol, newColor } = params;
      newBoard[targetRow][targetCol] = { ...newBoard[targetRow][targetCol], color: newColor };

      const chains = ChainDetector.detectChains(newBoard);
      if (chains.length > 0) {
        const result = ChainDetector.eliminateChains(newBoard, chains);
        return { board: result.newBoard, eliminated: result.eliminated, scoreGained: result.eliminated.length * 10 };
      }
      return { board: newBoard, eliminated: [], scoreGained: 0 };
    }

    return { board, eliminated: [], scoreGained: 0 };
  }

  tick(): void {
    for (const [key, value] of this.cooldowns) {
      if (value > 0) {
        this.cooldowns.set(key, value - 1);
      }
    }
  }

  getMana(): number {
    return this.mana;
  }

  getSkills(): Skill[] {
    return this.skills;
  }

  getCooldown(skillId: string): number {
    return this.cooldowns.get(skillId) ?? 0;
  }
}
