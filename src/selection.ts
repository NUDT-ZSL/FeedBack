import type { BuildingData, CityBuilder } from './cityBuilder';

export interface SelectionPanelHooks {
  showPanel: (building: BuildingData) => void;
  hidePanel: () => void;
}

export class SelectionController {
  private selected: BuildingData | null = null;

  constructor(
    private cityBuilder: CityBuilder,
    private hooks: SelectionPanelHooks
  ) {}

  get selectedId(): string | null {
    return this.selected?.id ?? null;
  }

  handleBuildingClick(building: BuildingData): void {
    if (this.selected?.id === building.id) {
      this.clear();
    } else {
      this.select(building);
    }
  }

  select(building: BuildingData): void {
    if (this.cityBuilder.getBuilding(building.id) !== building) {
      return;
    }
    if (this.selected && this.selected.id !== building.id) {
      this.cityBuilder.setHighlighted(this.selected, false);
    }
    this.selected = building;
    this.cityBuilder.setHighlighted(building, true);
    this.hooks.showPanel(building);
  }

  clear(): void {
    if (this.selected) {
      this.cityBuilder.setHighlighted(this.selected, false);
      this.selected = null;
    }
    this.hooks.hidePanel();
  }

  handleBuildingRemoved(building: BuildingData): void {
    if (this.selected?.id === building.id) {
      this.selected = null;
      this.hooks.hidePanel();
    }
  }
}
