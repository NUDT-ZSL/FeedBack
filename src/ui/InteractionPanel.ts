import * as THREE from 'three';
import { ForgeScene } from '../core/ForgeScene';
import { FurnaceSystem } from '../core/FurnaceSystem';
import { WorkOrderStore } from '../data/WorkOrderStore';

interface DragState {
  isDragging: boolean;
  object: THREE.Object3D | null;
  startPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  offset: THREE.Vector3;
}

export class InteractionPanel {
  private forgeScene: ForgeScene;
  private furnaceSystem: FurnaceSystem;
  private workOrderStore: WorkOrderStore;
  
  private dragState: DragState;
  private currentMold: THREE.Object3D | null;
  private currentProduct: THREE.Object3D | null;
  private isProductQuenched: boolean;
  private bellowsDragState: { isDragging: boolean; startX: number; startHandleX: number };
  private pouringAreaPosition: THREE.Vector3;
  private quenchingBucketPosition: THREE.Vector3;
  private inspectionTablePosition: THREE.Vector3;
  private statFloats: THREE.Mesh[];
  private moldGlow: THREE.Mesh | null;

  constructor(
    forgeScene: ForgeScene,
    furnaceSystem: FurnaceSystem,
    workOrderStore: WorkOrderStore
  ) {
    this.forgeScene = forgeScene;
    this.furnaceSystem = furnaceSystem;
    this.workOrderStore = workOrderStore;
    
    this.dragState = {
      isDragging: false,
      object: null,
      startPosition: new THREE.Vector3(),
      currentPosition: new THREE.Vector3(),
      offset: new THREE.Vector3()
    };
    
    this.currentMold = null;
    this.currentProduct = null;
    this.isProductQuenched = false;
    this.bellowsDragState = { isDragging: false, startX: 0, startHandleX: 0 };
    
    this.pouringAreaPosition = new THREE.Vector3(2.5, 0.1, 2);
    this.quenchingBucketPosition = new THREE.Vector3(6, 0.6, -3);
    this.inspectionTablePosition = new THREE.Vector3(0, 1, 5);
    
    this.statFloats = [];
    this.moldGlow = null;
  }

  init(): void {
    this.setupMoldDrag();
    this.setupBellowsInteraction();
    this.setupSceneInteraction();
    this.forgeScene.onUpdate((delta: number) => this.update(delta));
  }

  private setupMoldDrag(): void {
    const moldItems = document.querySelectorAll('.mold-item');
    
    moldItems.forEach(item => {
      const htmlItem = item as HTMLElement;
      htmlItem.addEventListener('dragstart', (e) => {
        const dragEvent = e as unknown as DragEvent;
        const moldType = (e.target as HTMLElement).dataset.mold;
        if (moldType && !this.currentMold && !this.furnaceSystem.isPouringActive()) {
          (e.target as HTMLElement).classList.add('dragging');
          dragEvent.dataTransfer!.setData('moldType', moldType);
        } else {
          e.preventDefault();
        }
      });
      
      htmlItem.addEventListener('dragend', (e) => {
        (e.target as HTMLElement).classList.remove('dragging');
      });
    });
    
    const canvasContainer = document.getElementById('canvas-container')!;
    
    canvasContainer.addEventListener('dragover', (e) => {
      const dragEvent = e as unknown as DragEvent;
      e.preventDefault();
      dragEvent.dataTransfer!.dropEffect = 'copy';
    });
    
    canvasContainer.addEventListener('drop', (e) => {
      const dragEvent = e as unknown as DragEvent;
      e.preventDefault();
      const moldType = dragEvent.dataTransfer!.getData('moldType');
      if (!moldType) return;
      
      const worldPos = this.forgeScene.screenToWorld(dragEvent.clientX, dragEvent.clientY, 0.5);
      
      const distToPouring = worldPos.distanceTo(this.pouringAreaPosition);
      
      if (distToPouring < 1) {
        if (this.furnaceSystem.getTemperature() < 1200) {
          this.showInvalidOperation();
          console.warn('温度不足！请先拉动拉杆鼓风升温至1200°C以上。');
          return;
        }
        this.createMold(moldType, this.pouringAreaPosition);
        this.furnaceSystem.startPouring(moldType, this.pouringAreaPosition);
        this.createRipple(this.pouringAreaPosition);
        
        setTimeout(() => {
          this.furnaceSystem.stopPouring();
          this.furnaceSystem.startCooling();
        }, 3000);
      } else {
        this.createMold(moldType, worldPos);
      }
    });
  }

  private setupBellowsInteraction(): void {
    const canvas = this.forgeScene.getRenderer().domElement;
    const raycaster = this.forgeScene.getRaycaster();
    const mouse = this.forgeScene.getMouse();
    
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, this.forgeScene.getCamera());
      
      const bellowsHandle = this.forgeScene.getObject('bellowsHandle');
      const bellowsGrip = this.forgeScene.getObject('bellowsGrip');
      
      if (bellowsHandle && bellowsGrip) {
        const intersects = raycaster.intersectObjects([bellowsHandle, bellowsGrip], true);
        if (intersects.length > 0) {
          this.bellowsDragState.isDragging = true;
          this.bellowsDragState.startX = e.clientX;
          this.bellowsDragState.startHandleX = bellowsHandle.position.x;
          this.forgeScene.getControls().enabled = false;
          return;
        }
      }
      
      if (this.currentProduct) {
        const intersects = raycaster.intersectObject(this.currentProduct, true);
        if (intersects.length > 0) {
          this.startDrag3D(this.currentProduct, e.clientX, e.clientY);
          return;
        }
      }
      
      if (this.currentMold && this.furnaceSystem.isMoldCooled()) {
        const intersects = raycaster.intersectObject(this.currentMold, true);
        if (intersects.length > 0) {
          this.openMold();
        }
      }
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (this.bellowsDragState.isDragging) {
        const deltaX = (e.clientX - this.bellowsDragState.startX) * 0.01;
        let newX = this.bellowsDragState.startHandleX + deltaX;
        newX = Math.max(3.7, Math.min(4.7, newX));
        
        const handle = this.forgeScene.getObject('bellowsHandle')!;
        const grip = this.forgeScene.getObject('bellowsGrip')!;
        handle.position.x = newX;
        grip.position.x = newX + 0.6;
        
        const airFlow = (newX - 3.7) / 1.0;
        this.furnaceSystem.setAirFlow(airFlow);
      }
      
      if (this.dragState.isDragging && this.dragState.object) {
        const worldPos = this.forgeScene.screenToWorld(e.clientX, e.clientY, 0.5);
        this.dragState.object.position.lerp(worldPos.add(this.dragState.offset), 0.9);
      }
    });
    
    canvas.addEventListener('mouseup', (e) => {
      if (this.bellowsDragState.isDragging) {
        this.bellowsDragState.isDragging = false;
        this.forgeScene.getControls().enabled = true;
      }
      
      if (this.dragState.isDragging && this.dragState.object) {
        this.endDrag3D(e.clientX, e.clientY);
      }
    });
  }

  private setupSceneInteraction(): void {
    // 后续扩展
  }

  private startDrag3D(object: THREE.Object3D, clientX: number, clientY: number): void {
    const worldPos = this.forgeScene.screenToWorld(clientX, clientY, 0.5);
    this.dragState.isDragging = true;
    this.dragState.object = object;
    this.dragState.startPosition.copy(object.position);
    this.dragState.offset.copy(object.position).sub(worldPos);
    this.forgeScene.getControls().enabled = false;
  }

  private endDrag3D(clientX: number, clientY: number): void {
    this.dragState.isDragging = false;
    const object = this.dragState.object;
    this.dragState.object = null;
    this.forgeScene.getControls().enabled = true;
    
    if (!object) return;
    
    const distToBucket = object.position.distanceTo(this.quenchingBucketPosition);
    const distToTable = object.position.distanceTo(this.inspectionTablePosition);
    
    if (distToBucket < 1.5) {
      if (this.currentProduct && !this.isProductQuenched && this.furnaceSystem.isMoldCooled()) {
        this.performQuenching();
      } else if (!this.furnaceSystem.isMoldCooled() && this.currentMold) {
        this.showInvalidOperation();
        console.warn('铸件尚未冷却，无法淬火！');
        object.position.copy(this.dragState.startPosition);
      }
    } else if (distToTable < 1.5) {
      if (this.currentProduct && this.isProductQuenched) {
        this.performInspection();
      } else if (!this.isProductQuenched && this.currentProduct) {
        this.showInvalidOperation();
        console.warn('产品尚未淬火，无法质检！');
        object.position.copy(this.dragState.startPosition);
      }
    }
    
    this.createRipple(object.position);
  }

  private createMold(moldType: string, position: THREE.Vector3): void {
    if (this.currentMold) {
      this.forgeScene.removeObject('currentMold');
    }
    
    const moldGroup = new THREE.Group();
    moldGroup.name = 'currentMold';
    
    let moldGeo: THREE.BufferGeometry;
    let moldScale = 1;
    
    switch (moldType) {
      case 'sword':
        moldGeo = new THREE.BoxGeometry(0.15, 0.8, 0.08);
        moldScale = 1;
        break;
      case 'plow':
        moldGeo = new THREE.ConeGeometry(0.4, 0.6, 4);
        moldScale = 1;
        break;
      case 'ding':
        moldGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.4, 8);
        moldScale = 1;
        break;
      default:
        moldGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    }
    
    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x808080,
      wireframe: true,
      transparent: true,
      opacity: 0.6
    });
    
    const moldMesh = new THREE.Mesh(moldGeo, wireframeMat);
    moldMesh.scale.setScalar(moldScale);
    moldMesh.castShadow = true;
    moldGroup.add(moldMesh);
    
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.7,
      metalness: 0.2
    });
    
    const frameGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    const frameBottom = new THREE.Mesh(frameGeo, frameMat);
    frameBottom.position.y = -0.3;
    frameBottom.receiveShadow = true;
    moldGroup.add(frameBottom);
    
    moldGroup.position.copy(position);
    moldGroup.position.y = 0.3;
    
    this.forgeScene.addObject('currentMold', moldGroup);
    this.currentMold = moldGroup;
    
    const glowGeo = moldGeo.clone();
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.scale.setScalar(moldScale * 1.05);
    moldGroup.add(glow);
    this.moldGlow = glow;
  }

  private openMold(): void {
    if (!this.currentMold || !this.furnaceSystem.isMoldCooled()) return;
    
    const moldType = this.furnaceSystem.getMoldType();
    if (!moldType) return;
    
    const moldPos = this.currentMold.position.clone();
    
    this.forgeScene.removeObject('currentMold');
    this.currentMold = null;
    this.moldGlow = null;
    
    this.createProduct(moldType, moldPos);
    
    this.currentMold = this.currentProduct;
    
    setTimeout(() => {
      if (this.currentMold) {
        this.forgeScene.removeObject('currentMold');
        this.currentMold = null;
        this.currentProduct = null;
        this.furnaceSystem.reset();
      }
    }, 15000);
  }

  private createProduct(productType: string, position: THREE.Vector3): void {
    const productGroup = new THREE.Group();
    productGroup.name = 'currentMold';
    
    let productMesh: THREE.Mesh;
    
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.8,
      metalness: 0.6
    });
    
    switch (productType) {
      case 'sword':
        productMesh = this.createSwordMesh(metalMat);
        break;
      case 'plow':
        productMesh = this.createPlowMesh(metalMat);
        break;
      case 'ding':
        productMesh = this.createDingMesh(metalMat);
        break;
      default:
        productMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), metalMat);
    }
    
    productMesh.castShadow = true;
    productMesh.receiveShadow = true;
    productGroup.add(productMesh);
    
    productGroup.position.copy(position);
    productGroup.position.y = 0.5;
    
    this.forgeScene.addObject('currentMold', productGroup);
    this.currentProduct = productGroup;
    this.isProductQuenched = false;
  }

  private createSwordMesh(material: THREE.MeshStandardMaterial): THREE.Mesh {
    const group = new THREE.Group();
    
    const bladeGeo = new THREE.BoxGeometry(0.06, 0.6, 0.04);
    const blade = new THREE.Mesh(bladeGeo, material);
    blade.position.y = 0.1;
    group.add(blade);
    
    const tipGeo = new THREE.ConeGeometry(0.04, 0.15, 4);
    const tip = new THREE.Mesh(tipGeo, material);
    tip.position.y = 0.475;
    tip.rotation.z = Math.PI;
    group.add(tip);
    
    const guardGeo = new THREE.BoxGeometry(0.2, 0.05, 0.05);
    const guard = new THREE.Mesh(guardGeo, material);
    guard.position.y = -0.2;
    group.add(guard);
    
    const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.8,
      metalness: 0.2
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = -0.3;
    group.add(handle);
    
    const pommelGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const pommel = new THREE.Mesh(pommelGeo, material);
    pommel.position.y = -0.4;
    group.add(pommel);
    
    const merged = this.mergeGroupMeshes(group);
    return merged;
  }

  private createPlowMesh(material: THREE.MeshStandardMaterial): THREE.Mesh {
    const group = new THREE.Group();
    
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.quadraticCurveTo(0.2, 0.1, 0.3, 0.3);
    bladeShape.quadraticCurveTo(0.2, 0.2, 0, 0.3);
    bladeShape.quadraticCurveTo(-0.2, 0.2, -0.3, 0.3);
    bladeShape.quadraticCurveTo(-0.2, 0.1, 0, 0);
    
    const extrudeSettings = { depth: 0.05, bevelEnabled: false };
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
    const blade = new THREE.Mesh(bladeGeo, material);
    blade.rotation.x = -Math.PI / 2;
    group.add(blade);
    
    const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.1
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.3;
    handle.rotation.x = Math.PI / 6;
    group.add(handle);
    
    const merged = this.mergeGroupMeshes(group);
    return merged;
  }

  private createDingMesh(material: THREE.MeshStandardMaterial): THREE.Mesh {
    const group = new THREE.Group();
    
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.2, 0.3, 8);
    const body = new THREE.Mesh(bodyGeo, material);
    group.add(body);
    
    const rimGeo = new THREE.TorusGeometry(0.25, 0.03, 8, 16);
    const rim = new THREE.Mesh(rimGeo, material);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.15;
    group.add(rim);
    
    const legGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.25, 6);
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(legGeo, material);
      leg.position.set(
        Math.cos(angle) * 0.15,
        -0.27,
        Math.sin(angle) * 0.15
      );
      group.add(leg);
    }
    
    const earGeo = new THREE.TorusGeometry(0.06, 0.02, 8, 16);
    const ear1 = new THREE.Mesh(earGeo, material);
    ear1.position.set(0.28, 0.15, 0);
    ear1.rotation.y = Math.PI / 2;
    group.add(ear1);
    
    const ear2 = new THREE.Mesh(earGeo, material);
    ear2.position.set(-0.28, 0.15, 0);
    ear2.rotation.y = Math.PI / 2;
    group.add(ear2);
    
    const merged = this.mergeGroupMeshes(group);
    return merged;
  }

  private mergeGroupMeshes(group: THREE.Group): THREE.Mesh {
    const mergedGeo = new THREE.BufferGeometry();
    const materials: THREE.Material[] = [];
    
    let indexOffset = 0;
    
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry.clone();
        geo.applyMatrix4(child.matrix);
        
        if (geo.index) {
          const indices = geo.index.array.map((i: number) => i + indexOffset);
          mergedGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        }
        
        const positions = geo.attributes.position;
        mergedGeo.setAttribute('position', positions);
        
        if (geo.attributes.normal) {
          mergedGeo.setAttribute('normal', geo.attributes.normal);
        }
        
        materials.push(child.material as THREE.Material);
        
        indexOffset += positions.count;
      }
    });
    
    const finalMaterial = materials.length > 0 ? materials[0] : new THREE.MeshStandardMaterial();
    
    return new THREE.Mesh(mergedGeo, finalMaterial);
  }

  private performQuenching(): void {
    if (!this.currentProduct) return;
    
    this.furnaceSystem.startSteamEffect(this.quenchingBucketPosition);
    
    this.currentProduct.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.color.setHex(0x2f4f4f);
        child.material.roughness = 0.3;
        child.material.metalness = 0.9;
      }
    });
    
    this.isProductQuenched = true;
    
    this.currentProduct.position.copy(this.quenchingBucketPosition);
    this.currentProduct.position.y = 0.8;
  }

  private performInspection(): void {
    if (!this.currentProduct) return;
    
    this.currentProduct.position.copy(this.inspectionTablePosition);
    this.currentProduct.position.y = 1.2;
    
    const hardness = Math.floor(60 + Math.random() * 40);
    const toughness = Math.floor(60 + Math.random() * 40);
    const sharpness = Math.floor(60 + Math.random() * 40);
    
    const moldType = this.furnaceSystem.getMoldType() || 'sword';
    
    this.createStatFloats(this.currentProduct.position, hardness, toughness, sharpness);
    
    const record = this.workOrderStore.addRecord({
      productType: moldType,
      hardness,
      toughness,
      sharpness
    });
    
    setTimeout(() => {
      this.createGradeEffect(record.grade, this.currentProduct!.position);
    }, 500);
    
    setTimeout(() => {
      this.cleanupStatFloats();
      if (this.currentProduct) {
        this.forgeScene.removeObject('currentMold');
        this.currentProduct = null;
        this.currentMold = null;
        this.isProductQuenched = false;
        this.furnaceSystem.reset();
      }
    }, 4000);
  }

  private createStatFloats(position: THREE.Vector3, hardness: number, toughness: number, sharpness: number): void {
    this.cleanupStatFloats();
    
    const stats = [
      { value: hardness, color: 0xff4444, offset: -0.3 },
      { value: toughness, color: 0x44ff44, offset: 0 },
      { value: sharpness, color: 0x4444ff, offset: 0.3 }
    ];
    
    stats.forEach(stat => {
      const floatGeo = new THREE.SphereGeometry(0.2, 16, 16);
      const floatMat = new THREE.MeshBasicMaterial({
        color: stat.color,
        transparent: true,
        opacity: 0.7
      });
      const float = new THREE.Mesh(floatGeo, floatMat);
      
      float.position.set(
        position.x + stat.offset,
        position.y + 0.8,
        position.z
      );
      
      const brightness = stat.value / 100;
      floatMat.opacity = 0.5 + brightness * 0.4;
      float.scale.setScalar(0.8 + brightness * 0.4);
      
      this.forgeScene.getScene().add(float);
      this.statFloats.push(float);
      
      const valueSprite = this.createValueSprite(stat.value);
      valueSprite.position.copy(float.position);
      valueSprite.position.y += 0.3;
      this.forgeScene.getScene().add(valueSprite);
      this.statFloats.push(valueSprite as unknown as THREE.Mesh);
    });
  }

  private createValueSprite(value: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.roundRect(0, 0, 64, 32, 8);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${value}%`, 32, 16);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.4, 0.2, 1);
    
    return sprite;
  }

  private createGradeEffect(grade: string, position: THREE.Vector3): void {
    let color: number;
    let effectType: 'ring' | 'flash';
    
    switch (grade) {
      case '上品':
        color = 0xffd700;
        effectType = 'ring';
        break;
      case '良品':
        color = 0x44ff44;
        effectType = 'flash';
        break;
      default:
        color = 0xff4444;
        effectType = 'flash';
    }
    
    if (effectType === 'ring') {
      this.createGoldRingEffect(position, color);
    } else {
      this.createFlashEffect(position, color);
    }
  }

  private createGoldRingEffect(position: THREE.Vector3, color: number): void {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const ringGeo = new THREE.TorusGeometry(0.1, 0.02, 8, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.8
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(position);
        ring.position.y += 0.5;
        
        this.forgeScene.getScene().add(ring);
        
        const startTime = Date.now();
        const duration = 1500;
        
        const animate = () => {
          const elapsed = (Date.now() - startTime) / duration;
          if (elapsed < 1) {
            ring.scale.setScalar(1 + elapsed * 4);
            ringMat.opacity = 0.8 * (1 - elapsed);
            requestAnimationFrame(animate);
          } else {
            this.forgeScene.getScene().remove(ring);
          }
        };
        animate();
      }, i * 200);
    }
  }

  private createFlashEffect(position: THREE.Vector3, color: number): void {
    const flashGeo = new THREE.SphereGeometry(1, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(position);
    
    this.forgeScene.getScene().add(flash);
    
    let flashCount = 0;
    const maxFlashes = 4;
    
    const flashStep = () => {
      if (flashCount < maxFlashes) {
        flashMat.opacity = flashCount % 2 === 0 ? 0.5 : 0;
        flashCount++;
        setTimeout(flashStep, 200);
      } else {
        this.forgeScene.getScene().remove(flash);
      }
    };
    flashStep();
  }

  private cleanupStatFloats(): void {
    this.statFloats.forEach(float => {
      this.forgeScene.getScene().remove(float);
    });
    this.statFloats = [];
  }

  private createRipple(position: THREE.Vector3): void {
    const rippleGeo = new THREE.RingGeometry(0.01, 0.02, 32);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0xb8860b,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.copy(position);
    ripple.position.y = 0.05;
    
    this.forgeScene.getScene().add(ripple);
    
    const startTime = Date.now();
    const duration = 400;
    
    const animate = () => {
      const elapsed = (Date.now() - startTime) / duration;
      if (elapsed < 1) {
        const scale = 1 + elapsed * 25;
        ripple.scale.setScalar(scale);
        rippleMat.opacity = 0.8 * (1 - elapsed);
        requestAnimationFrame(animate);
      } else {
        this.forgeScene.getScene().remove(ripple);
      }
    };
    animate();
  }

  private showInvalidOperation(): void {
    const canvas = this.forgeScene.getRenderer().domElement;
    canvas.classList.add('border-flash', 'cursor-forbidden');
    
    setTimeout(() => {
      canvas.classList.remove('border-flash', 'cursor-forbidden');
    }, 900);
  }

  private update(delta: number): void {
    if (this.moldGlow && this.currentMold) {
      const temp = this.furnaceSystem.getMoldTemperature();
      if (temp > 100 && this.furnaceSystem.isPouringActive() || this.furnaceSystem.getMoldTemperature() > 100) {
        const time = Date.now() * 0.001;
        const pulse = 0.5 + Math.sin(time * Math.PI * 2 / 0.8) * 0.5;
        const tempRatio = Math.max(0, (temp - 100) / 1500);
        
        const glowMat = this.moldGlow.material as THREE.MeshBasicMaterial;
        glowMat.opacity = 0.3 + pulse * 0.5 * tempRatio;
        
        if (temp > 800) {
          glowMat.color.setHex(0xff4400);
        } else if (temp > 400) {
          glowMat.color.setHex(0xff2200);
        } else {
          glowMat.color.setHex(0x8b0000);
        }
      } else {
        (this.moldGlow.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    }
    
    if (this.currentMold && !this.furnaceSystem.isPouringActive() && this.furnaceSystem.getMoldTemperature() > 0) {
      const temp = this.furnaceSystem.getMoldTemperature();
      
      this.currentMold.traverse((child) => {
        if (child instanceof THREE.Mesh && child !== this.moldGlow) {
          if (child.material instanceof THREE.MeshBasicMaterial && child.material.wireframe) {
            if (temp > 800) {
              child.material.color.setHex(0xff4400);
            } else if (temp > 400) {
              child.material.color.setHex(0x8b0000);
            } else if (temp > 100) {
              child.material.color.setHex(0x555555);
            } else {
              child.material.color.setHex(0x808080);
            }
          } else if (child.material instanceof THREE.MeshStandardMaterial) {
            if (temp > 800) {
              child.material.emissive.setHex(0xff4400);
              child.material.emissiveIntensity = (temp - 800) / 800;
            } else if (temp > 400) {
              child.material.emissive.setHex(0x8b0000);
              child.material.emissiveIntensity = (temp - 400) / 400 * 0.5;
            } else {
              child.material.emissive.setHex(0x000000);
              child.material.emissiveIntensity = 0;
            }
          }
        }
      });
    }
    
    this.statFloats.forEach((float, index) => {
      if (index % 2 === 0) {
        const time = Date.now() * 0.003;
        float.position.y += Math.sin(time + index) * 0.002;
      }
    });
  }
}
