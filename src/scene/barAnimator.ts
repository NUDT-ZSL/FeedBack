import * as THREE from 'three';
import { BarMeshGroup } from './types';

/**
 * 动画层：每帧把柱体的透明度/缩放/位置/辉光
 * 向各自目标值插值，并写回材质与变换。
 */
export class BarAnimator {
  private readonly lerpSpeed = 0.08;

  update(bars: readonly BarMeshGroup[], baseOpacity: number): void {
    for (const bar of bars) {
      const target = bar.targetOpacity * baseOpacity;
      bar.currentOpacity += (target - bar.currentOpacity) * this.lerpSpeed;

      const bodyMat = bar.body.material as THREE.MeshPhongMaterial;
      bodyMat.opacity = bar.currentOpacity;

      const edgeMat = bar.edgeLines.material as THREE.LineBasicMaterial;
      edgeMat.opacity = bar.currentOpacity * 0.35;

      const wickTopMat = bar.wickTop.material as THREE.MeshPhongMaterial;
      wickTopMat.opacity = bar.currentOpacity;
      const wickBotMat = bar.wickBottom.material as THREE.MeshPhongMaterial;
      wickBotMat.opacity = bar.currentOpacity;

      const volMat = bar.volumeMesh.material as THREE.MeshPhongMaterial;
      volMat.opacity = bar.currentOpacity * 0.45;

      bar.currentScale.lerp(bar.targetScale, this.lerpSpeed);
      bar.body.scale.copy(bar.currentScale);
      bar.wickTop.scale.copy(bar.currentScale);
      bar.wickBottom.scale.copy(bar.currentScale);
      bar.volumeMesh.scale.copy(bar.currentScale);

      bar.currentPosX += (bar.targetPosX - bar.currentPosX) * this.lerpSpeed;
      const posX = bar.currentPosX;
      bar.body.position.x = posX;
      bar.wickTop.position.x = posX;
      bar.wickBottom.position.x = posX;
      bar.volumeMesh.position.x = posX;

      if (bar.isHighlighted) {
        bar.glowIntensity = Math.min(bar.glowIntensity + 0.05, 1);
      } else {
        bar.glowIntensity = Math.max(bar.glowIntensity - 0.05, 0);
      }

      const glow = bar.glowIntensity * 0.5;
      bodyMat.emissiveIntensity = 0.15 + glow;
    }
  }
}
