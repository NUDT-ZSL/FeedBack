import type { BambooStrip, LanternType, Node, SilkPanel, SkeletonTemplate } from '../types.ts';

const makeNode = (id: string, x: number, y: number, z = 0): Node => ({ id, x, y, z, isDragging: false });

const makeStrip = (id: string, startNodeId: string, endNodeId: string): BambooStrip => ({
  id,
  startNodeId,
  endNodeId,
  isConnected: true,
  highlighted: false,
});

const makePanel = (id: string, nodeIds: string[]): SilkPanel => ({
  id,
  nodeIds,
  color: 'moonWhite',
  pastingProgress: 0,
  tension: 0,
  isDetached: false,
});

/**
 * 竹条方向表示拼装依赖顺序（startNodeId 先于 endNodeId 落位），
 * 模板内所有竹条按“无环依赖”定向，保证 inferStructure 对合法模板给出 valid 结论。
 */
function palaceTemplate(): SkeletonTemplate {
  const nodes: Node[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i;
    nodes.push(makeNode(`ring-${i}`, 100 * Math.cos(angle), 0, 100 * Math.sin(angle)));
  }
  nodes.push(makeNode('apex-top', 0, 120));
  nodes.push(makeNode('apex-bottom', 0, -120));

  const connections: BambooStrip[] = [];
  for (let i = 0; i < 5; i += 1) connections.push(makeStrip(`palace-ring-${i}`, `ring-${i}`, `ring-${i + 1}`));
  connections.push(makeStrip('palace-ring-5', 'ring-0', 'ring-5'));
  for (let i = 0; i < 6; i += 1) {
    connections.push(makeStrip(`palace-spoke-bottom-${i}`, 'apex-bottom', `ring-${i}`));
    connections.push(makeStrip(`palace-spoke-top-${i}`, `ring-${i}`, 'apex-top'));
  }

  const silkPanels: SilkPanel[] = [];
  for (let i = 0; i < 6; i += 1) {
    silkPanels.push(
      makePanel(`palace-panel-${i}`, [`ring-${i}`, `ring-${(i + 1) % 6}`, 'apex-top', 'apex-bottom']),
    );
  }
  return { type: 'palace', name: '宫灯', nodes, connections, silkPanels };
}

function revolvingTemplate(): SkeletonTemplate {
  const nodes: Node[] = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = (Math.PI / 8) * i;
    nodes.push(makeNode(`lower-${i}`, 90 * Math.cos(angle), -120, 90 * Math.sin(angle)));
    nodes.push(makeNode(`upper-${i}`, 90 * Math.cos(angle), 120, 90 * Math.sin(angle)));
  }

  const connections: BambooStrip[] = [];
  for (let i = 0; i < 15; i += 1) {
    connections.push(makeStrip(`revolving-lower-${i}`, `lower-${i}`, `lower-${i + 1}`));
    connections.push(makeStrip(`revolving-upper-${i}`, `upper-${i}`, `upper-${i + 1}`));
  }
  connections.push(makeStrip('revolving-lower-15', 'lower-0', 'lower-15'));
  connections.push(makeStrip('revolving-upper-15', 'upper-0', 'upper-15'));
  for (let i = 0; i < 16; i += 1) {
    connections.push(makeStrip(`revolving-post-${i}`, `lower-${i}`, `upper-${i}`));
  }

  const silkPanels: SilkPanel[] = [];
  for (let i = 0; i < 16; i += 1) {
    silkPanels.push(
      makePanel(`revolving-panel-${i}`, [
        `lower-${i}`,
        `lower-${(i + 1) % 16}`,
        `upper-${(i + 1) % 16}`,
        `upper-${i}`,
      ]),
    );
  }
  return { type: 'revolving', name: '走马灯', nodes, connections, silkPanels };
}

function silkTemplate(): SkeletonTemplate {
  const nodes: Node[] = [];
  const corners: Array<[string, number, number, number]> = [
    ['b0', -100, -100, -100],
    ['b1', 100, -100, -100],
    ['b2', 100, -100, 100],
    ['b3', -100, -100, 100],
    ['t0', -100, 100, -100],
    ['t1', 100, 100, -100],
    ['t2', 100, 100, 100],
    ['t3', -100, 100, 100],
  ];
  for (const [id, x, y, z] of corners) nodes.push(makeNode(id, x, y, z));

  const connections: BambooStrip[] = [
    makeStrip('silk-bottom-0', 'b0', 'b1'),
    makeStrip('silk-bottom-1', 'b1', 'b2'),
    makeStrip('silk-bottom-2', 'b2', 'b3'),
    makeStrip('silk-bottom-3', 'b0', 'b3'),
    makeStrip('silk-top-0', 't0', 't1'),
    makeStrip('silk-top-1', 't1', 't2'),
    makeStrip('silk-top-2', 't2', 't3'),
    makeStrip('silk-top-3', 't0', 't3'),
    makeStrip('silk-post-0', 'b0', 't0'),
    makeStrip('silk-post-1', 'b1', 't1'),
    makeStrip('silk-post-2', 'b2', 't2'),
    makeStrip('silk-post-3', 'b3', 't3'),
  ];

  const silkPanels: SilkPanel[] = [
    makePanel('silk-panel-front', ['b0', 'b1', 't1', 't0']),
    makePanel('silk-panel-right', ['b1', 'b2', 't2', 't1']),
    makePanel('silk-panel-back', ['b2', 'b3', 't3', 't2']),
    makePanel('silk-panel-left', ['b3', 'b0', 't0', 't3']),
    makePanel('silk-panel-top', ['t0', 't1', 't2', 't3']),
    makePanel('silk-panel-bottom', ['b3', 'b2', 'b1', 'b0']),
  ];
  return { type: 'silk', name: '纱灯', nodes, connections, silkPanels };
}

export function createTemplate(type: LanternType): SkeletonTemplate {
  switch (type) {
    case 'palace':
      return palaceTemplate();
    case 'revolving':
      return revolvingTemplate();
    case 'silk':
      return silkTemplate();
  }
}
