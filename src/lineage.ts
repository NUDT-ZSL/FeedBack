import { Plant } from './plants.js';

export interface LineageNode {
  plant: Plant;
  isBase: boolean;
  hasDrift: boolean;
  stressTime: number;
  driftMagnitude: number;
  driftEpisodes: number;
}

export interface LineageTrace {
  rootId: string;
  nodes: LineageNode[];
  basePlants: LineageNode[];
  driftGenerations: LineageNode[];
  totalDriftMagnitude: number;
  totalStressTime: number;
  brokenLinks: string[];
  sharedAncestors: string[];
}

export class LineageBook {
  private plants: Map<string, Plant> = new Map();

  register(plant: Plant): void {
    this.plants.set(plant.id, plant);
  }

  registerAll(plants: Plant[]): void {
    for (const plant of plants) {
      this.register(plant);
    }
  }

  get(id: string): Plant | undefined {
    return this.plants.get(id);
  }

  trace(plantId: string): LineageTrace {
    const nodes = new Map<string, LineageNode>();
    const brokenLinks: string[] = [];
    const sharedAncestors: string[] = [];
    const visiting = new Set<string>();

    const visit = (id: string): void => {
      if (nodes.has(id)) {
        if (!sharedAncestors.includes(id)) {
          sharedAncestors.push(id);
        }
        return;
      }
      if (visiting.has(id)) {
        return;
      }
      visiting.add(id);

      const plant = this.plants.get(id);
      if (!plant) {
        brokenLinks.push(id);
        visiting.delete(id);
        return;
      }

      for (const parentId of plant.parentIds) {
        visit(parentId);
      }

      const cumulative = plant.getCumulativeDrift();
      nodes.set(id, {
        plant,
        isBase: plant.parentIds.length === 0,
        hasDrift: plant.hasEnvironmentalDrift(),
        stressTime: cumulative.stressTime,
        driftMagnitude: cumulative.traitMagnitude,
        driftEpisodes: plant.driftHistory.length + (plant.activeDrift ? 1 : 0),
      });
      visiting.delete(id);
    };

    visit(plantId);

    const ordered = Array.from(nodes.values()).sort(
      (a, b) => a.plant.generation - b.plant.generation
    );
    const driftGenerations = ordered.filter(n => n.hasDrift);

    return {
      rootId: plantId,
      nodes: ordered,
      basePlants: ordered.filter(n => n.isBase),
      driftGenerations,
      totalDriftMagnitude: driftGenerations.reduce((sum, n) => sum + n.driftMagnitude, 0),
      totalStressTime: driftGenerations.reduce((sum, n) => sum + n.stressTime, 0),
      brokenLinks,
      sharedAncestors,
    };
  }

  formatTrace(plantId: string): string {
    const trace = this.trace(plantId);
    const lines: string[] = [];
    const root = this.plants.get(plantId);
    lines.push(`谱系回溯: ${root ? root.name : plantId} (世代 ${root ? root.generation : '?'})`);
    lines.push(`  祖先节点: ${trace.nodes.length} 个, 基础植物: ${trace.basePlants.length} 个`);
    lines.push(
      `  漂移世代: ${trace.driftGenerations.length} 个, 累计漂移量: ${trace.totalDriftMagnitude.toFixed(2)}, 累计受压时长: ${trace.totalStressTime.toFixed(1)}s`
    );
    if (trace.brokenLinks.length > 0) {
      lines.push(`  断链: ${trace.brokenLinks.join(', ')}`);
    }
    if (trace.sharedAncestors.length > 0) {
      lines.push(`  共同祖先(仅计入一次): ${trace.sharedAncestors.length} 个`);
    }
    for (const node of trace.nodes) {
      const p = node.plant;
      const driftTag = node.hasDrift
        ? ` [漂移: 量级${node.driftMagnitude.toFixed(2)}, 受压${node.stressTime.toFixed(1)}s, ${node.driftEpisodes}段]`
        : '';
      const baseTag = node.isBase ? ' (基础植物)' : '';
      lines.push(
        `  - G${p.generation} ${p.name} ${p.id.slice(0, 14)}… 亲本[${p.parentIds.length}]${baseTag}${driftTag}`
      );
    }
    return lines.join('\n');
  }
}
