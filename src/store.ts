import { create } from 'zustand';
import {
  FractureType,
  GamePhase,
  BoneJoint,
  FixationMaterial,
  RehabilitationAction,
  ParticleEffect
} from './types';
import {
  AngleSource,
  FixationAttempt,
  JointAdjustment,
  ReductionReport
} from './pipeline/types';
import { deriveReductionPlan, evaluateReduction, reevaluateJoint } from './pipeline/reduction';
import { attemptPlacement, createFixationState } from './pipeline/fixation';
import type { FixationState } from './pipeline/types';

interface GameState {
  gamePhase: GamePhase;
  currentFracture: FractureType | null;
  boneJoints: BoneJoint[];
  fixationMaterials: FixationMaterial[];
  rehabilitationActions: RehabilitationAction[];
  completedDays: number[];
  jointMobilityData: number[];
  timeRemaining: number;
  resetSuccess: boolean;
  showXRay: boolean;
  currentRehabDay: number;
  particleEffects: ParticleEffect[];
  angleAdjustments: JointAdjustment[];
  reductionReport: ReductionReport | null;
  lastFixationAttempt: FixationAttempt | null;
  randomizeFracture: () => void;
  updateBoneAngle: (jointId: string, angle: number, source?: AngleSource) => void;
  checkResetSuccess: () => boolean;
  placeMaterial: (materialId: string, position: string) => boolean;
  completeRehabDay: (day: number, matchPercentage: number) => void;
  setGamePhase: (phase: GamePhase) => void;
  setShowXRay: (show: boolean) => void;
  decrementTimer: () => void;
  resetGame: () => void;
  addParticleEffect: (particle: ParticleEffect) => void;
  updateParticles: () => void;
}

const initialBoneJoints: BoneJoint[] = [
  {
    id: 'upper_arm',
    name: '上臂（肩-肘）',
    currentAngle: 0,
    targetAngle: 0,
    position: { x: 200, y: 100 },
    length: 120
  },
  {
    id: 'forearm',
    name: '前臂（肘-腕）',
    currentAngle: 0,
    targetAngle: 0,
    position: { x: 200, y: 220 },
    length: 120
  },
  {
    id: 'palm',
    name: '手掌（腕-手）',
    currentAngle: 0,
    targetAngle: 0,
    position: { x: 200, y: 340 },
    length: 60
  }
];

const initialFixationMaterials: FixationMaterial[] = [
  {
    id: 'cotton_pad',
    name: '棉垫',
    type: 'cotton_pad',
    order: 1,
    position: '',
    placed: false,
    correctPosition: 'fracture_site'
  },
  {
    id: 'willow_splint',
    name: '柳木夹板',
    type: 'willow_splint',
    order: 2,
    position: '',
    placed: false,
    correctPosition: 'outer_side'
  },
  {
    id: 'bamboo_splint',
    name: '竹制夹板',
    type: 'bamboo_splint',
    order: 3,
    position: '',
    placed: false,
    correctPosition: 'inner_side'
  },
  {
    id: 'gauze',
    name: '纱布绷带',
    type: 'gauze',
    order: 4,
    position: '',
    placed: false,
    correctPosition: 'wrap'
  }
];

const initialRehabilitationActions: RehabilitationAction[] = [
  { day: 1, name: '手指伸展', trajectoryType: 'line', requiredMatch: 80, description: '缓慢伸展并弯曲手指，每次保持3秒' },
  { day: 2, name: '腕部旋转', trajectoryType: 'circle', requiredMatch: 75, description: '轻柔地顺时针和逆时针旋转手腕' },
  { day: 3, name: '握拳练习', trajectoryType: 'line', requiredMatch: 80, description: '缓慢握拳然后松开，重复10次' },
  { day: 4, name: '前臂旋转', trajectoryType: 'circle', requiredMatch: 75, description: '前臂做旋前旋后运动' },
  { day: 5, name: '腕部屈伸', trajectoryType: 'line', requiredMatch: 80, description: '手腕做上下屈伸运动' },
  { day: 6, name: '肘部摆动', trajectoryType: 'wave', requiredMatch: 70, description: '小幅度摆动肘部，感受肌肉拉伸' },
  { day: 7, name: '综合手指操', trajectoryType: 'wave', requiredMatch: 75, description: '依次活动每根手指，做复杂组合动作' },
  { day: 8, name: '肘部屈伸', trajectoryType: 'line', requiredMatch: 70, description: '缓慢弯曲和伸展肘部，逐渐增加幅度' },
  { day: 9, name: '肩部旋转', trajectoryType: 'circle', requiredMatch: 70, description: '小幅度旋转肩关节，避免用力' },
  { day: 10, name: '阻力训练', trajectoryType: 'line', requiredMatch: 75, description: '使用轻阻力进行握力训练' },
  { day: 11, name: '协调性练习', trajectoryType: 'wave', requiredMatch: 75, description: '配合手臂和手腕做协调运动' },
  { day: 12, name: '肘部强化', trajectoryType: 'circle', requiredMatch: 70, description: '增加肘部活动范围和力量' },
  { day: 13, name: '肩部拉伸', trajectoryType: 'line', requiredMatch: 70, description: '进行肩部各方向的拉伸练习' },
  { day: 14, name: '恢复评估', trajectoryType: 'wave', requiredMatch: 80, description: '综合动作评估，检查恢复程度' }
];

const generateMisalignedAngle = (targetAngle: number): number => {
  const offset = (Math.random() - 0.5) * 40;
  return targetAngle + offset;
};

const toFixationState = (materials: FixationMaterial[]): FixationState =>
  createFixationState(
    materials.map(material => ({
      id: material.id,
      name: material.name,
      type: material.type,
      order: material.order,
      correctPosition: material.correctPosition
    }))
  );

const applyFixationState = (
  materials: FixationMaterial[],
  state: FixationState
): FixationMaterial[] =>
  materials.map(material => ({
    ...material,
    placed: state.placedOrder.includes(material.id),
    position: state.positions[material.id] ?? ''
  }));

export const useGameStore = create<GameState>((set, get) => ({
  gamePhase: GamePhase.DIAGNOSIS,
  currentFracture: null,
  boneJoints: initialBoneJoints,
  fixationMaterials: initialFixationMaterials,
  rehabilitationActions: initialRehabilitationActions,
  completedDays: [],
  jointMobilityData: [],
  timeRemaining: 60,
  resetSuccess: false,
  showXRay: false,
  currentRehabDay: 1,
  particleEffects: [],
  angleAdjustments: [],
  reductionReport: null,
  lastFixationAttempt: null,

  randomizeFracture: () => {
    const fractureTypes = Object.values(FractureType);
    const randomFracture = fractureTypes[Math.floor(Math.random() * fractureTypes.length)];
    const plan = deriveReductionPlan(
      randomFracture,
      get().boneJoints.map(joint => joint.id)
    );

    let sequence = 0;
    const adjustments: JointAdjustment[] = [];
    const updatedJoints = get().boneJoints.map(joint => {
      const jointPlan = plan.joints.find(entry => entry.jointId === joint.id);
      const targetAngle = jointPlan?.targetAngle ?? 0;
      const currentAngle = generateMisalignedAngle(targetAngle);
      sequence += 1;
      adjustments.push({
        sequence,
        jointId: joint.id,
        angle: currentAngle,
        source: 'random'
      });
      return { ...joint, targetAngle, currentAngle };
    });

    const report = evaluateReduction(
      Object.fromEntries(updatedJoints.map(joint => [joint.id, joint.currentAngle])),
      plan
    );

    set({
      currentFracture: randomFracture,
      boneJoints: updatedJoints,
      angleAdjustments: adjustments,
      reductionReport: report,
      gamePhase: GamePhase.REDUCTION,
      timeRemaining: 60,
      resetSuccess: false,
      lastFixationAttempt: null
    });
  },

  updateBoneAngle: (jointId: string, angle: number, source: AngleSource = 'manual') => {
    set(state => {
      if (!state.currentFracture || !state.reductionReport) {
        return {
          boneJoints: state.boneJoints.map(joint =>
            joint.id === jointId ? { ...joint, currentAngle: angle } : joint
          )
        };
      }

      const plan = deriveReductionPlan(
        state.currentFracture,
        state.boneJoints.map(joint => joint.id)
      );
      const adjustment: JointAdjustment = {
        sequence: state.angleAdjustments.length + 1,
        jointId,
        angle,
        source
      };
      const report = reevaluateJoint(state.reductionReport, plan, jointId, angle);

      return {
        boneJoints: state.boneJoints.map(joint =>
          joint.id === jointId ? { ...joint, currentAngle: angle } : joint
        ),
        angleAdjustments: [...state.angleAdjustments, adjustment],
        reductionReport: report
      };
    });
  },

  checkResetSuccess: (): boolean => {
    const { currentFracture, boneJoints } = get();
    if (!currentFracture) return false;

    const plan = deriveReductionPlan(
      currentFracture,
      boneJoints.map(joint => joint.id)
    );
    const report = evaluateReduction(
      Object.fromEntries(boneJoints.map(joint => [joint.id, joint.currentAngle])),
      plan
    );

    if (report.allWithinTolerance) {
      set({ reductionReport: report, resetSuccess: true, gamePhase: GamePhase.FIXATION });
    } else {
      set({ reductionReport: report, resetSuccess: false });
    }

    return report.allWithinTolerance;
  },

  placeMaterial: (materialId: string, position: string): boolean => {
    const { fixationMaterials, resetSuccess } = get();

    const { state, attempt } = attemptPlacement(
      toFixationState(fixationMaterials),
      materialId,
      position,
      resetSuccess
    );
    const updatedMaterials = applyFixationState(fixationMaterials, state);
    const allPlaced = updatedMaterials.every(material => material.placed);

    set({
      fixationMaterials: updatedMaterials,
      lastFixationAttempt: attempt,
      gamePhase: attempt.accepted && allPlaced ? GamePhase.REHABILITATION : get().gamePhase
    });

    return attempt.accepted;
  },

  completeRehabDay: (day: number, matchPercentage: number) => {
    const { completedDays, jointMobilityData, rehabilitationActions } = get();

    if (completedDays.includes(day)) return;

    const action = rehabilitationActions.find(a => a.day === day);
    if (!action || matchPercentage < action.requiredMatch) return;

    const newCompletedDays = [...completedDays, day].sort((a, b) => a - b);
    const newMobilityData = [...jointMobilityData, Math.min(100, 60 + matchPercentage * 0.4)];

    const allCompleted = newCompletedDays.length === 14;

    set({
      completedDays: newCompletedDays,
      jointMobilityData: newMobilityData,
      currentRehabDay: allCompleted ? day : day + 1,
      gamePhase: allCompleted ? GamePhase.COMPLETE : GamePhase.REHABILITATION
    });
  },

  setGamePhase: (phase: GamePhase) => {
    set({ gamePhase: phase });
  },

  setShowXRay: (show: boolean) => {
    set({ showXRay: show });
  },

  decrementTimer: () => {
    set(state => ({
      timeRemaining: Math.max(0, state.timeRemaining - 1)
    }));
  },

  resetGame: () => {
    set({
      gamePhase: GamePhase.DIAGNOSIS,
      currentFracture: null,
      boneJoints: initialBoneJoints.map(joint => ({ ...joint })),
      fixationMaterials: initialFixationMaterials.map(mat => ({ ...mat, placed: false, position: '' })),
      rehabilitationActions: initialRehabilitationActions.map(action => ({ ...action })),
      completedDays: [],
      jointMobilityData: [],
      timeRemaining: 60,
      resetSuccess: false,
      showXRay: false,
      currentRehabDay: 1,
      particleEffects: [],
      angleAdjustments: [],
      reductionReport: null,
      lastFixationAttempt: null
    });
  },

  addParticleEffect: (particle: ParticleEffect) => {
    set(state => ({
      particleEffects: [...state.particleEffects, particle]
    }));
  },

  updateParticles: () => {
    set(state => ({
      particleEffects: state.particleEffects
        .map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          life: p.life - 1
        }))
        .filter(p => p.life > 0)
    }));
  }
}));
