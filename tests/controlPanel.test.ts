// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/core/SceneManager', () => ({
  sceneManager: {
    domElement: document.createElement('canvas'),
    fps: 60,
    addObject: vi.fn(),
    removeObject: vi.fn(),
    getAmbientLight: () => null,
    getGroundPlane: () => null,
    raycastFromScreen: () => null,
  },
}));

import { buildingSystem } from '../src/modules/building/BuildingSystem';
import { controlPanel } from '../src/ui/ControlPanel';

vi.stubGlobal('confirm', vi.fn(() => true));
vi.stubGlobal('alert', vi.fn());

interface PanelInternals {
  _selectedBuildings: Set<string>;
  _selectedBuildingId: string | null;
  _buildingList: HTMLElement;
  _handleBulkDelete: () => void;
}

const panel = controlPanel as unknown as PanelInternals;

function clearAllBuildings(): void {
  for (const b of buildingSystem.getBuildings()) {
    buildingSystem.removeBuilding(b.id);
  }
  panel._selectedBuildings.clear();
  panel._selectedBuildingId = null;
}

beforeEach(() => {
  clearAllBuildings();
});

describe('选中状态与建筑列表一致性', () => {
  it('删除建筑后选中集合与激活选中同步清理', () => {
    const b1 = buildingSystem.addBuilding(0, 0, 20, 0)!;
    const b2 = buildingSystem.addBuilding(20, 0, 30, 1)!;

    panel._selectedBuildings.add(b1.id);
    panel._selectedBuildings.add(b2.id);
    panel._selectedBuildings.add('ghost_id');
    panel._selectedBuildingId = b1.id;

    buildingSystem.removeBuilding(b1.id);

    expect(panel._selectedBuildings.has(b1.id)).toBe(false);
    expect(panel._selectedBuildings.has('ghost_id')).toBe(false);
    expect(panel._selectedBuildings.has(b2.id)).toBe(true);
    expect(panel._selectedBuildingId).toBeNull();
  });

  it('批量删除混有失效 id：有效建筑被删净，选中集合清空', () => {
    const b1 = buildingSystem.addBuilding(0, 0, 20, 0)!;
    const b2 = buildingSystem.addBuilding(20, 0, 30, 1)!;
    const b3 = buildingSystem.addBuilding(40, 0, 40, 2)!;

    panel._selectedBuildings.add(b1.id);
    panel._selectedBuildings.add(b2.id);
    panel._selectedBuildings.add('ghost_id');
    panel._selectedBuildingId = b2.id;

    panel._handleBulkDelete();

    expect(buildingSystem.getBuildingById(b1.id)).toBeUndefined();
    expect(buildingSystem.getBuildingById(b2.id)).toBeUndefined();
    expect(buildingSystem.getBuildingById(b3.id)).toBeDefined();
    expect(buildingSystem.getBuildingCount()).toBe(1);
    expect(panel._selectedBuildings.size).toBe(0);
    expect(panel._selectedBuildingId).toBeNull();
  });

  it('选中集合只剩失效 id 时批量删除不执行且不误报数量', () => {
    const b1 = buildingSystem.addBuilding(0, 0, 20, 0)!;

    panel._selectedBuildings.add('ghost_only');

    panel._handleBulkDelete();

    expect(alert).toHaveBeenCalled();
    expect(buildingSystem.getBuildingById(b1.id)).toBeDefined();
    expect(panel._selectedBuildings.size).toBe(0);
  });

  it('删除后建筑列表 UI 与剩余建筑对应', async () => {
    const b1 = buildingSystem.addBuilding(0, 0, 20, 0)!;
    buildingSystem.addBuilding(20, 0, 30, 1);

    buildingSystem.removeBuilding(b1.id);

    await vi.waitFor(() => {
      expect(panel._buildingList.textContent).toContain('共 1 栋建筑');
      expect(panel._buildingList.textContent).not.toContain(b1.id);
    });
  });
});
