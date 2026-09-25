// src/cityBuilder.ts
import * as THREE from "three";
var colorThemes = {
  sunset: ["#ff6b35", "#f7c59f", "#ef476f", "#9b5de5", "#7209b7", "#f72585"],
  cyberpunk: ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440", "#00ff88"],
  nordic: ["#f8f9fa", "#e9ecef", "#dee2e6", "#adb5bd", "#6c757d", "#a8dadc"]
};
var CityBuilder = class {
  scene;
  buildings = /* @__PURE__ */ new Map();
  params;
  fog;
  pendingTimeouts = /* @__PURE__ */ new Set();
  animations = /* @__PURE__ */ new Set();
  animLoopId = null;
  buildingCancels = /* @__PURE__ */ new Map();
  colorCancel = null;
  generationToken = 0;
  constructor(scene, initialParams = {}) {
    this.scene = scene;
    this.params = {
      gridSize: 10,
      density: 0.7,
      buildingSpacing: 2.5,
      minHeight: 5,
      maxHeight: 50,
      heightDistribution: "pyramid",
      colorTheme: "sunset",
      ...initialParams
    };
    this.fog = new THREE.Fog(1708096, 30, 150);
    this.scene.fog = this.fog;
    this.updateFogDensity();
  }
  getParams() {
    return { ...this.params };
  }
  updateParams(newParams) {
    const old = { ...this.params };
    Object.assign(this.params, newParams);
    const countChanged = "density" in newParams && old.density !== this.params.density || "gridSize" in newParams && old.gridSize !== this.params.gridSize;
    const heightChanged = "heightDistribution" in newParams && old.heightDistribution !== this.params.heightDistribution || "minHeight" in newParams && old.minHeight !== this.params.minHeight || "maxHeight" in newParams && old.maxHeight !== this.params.maxHeight;
    const themeChanged = "colorTheme" in newParams && old.colorTheme !== this.params.colorTheme;
    const layoutChanged = "buildingSpacing" in newParams && old.buildingSpacing !== this.params.buildingSpacing || "gridSize" in newParams && old.gridSize !== this.params.gridSize;
    if (layoutChanged) this.repositionBuildings();
    if (countChanged) this.syncBuildingCount();
    if (heightChanged) this.refreshHeights();
    if (themeChanged) this.animateColorTransition();
    this.updateFogDensity();
  }
  updateFogDensity() {
    const fogNear = 30 + (1 - this.params.density) * 40;
    const fogFar = 120 + (1 - this.params.density) * 60;
    this.fog.near = fogNear;
    this.fog.far = fogFar;
  }
  getBuildings() {
    return Array.from(this.buildings.values());
  }
  getBuildingById(id) {
    return this.buildings.get(id);
  }
  generateCity() {
    this.cancelPendingWork();
    this.clearCity();
    this.createGround();
    const token = this.generationToken;
    const totalCells = this.params.gridSize * this.params.gridSize;
    const targetBuildings = Math.floor(totalCells * this.params.density);
    const positions = [];
    for (let x = 0; x < this.params.gridSize; x++) {
      for (let z = 0; z < this.params.gridSize; z++) {
        const centerDist = Math.sqrt(
          Math.pow(x - (this.params.gridSize - 1) / 2, 2) + Math.pow(z - (this.params.gridSize - 1) / 2, 2)
        );
        const priority = Math.random() + (1 - centerDist / this.params.gridSize) * 0.5;
        positions.push({ x, z, priority });
      }
    }
    positions.sort((a, b) => b.priority - a.priority);
    const selectedPositions = positions.slice(0, targetBuildings);
    selectedPositions.forEach((pos, index) => {
      this.schedule(() => {
        if (token !== this.generationToken) return;
        this.createBuilding(pos.x, pos.z, "rise");
      }, index * 30);
    });
  }
  schedule(callback, delayMs) {
    const id = window.setTimeout(() => {
      this.pendingTimeouts.delete(id);
      callback();
    }, delayMs);
    this.pendingTimeouts.add(id);
  }
  clearPendingTimeouts() {
    this.pendingTimeouts.forEach((id) => clearTimeout(id));
    this.pendingTimeouts.clear();
  }
  cancelPendingWork() {
    this.clearPendingTimeouts();
    this.animations.clear();
    this.buildingCancels.clear();
    this.colorCancel = null;
    this.generationToken++;
  }
  syncBuildingCount() {
    this.clearPendingTimeouts();
    const falling = [];
    this.buildings.forEach((building) => {
      if (building.animationType === "fall") {
        falling.push(building);
      } else if (building.animationType === "rise" || building.animationType === "morph") {
        this.cancelBuildingAnimation(building);
        this.snapToFullHeight(building);
      }
    });
    const totalCells = this.params.gridSize * this.params.gridSize;
    const targetCount = Math.floor(totalCells * this.params.density);
    let activeCount = this.buildings.size - falling.length;
    if (activeCount < targetCount && falling.length > 0) {
      const reviveCount = Math.min(targetCount - activeCount, falling.length);
      for (let i = 0; i < reviveCount; i++) {
        const building = falling[i];
        this.cancelBuildingAnimation(building);
        this.animateBuildingRise(building, 0.5, Math.max(building.mesh.scale.y, 0.01));
      }
      activeCount += reviveCount;
      falling.splice(0, reviveCount);
    }
    const token = this.generationToken;
    if (activeCount < targetCount) {
      const existingPositions = new Set(
        this.getBuildings().map((b) => `${b.gridX},${b.gridZ}`)
      );
      const availablePositions = [];
      for (let x = 0; x < this.params.gridSize; x++) {
        for (let z = 0; z < this.params.gridSize; z++) {
          if (!existingPositions.has(`${x},${z}`)) {
            const centerDist = Math.sqrt(
              Math.pow(x - (this.params.gridSize - 1) / 2, 2) + Math.pow(z - (this.params.gridSize - 1) / 2, 2)
            );
            const priority = Math.random() + (1 - centerDist / this.params.gridSize) * 0.5;
            availablePositions.push({ x, z, priority });
          }
        }
      }
      availablePositions.sort((a, b) => b.priority - a.priority);
      const toAdd = availablePositions.slice(0, targetCount - activeCount);
      toAdd.forEach((pos, index) => {
        this.schedule(() => {
          if (token !== this.generationToken) return;
          if (this.buildings.has(`${pos.x}-${pos.z}`)) return;
          this.createBuilding(pos.x, pos.z, "rise", 0.8);
        }, index * 20);
      });
    } else if (activeCount > targetCount) {
      const buildingsArray = this.getBuildings().filter((b) => b.animationType !== "fall");
      buildingsArray.sort(() => Math.random() - 0.5);
      const toRemove = buildingsArray.slice(0, activeCount - targetCount);
      toRemove.forEach((building, index) => {
        this.schedule(() => {
          if (token !== this.generationToken) return;
          this.removeBuilding(building, 0.8);
        }, index * 20);
      });
    }
  }
  createGround() {
    this.removeGround();
    const groundSize = this.params.gridSize * this.params.buildingSpacing + 10;
    const gridHelper = new THREE.GridHelper(groundSize, Math.floor(groundSize), 4473958, 3355477);
    gridHelper.position.y = 0;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.4;
    gridHelper.name = "ground";
    this.scene.add(gridHelper);
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMaterial = new THREE.MeshBasicMaterial({
      color: 1380400,
      transparent: true,
      opacity: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.name = "groundPlane";
    this.scene.add(ground);
  }
  removeGround() {
    const ground = this.scene.getObjectByName("ground");
    if (ground) {
      this.scene.remove(ground);
      const helper = ground;
      helper.geometry.dispose();
      helper.material.dispose();
    }
    const groundPlane = this.scene.getObjectByName("groundPlane");
    if (groundPlane) {
      this.scene.remove(groundPlane);
      const plane = groundPlane;
      plane.geometry.dispose();
      plane.material.dispose();
    }
  }
  repositionBuildings() {
    const offset = (this.params.gridSize - 1) * this.params.buildingSpacing / 2;
    this.buildings.forEach((building) => {
      const x = building.gridX * this.params.buildingSpacing - offset;
      const z = building.gridZ * this.params.buildingSpacing - offset;
      building.mesh.position.x = x;
      building.mesh.position.z = z;
      building.glowMesh.position.x = x;
      building.glowMesh.position.z = z;
    });
    this.createGround();
  }
  generateHeight(gridX, gridZ) {
    const { minHeight, maxHeight, heightDistribution, gridSize } = this.params;
    const range = maxHeight - minHeight;
    switch (heightDistribution) {
      case "uniform":
        return minHeight + Math.random() * range;
      case "pyramid": {
        const centerX = (gridSize - 1) / 2;
        const centerZ = (gridSize - 1) / 2;
        const maxDist = Math.sqrt(centerX * centerX + centerZ * centerZ);
        const dist = Math.sqrt(
          Math.pow(gridX - centerX, 2) + Math.pow(gridZ - centerZ, 2)
        );
        const heightFactor = 1 - dist / maxDist * 0.7;
        return minHeight + range * heightFactor * (0.7 + Math.random() * 0.3);
      }
      case "random": {
        const rand = Math.random();
        if (rand < 0.6) {
          return minHeight + Math.random() * range * 0.4;
        } else if (rand < 0.9) {
          return minHeight + range * 0.3 + Math.random() * range * 0.5;
        } else {
          return minHeight + range * 0.7 + Math.random() * range * 0.3;
        }
      }
      default:
        return minHeight + Math.random() * range;
    }
  }
  getRandomColor() {
    const colors = colorThemes[this.params.colorTheme];
    const colorStr = colors[Math.floor(Math.random() * colors.length)];
    return new THREE.Color(colorStr);
  }
  createBuilding(gridX, gridZ, animationType = "rise", animationDuration = 1.5) {
    const id = `${gridX}-${gridZ}`;
    const existing = this.buildings.get(id);
    if (existing) {
      this.disposeBuilding(existing);
    }
    const height = this.generateHeight(gridX, gridZ);
    const width = 0.8 + Math.random() * 0.6;
    const depth = 0.8 + Math.random() * 0.6;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const color = this.getRandomColor();
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.1),
      shininess: 30,
      specular: 4473924
    });
    const mesh = new THREE.Mesh(geometry, material);
    const offset = (this.params.gridSize - 1) * this.params.buildingSpacing / 2;
    mesh.position.x = gridX * this.params.buildingSpacing - offset;
    mesh.position.y = height / 2;
    mesh.position.z = gridZ * this.params.buildingSpacing - offset;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const glowGeometry = new THREE.BoxGeometry(width * 1.05, 0.3, depth * 1.05);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.5),
      transparent: true,
      opacity: 0.8
    });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.position.x = mesh.position.x;
    glowMesh.position.y = height + 0.15;
    glowMesh.position.z = mesh.position.z;
    this.scene.add(mesh);
    this.scene.add(glowMesh);
    const building = {
      id,
      mesh,
      glowMesh,
      gridX,
      gridZ,
      height,
      width,
      depth,
      color: color.clone(),
      targetColor: color.clone(),
      isAnimating: animationType === "rise",
      animationProgress: animationType === "rise" ? 0 : 1,
      animationType: animationType === "rise" ? "rise" : "none"
    };
    this.buildings.set(id, building);
    if (animationType === "rise") {
      mesh.scale.y = 0.01;
      mesh.position.y = 0.01;
      glowMesh.visible = false;
      this.animateBuildingRise(building, animationDuration, 0.01);
    }
    return building;
  }
  ensureAnimLoop() {
    if (this.animLoopId !== null) return;
    const loop = (now) => {
      this.animations.forEach((anim) => {
        if (!anim(now)) this.animations.delete(anim);
      });
      this.animLoopId = this.animations.size > 0 ? requestAnimationFrame(loop) : null;
    };
    this.animLoopId = requestAnimationFrame(loop);
  }
  runAnimation(update) {
    this.animations.add(update);
    this.ensureAnimLoop();
  }
  startBuildingAnimation(building, update) {
    this.cancelBuildingAnimation(building);
    let cancelled = false;
    this.buildingCancels.set(building.id, () => {
      cancelled = true;
    });
    this.runAnimation((now) => !cancelled && update(now));
  }
  cancelBuildingAnimation(building) {
    const cancel = this.buildingCancels.get(building.id);
    if (cancel) {
      cancel();
      this.buildingCancels.delete(building.id);
    }
    building.isAnimating = false;
    building.animationType = "none";
  }
  snapToFullHeight(building) {
    const geo = building.mesh.geometry;
    if (geo.parameters.height !== building.height) {
      geo.dispose();
      building.mesh.geometry = new THREE.BoxGeometry(building.width, building.height, building.depth);
    }
    building.mesh.scale.y = 1;
    building.mesh.position.y = building.height / 2;
    building.glowMesh.visible = true;
    building.glowMesh.position.y = building.height + 0.15;
    building.glowMesh.material.opacity = 0.8;
    building.animationProgress = 1;
  }
  disposeBuilding(building) {
    this.cancelBuildingAnimation(building);
    this.scene.remove(building.mesh);
    this.scene.remove(building.glowMesh);
    building.mesh.geometry.dispose();
    building.mesh.material.dispose();
    building.glowMesh.geometry.dispose();
    building.glowMesh.material.dispose();
    this.buildings.delete(building.id);
  }
  animateBuildingRise(building, duration, startScale = 0.01) {
    const startTime = performance.now();
    const glowMaterial = building.glowMesh.material;
    this.startBuildingAnimation(building, (now) => {
      const elapsed = (now - startTime) / 1e3;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutBack(progress);
      const scale = Math.max(startScale + (1 - startScale) * eased, 0.01);
      building.mesh.scale.y = scale;
      building.mesh.position.y = Math.max(building.height * scale / 2, 0.01);
      building.animationProgress = progress;
      if (progress > 0.7) {
        building.glowMesh.visible = true;
        glowMaterial.opacity = (progress - 0.7) / 0.3 * 0.8;
      }
      if (progress >= 1) {
        this.snapToFullHeight(building);
        building.isAnimating = false;
        building.animationType = "none";
        return false;
      }
      return true;
    });
    building.isAnimating = true;
    building.animationType = "rise";
  }
  removeBuilding(building, duration = 0.8) {
    if (!this.buildings.has(building.id)) return;
    this.cancelBuildingAnimation(building);
    const startTime = performance.now();
    const startScale = building.mesh.scale.y;
    const startY = building.mesh.position.y;
    const glowMaterial = building.glowMesh.material;
    this.startBuildingAnimation(building, (now) => {
      const elapsed = (now - startTime) / 1e3;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeInBack(progress);
      building.mesh.scale.y = Math.max(startScale * (1 - eased), 1e-4);
      building.mesh.position.y = startY * (1 - eased);
      glowMaterial.opacity = 0.8 * (1 - eased);
      building.animationProgress = progress;
      if (progress >= 1) {
        this.disposeBuilding(building);
        return false;
      }
      return true;
    });
    building.isAnimating = true;
    building.animationType = "fall";
  }
  refreshHeights() {
    this.buildings.forEach((building) => {
      if (building.animationType === "fall") return;
      const newHeight = this.generateHeight(building.gridX, building.gridZ);
      this.animateHeightMorph(building, newHeight, 0.8);
    });
  }
  animateHeightMorph(building, newHeight, duration) {
    this.cancelBuildingAnimation(building);
    const geoHeight = building.mesh.geometry.parameters.height;
    const startVisual = geoHeight * building.mesh.scale.y;
    const startTime = performance.now();
    this.startBuildingAnimation(building, (now) => {
      const elapsed = (now - startTime) / 1e3;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const visual = Math.max(startVisual + (newHeight - startVisual) * eased, 0.01);
      building.mesh.scale.y = visual / geoHeight;
      building.mesh.position.y = visual / 2;
      building.glowMesh.visible = true;
      building.glowMesh.position.y = visual + 0.15;
      building.animationProgress = progress;
      if (progress >= 1) {
        this.snapToFullHeight(building);
        building.isAnimating = false;
        building.animationType = "none";
        return false;
      }
      return true;
    });
    building.height = newHeight;
    building.isAnimating = true;
    building.animationType = "morph";
  }
  animateColorTransition(duration = 1.2) {
    if (this.colorCancel) {
      this.colorCancel();
      this.colorCancel = null;
    }
    const entries = this.getBuildings().filter((b) => b.animationType !== "fall").map((building) => {
      building.targetColor = this.getRandomColor();
      return {
        building,
        start: building.color.clone(),
        target: building.targetColor.clone()
      };
    });
    if (entries.length === 0) return;
    const startTime = performance.now();
    let cancelled = false;
    this.colorCancel = () => {
      cancelled = true;
    };
    this.runAnimation((now) => {
      if (cancelled) return false;
      const elapsed = (now - startTime) / 1e3;
      const progress = Math.min(elapsed / duration, 1);
      entries.forEach(({ building, start, target }) => {
        building.color.lerpColors(start, target, progress);
        const material = building.mesh.material;
        material.color.copy(building.color);
        material.emissive.copy(building.color.clone().multiplyScalar(0.1));
        const glowMaterial = building.glowMesh.material;
        glowMaterial.color.copy(building.color.clone().multiplyScalar(0.5));
      });
      if (progress >= 1) {
        entries.forEach(({ building, target }) => {
          building.color.copy(target);
          building.targetColor.copy(target);
        });
        this.colorCancel = null;
        return false;
      }
      return true;
    });
  }
  highlightBuilding(building, duration = 0.3) {
    const originalEmissive = building.mesh.material.emissive.clone();
    const originalGlowOpacity = building.glowMesh.material.opacity;
    const targetEmissive = building.color.clone().multiplyScalar(0.6);
    const startTime = performance.now();
    this.runAnimation((now) => {
      if (!this.buildings.has(building.id)) return false;
      const elapsed = (now - startTime) / 1e3;
      const progress = Math.min(elapsed / (duration / 2), 1);
      const pulse = Math.sin(progress * Math.PI);
      const material = building.mesh.material;
      material.emissive.lerpColors(originalEmissive, targetEmissive, pulse);
      const glowMaterial = building.glowMesh.material;
      glowMaterial.opacity = originalGlowOpacity + pulse * 0.5;
      if (progress >= 1 && elapsed >= duration) {
        material.emissive.copy(originalEmissive);
        glowMaterial.opacity = originalGlowOpacity;
        return false;
      }
      return true;
    });
  }
  clearCity() {
    this.cancelPendingWork();
    const buildings = this.getBuildings();
    buildings.forEach((building) => this.disposeBuilding(building));
    this.removeGround();
  }
  easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  easeInBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  }
  dispose() {
    if (this.animLoopId !== null) {
      cancelAnimationFrame(this.animLoopId);
      this.animLoopId = null;
    }
    this.clearCity();
  }
};
export {
  CityBuilder
};
