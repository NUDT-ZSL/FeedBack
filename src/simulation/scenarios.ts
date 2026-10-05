/**
 * 本地样例数据：基准参数与批量验证场景。
 * 全部为离线内置数据，不依赖任何在线服务或外部账号。
 */
import type { SimulationParams } from './types.ts';

/** 基准推演参数：三条渠道、四块田 */
export function baseParams(): SimulationParams {
  return {
    upstreamInflow: 6,
    wheel: { gateOpening: 50, sailAngle: 45, liftCoefficient: 10 },
    channels: [
      { id: 'ch-east', name: '东渠', ratio: 0.4 },
      { id: 'ch-west', name: '西渠', ratio: 0.35 },
      { id: 'ch-south', name: '南渠', ratio: 0.25 },
    ],
    fields: [
      {
        id: 'field-a', name: '东坡田', channelId: 'ch-east',
        capacity: 40, cropThreshold: 0.3, consumptionRate: 1.2, initialStorage: 20,
      },
      {
        id: 'field-b', name: '西畦田', channelId: 'ch-west',
        capacity: 30, cropThreshold: 0.35, consumptionRate: 1.0, initialStorage: 12,
      },
      {
        id: 'field-c', name: '南畈田', channelId: 'ch-south',
        capacity: 50, cropThreshold: 0.25, consumptionRate: 1.5, initialStorage: 25,
      },
      {
        id: 'field-d', name: '南坡梯田', channelId: 'ch-south',
        capacity: 24, cropThreshold: 0.4, consumptionRate: 0.9, initialStorage: 10,
      },
    ],
    ticks: 24,
  };
}

export type ParamPatch = (params: SimulationParams) => SimulationParams;

export interface Scenario {
  id: string;
  title: string;
  description: string;
  patch: ParamPatch;
}

function cloneParams(params: SimulationParams): SimulationParams {
  return {
    ...params,
    wheel: { ...params.wheel },
    channels: params.channels.map((c) => ({ ...c })),
    fields: params.fields.map((f) => ({ ...f })),
  };
}

function patchChannelRatio(channelId: string, ratio: number): ParamPatch {
  return (params) => {
    const next = cloneParams(params);
    for (const channel of next.channels) {
      if (channel.id === channelId) channel.ratio = ratio;
    }
    return next;
  };
}

function patchField(fieldId: string, changes: Partial<{ capacity: number; cropThreshold: number }>): ParamPatch {
  return (params) => {
    const next = cloneParams(params);
    for (const field of next.fields) {
      if (field.id === fieldId) Object.assign(field, changes);
    }
    return next;
  };
}

/** 批量验证场景：覆盖来水、分流比例、田块容量、作物阈值四类调整 */
export function scenarios(): Scenario[] {
  return [
    {
      id: 'inflow-up',
      title: '上游来水增加',
      description: '上游来水量 6 → 9，全部渠道与田块应连锁更新',
      patch: (params) => ({ ...cloneParams(params), upstreamInflow: 9 }),
    },
    {
      id: 'ratio-east-down',
      title: '东渠分流下调',
      description: '东渠分流比例 0.40 → 0.20，仅东渠挂接田块受影响',
      patch: patchChannelRatio('ch-east', 0.2),
    },
    {
      id: 'capacity-field-b',
      title: '西畦田扩容',
      description: '西畦田容量 30 → 45，仅该田块蓄水率与缺水判定变化',
      patch: patchField('field-b', { capacity: 45 }),
    },
    {
      id: 'threshold-field-c',
      title: '南畈田阈值上调',
      description: '南畈田作物需水阈值 0.25 → 0.55，缺水判定收紧',
      patch: patchField('field-c', { cropThreshold: 0.55 }),
    },
    {
      id: 'wheel-boost',
      title: '水车满负荷',
      description: '闸门开度 50 → 90、风帆角度 45 → 80，提水量上升影响全部田块',
      patch: (params) => {
        const next = cloneParams(params);
        next.wheel.gateOpening = 90;
        next.wheel.sailAngle = 80;
        return next;
      },
    },
  ];
}
