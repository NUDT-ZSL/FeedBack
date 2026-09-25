import * as THREE from 'three';
import { BarCollection } from './barCollection';
import { InteractionState } from './interactionState';

/**
 * 输入控制层：监听画布鼠标事件并执行射线检测，
 * 把结果转交给 InteractionState，自身不保存任何交互状态。
 */
export class InteractionController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2(-999, -999);

  constructor(
    private readonly canvas: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly state: InteractionState,
    private readonly collection: BarCollection,
  ) {}

  attach(): void {
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
  }

  detach(): void {
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
  }

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.performRaycast(e.clientX, e.clientY);
  };

  private onClick = (): void => {
    const hovered = this.state.hoveredBar;
    if (hovered) {
      this.state.handleBarClick(hovered);
    } else if (this.state.isDetailMode) {
      this.state.exitDetail();
    }
  };

  private onMouseLeave = (): void => {
    this.mouse.set(-999, -999);
    this.state.setHovered(null);
  };

  private performRaycast(screenX: number, screenY: number): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.collection.raycastTargets());

    if (intersects.length > 0) {
      const bar = this.collection.findByBody(intersects[0].object);
      if (bar) {
        this.state.setHovered(bar, screenX, screenY);
      }
      // 命中了非主体对象（如边线）时保持当前悬停不变，与原行为一致。
      return;
    }
    this.state.setHovered(null);
  }
}
