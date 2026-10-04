/** 夹具加载与类型定义。夹具为固定 JSON，离线可读，不依赖网络。 */

import jointLimits from './fixtures/joint-limits.json' with { type: 'json' };
import limbChain from './fixtures/limb-chain.json' with { type: 'json' };
import figureComposition from './fixtures/figure-composition.json' with { type: 'json' };

export interface JointFixture {
  joint: { minDeg: number; maxDeg: number; damping: number; stiffness: number };
  settle: {
    maxSteps: number;
    angleToleranceDeg: number;
    velocityToleranceDegPerSec: number;
    holdSteps: number;
  };
  scenarios: Array<{
    name: string;
    targetDeg: number;
    expect: { clamped: boolean; settleAtDeg: number };
  }>;
  invalidTargets: string[];
  forceScenario: { forceDegPerSecSq: number; steps: number; expectSettleAtDeg: number };
}

export interface LimbChainFixture {
  chain: {
    origin: { x: number; y: number };
    upperLength: number;
    lowerLength: number;
    rootLimit: { minDeg: number; maxDeg: number };
    bendLimit: { minDeg: number; maxDeg: number };
  };
  ikCases: Array<{
    name: string;
    target: { x: number; y: number };
    bendSign: 1 | -1;
    expect: {
      rootAngleDeg: number;
      bendAngleDeg: number;
      end: { x: number; y: number };
      reachable: boolean;
      limited: boolean;
    };
  }>;
  restrictedChain: {
    origin: { x: number; y: number };
    upperLength: number;
    lowerLength: number;
    rootLimit: { minDeg: number; maxDeg: number };
    bendLimit: { minDeg: number; maxDeg: number };
    bendSign: 1 | -1;
  };
  restrictedCase: {
    name: string;
    target: { x: number; y: number };
    expect: {
      rootAngleDeg: number;
      bendAngleDeg: number;
      requiredBendDeg: number;
      elbow: { x: number; y: number };
      end: { x: number; y: number };
      reachable: boolean;
      limited: boolean;
    };
  };
  propagateChain: {
    nodes: Array<{ id: string; limit: { minDeg: number; maxDeg: number }; couplingToChild: number }>;
    cases: Array<{ name: string; rawDeltaDeg: number; expectRealized: number[]; expectBlocked: number[] }>;
  };
}

export interface FigureFixture {
  figure: {
    id: string;
    rootPlacement: { position: { x: number; y: number }; rotationDeg: number };
    parts: Array<{ id: string; type: string; length: number; anchor: { x: number; y: number } }>;
    bindings: Array<{
      id: string;
      childPartId: string;
      parentPartId: string | null;
      pivot: { x: number; y: number };
      minDeg: number;
      maxDeg: number;
    }>;
  };
  poses: Array<{
    name: string;
    jointAngles: Record<string, number>;
    expectClamped: string[];
    expectMissing: string[];
    expectParts: Record<
      string,
      { position: { x: number; y: number }; rotationDeg: number; tip: { x: number; y: number } }
    >;
  }>;
}

export const jointFixture = jointLimits as JointFixture;
export const limbChainFixture = limbChain as LimbChainFixture;
export const figureFixture = figureComposition as FigureFixture;
