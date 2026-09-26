import * as THREE from 'three';

export interface Artwork {
  id: number;
  title: string;
  author: string;
  description: string;
  group: THREE.Group;
  frame: THREE.Mesh;
  painting: THREE.Mesh;
  backLight: THREE.Mesh;
  label: THREE.Sprite;
  baseY: number;
  floatOffset: number;
  floatSpeed: number;
  ringMesh?: THREE.Mesh;
  ringStartTime: number;
  isNear: boolean;
  glowIntensity: number;
  targetGlow: number;
}

export interface GalleryCallbacks {
  onArtworkFocus?: (artwork: Artwork | null, distance: number) => void;
  onArtworkClick?: (artwork: Artwork) => void;
  onNearestDistance?: (distance: number) => void;
}

export interface Gallery {
  artworks: Artwork[];
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  teleportTo: (index: number, camera: THREE.PerspectiveCamera) => void;
  update: (delta: number, camera: THREE.PerspectiveCamera) => void;
  handleClick: (event: MouseEvent | Touch, camera: THREE.PerspectiveCamera) => void;
  hoverArtwork: Artwork | null;
  getThumbnailCanvas: (index: number) => HTMLCanvasElement;
}

const ARTWORK_DATA = [
  { title: '星河彼岸', author: '林墨白', description: '描绘遥远星系中漂浮的星际尘埃，呈现宇宙的浩瀚与神秘。' },
  { title: '晨光序曲', author: '苏婉清', description: '捕捉清晨第一缕阳光穿透云层的瞬间，温暖而充满希望。' },
  { title: '深海回声', author: '陈屿风', description: '探索深海未知领域中若隐若现的神秘光影与生物。' },
  { title: '量子花园', author: '顾星阑', description: '将量子力学中的粒子运动具象化为盛放的数字花园。' },
  { title: '时间之河', author: '白知秋', description: '用流动的色彩诠释时间的流逝与记忆的沉淀。' },
  { title: '极光之舞', author: '沈夜航', description: '北极夜空中绚丽的极光，大自然最壮美的光之舞蹈。' },
  { title: '赛博都市', author: '江临川', description: '展现未来都市的霓虹夜景，科技与人文的交融。' },
  { title: '梦境边缘', author: '孟清词', description: '游走于现实与幻境边界的超现实主义作品。' },
  { title: '荒原回响', author: '周慕言', description: '广袤荒漠中的一缕清风，带来远古的低语。' },
  { title: '机械之心', author: '裴书珩', description: '解构机械美学，赋予冰冷金属以生命的温度。' },
  { title: '云端漫步', author: '云舒影', description: '漫步于云海之上，感受自由与轻盈的极致体验。' },
  { title: '禅意留白', author: '叶知秋', description: '东方美学中的极简意境，此处无声胜有声。' }
];

function generatePaintingTexture(index: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;

  const seed = index * 137.5;
  const hueA = (seed) % 360;
  const hueB = (seed + 60 + Math.random() * 120) % 360;

  const gradient = ctx.createLinearGradient(0, 0, 512, 640);
  gradient.addColorStop(0, `hsl(${hueA}, 60%, 35%)`);
  gradient.addColorStop(0.5, `hsl(${(hueA + hueB) / 2}, 50%, 45%)`);
  gradient.addColorStop(1, `hsl(${hueB}, 70%, 25%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 640);

  const shapes = 5 + (index % 5);
  for (let i = 0; i < shapes; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 640;
    const r = 40 + Math.random() * 120;
    const h = (hueA + i * 30) % 360;
    const alpha = 0.1 + Math.random() * 0.25;
    const shapeType = index % 4;

    ctx.beginPath();
    if (shapeType === 0) {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else if (shapeType === 1) {
      ctx.rect(x - r / 2, y - r / 2, r, r);
    } else if (shapeType === 2) {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
    } else {
      for (let j = 0; j < 6; j++) {
        const angle = (j / 6) * Math.PI * 2;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    ctx.fillStyle = `hsla(${h}, 70%, 60%, ${alpha})`;
    ctx.fill();
  }

  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 640;
    const r = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + Math.random() * 0.5})`;
    ctx.fill();
  }

  const vignette = ctx.createRadialGradient(256, 320, 100, 256, 320, 500);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 512, 640);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createLabelSprite(title: string, author: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(20, 20, 25, 0.7)';
  ctx.beginPath();
  const r = 16;
  ctx.moveTo(r, 0);
  ctx.lineTo(512 - r, 0);
  ctx.quadraticCurveTo(512, 0, 512, r);
  ctx.lineTo(512, 160 - r);
  ctx.quadraticCurveTo(512, 160, 512 - r, 160);
  ctx.lineTo(r, 160);
  ctx.quadraticCurveTo(0, 160, 0, 160 - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(197, 163, 90, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = 'bold 42px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#F0F0F0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 55);

  ctx.font = '30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#C5A35A';
  ctx.fillText(`— ${author} —`, 256, 110);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.5, 1);
  return sprite;
}

function createFrameGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, 'rgba(197, 163, 90, 0)');
  gradient.addColorStop(0.1, 'rgba(197, 163, 90, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 220, 140, 1)');
  gradient.addColorStop(0.9, 'rgba(197, 163, 90, 0.8)');
  gradient.addColorStop(1, 'rgba(197, 163, 90, 0)');

  const vGradient = ctx.createLinearGradient(0, 0, 0, 320);
  vGradient.addColorStop(0, 'rgba(197, 163, 90, 0)');
  vGradient.addColorStop(0.08, 'rgba(197, 163, 90, 0.9)');
  vGradient.addColorStop(0.5, 'rgba(255, 230, 160, 1)');
  vGradient.addColorStop(0.92, 'rgba(197, 163, 90, 0.9)');
  vGradient.addColorStop(1, 'rgba(197, 163, 90, 0)');

  const borderW = 8;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, borderW);
  ctx.fillRect(0, 320 - borderW, 256, borderW);
  ctx.fillStyle = vGradient;
  ctx.fillRect(0, 0, borderW, 320);
  ctx.fillRect(256 - borderW, 0, borderW, 320);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createGallery(scene: THREE.Scene, callbacks: GalleryCallbacks = {}): Gallery {
  const artworks: Artwork[] = [];
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const frameGlowTexture = createFrameGlowTexture();

  const radius = 8;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const data = ARTWORK_DATA[i];
    const group = new THREE.Group();

    const baseX = Math.cos(angle) * radius;
    const baseZ = Math.sin(angle) * radius;
    const baseY = 2.5 + (i % 3) * 0.5;

    const frameWidth = 1.2;
    const frameHeight = 1.5;
    const frameDepth = 0.05;

    const frameGeometry = new THREE.BoxGeometry(frameWidth + frameDepth * 2, frameHeight + frameDepth * 2, frameDepth);
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xC0A060,
      metalness: 0.95,
      roughness: 0.15,
      emissive: 0x1a1408,
      emissiveIntensity: 0.3
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    group.add(frame);

    const glowGeometry = new THREE.PlaneGeometry(frameWidth + frameDepth * 2 + 0.1, frameHeight + frameDepth * 2 + 0.1);
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: frameGlowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      opacity: 0.4
    });
    const glowBack = new THREE.Mesh(glowGeometry, glowMaterial.clone());
    glowBack.position.z = -frameDepth / 2 - 0.001;
    glowBack.scale.set(1.08, 1.08, 1);
    group.add(glowBack);

    const glowFront = new THREE.Mesh(glowGeometry, glowMaterial.clone());
    glowFront.position.z = frameDepth / 2 + 0.001;
    glowFront.scale.set(1.08, 1.08, 1);
    group.add(glowFront);

    const backLightGeometry = new THREE.PlaneGeometry(frameWidth * 1.4, frameHeight * 1.4);
    const backLightMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFE4A0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    });
    const backLight = new THREE.Mesh(backLightGeometry, backLightMaterial);
    backLight.position.z = -0.15;
    group.add(backLight);

    const paintingGeometry = new THREE.PlaneGeometry(frameWidth, frameHeight);
    const paintingTexture = generatePaintingTexture(i);
    const paintingMaterial = new THREE.MeshStandardMaterial({
      map: paintingTexture,
      metalness: 0.05,
      roughness: 0.7
    });
    const painting = new THREE.Mesh(paintingGeometry, paintingMaterial);
    painting.position.z = frameDepth / 2 + 0.01;
    group.add(painting);

    const label = createLabelSprite(data.title, data.author);
    label.position.set(0, frameHeight / 2 + 0.45, 0);
    group.add(label);

    group.position.set(baseX, baseY, baseZ);
    group.lookAt(0, baseY, 0);

    scene.add(group);

    artworks.push({
      id: i,
      title: data.title,
      author: data.author,
      description: data.description,
      group,
      frame,
      painting,
      backLight,
      label,
      baseY,
      floatOffset: Math.random() * Math.PI * 2,
      floatSpeed: 0.8 + Math.random() * 0.4,
      ringStartTime: -10,
      isNear: false,
      glowIntensity: 0,
      targetGlow: 0
    });
  }

  function createRoom(): void {
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 512;
    gridCanvas.height = 512;
    const gctx = gridCanvas.getContext('2d')!;
    gctx.fillStyle = '#1A1A1A';
    gctx.fillRect(0, 0, 512, 512);
    gctx.strokeStyle = '#3A3A3A';
    gctx.lineWidth = 0.5;
    const step = 32;
    for (let i = 0; i <= 512; i += step) {
      gctx.beginPath();
      gctx.moveTo(i, 0);
      gctx.lineTo(i, 512);
      gctx.stroke();
      gctx.beginPath();
      gctx.moveTo(0, i);
      gctx.lineTo(512, i);
      gctx.stroke();
    }
    const floorTex = new THREE.CanvasTexture(gridCanvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(8, 8);
    floorTex.colorSpace = THREE.SRGBColorSpace;

    const wallGridCanvas = document.createElement('canvas');
    wallGridCanvas.width = 512;
    wallGridCanvas.height = 512;
    const wctx = wallGridCanvas.getContext('2d')!;
    wctx.fillStyle = '#2A2A2A';
    wctx.fillRect(0, 0, 512, 512);
    wctx.strokeStyle = '#3A3A3A';
    wctx.lineWidth = 0.5;
    for (let i = 0; i <= 512; i += step) {
      wctx.beginPath();
      wctx.moveTo(i, 0);
      wctx.lineTo(i, 512);
      wctx.stroke();
      wctx.beginPath();
      wctx.moveTo(0, i);
      wctx.lineTo(512, i);
      wctx.stroke();
    }
    const wallTex = new THREE.CanvasTexture(wallGridCanvas);
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(8, 2);
    wallTex.colorSpace = THREE.SRGBColorSpace;

    const floorGeom = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.9,
      metalness: 0.05
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ceilingTex = wallTex.clone();
    ceilingTex.needsUpdate = true;
    const ceilingGeom = new THREE.PlaneGeometry(40, 40);
    const ceilingMat = new THREE.MeshStandardMaterial({
      map: ceilingTex,
      roughness: 0.9,
      metalness: 0.05
    });
    const ceiling = new THREE.Mesh(ceilingGeom, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 8;
    scene.add(ceiling);

    const roomSize = 20;
    const wallHeight = 8;
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.BackSide
    });

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize * 2, wallHeight), wallMat);
    backWall.position.z = -roomSize;
    backWall.position.y = wallHeight / 2;
    scene.add(backWall);

    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize * 2, wallHeight), wallMat);
    frontWall.position.z = roomSize;
    frontWall.position.y = wallHeight / 2;
    scene.add(frontWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize * 2, wallHeight), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -roomSize;
    leftWall.position.y = wallHeight / 2;
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize * 2, wallHeight), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = roomSize;
    rightWall.position.y = wallHeight / 2;
    scene.add(rightWall);
  }

  createRoom();

  function teleportTo(index: number, camera: THREE.PerspectiveCamera): void {
    const artwork = artworks[index];
    if (!artwork) return;

    const dir = new THREE.Vector3();
    dir.subVectors(artwork.group.position, new THREE.Vector3(0, artwork.group.position.y, 0)).normalize();
    const targetPos = artwork.group.position.clone().add(dir.multiplyScalar(2.5));
    targetPos.y = camera.position.y;

    camera.position.copy(targetPos);
    camera.lookAt(artwork.group.position);
  }

  function update(delta: number, camera: THREE.PerspectiveCamera): void {
    const time = performance.now() / 1000;

    let minDistance = Infinity;
    let nearestArtwork: Artwork | null = null;

    for (const art of artworks) {
      art.group.position.y = art.baseY + Math.sin(time * art.floatSpeed + art.floatOffset) * 0.1;

      const glowPulse = 0.35 + Math.sin(time * (Math.PI / 2) + art.floatOffset) * 0.1;
      const frontGlow = art.group.children[2] as THREE.Mesh;
      const backGlowMesh = art.group.children[1] as THREE.Mesh;
      (frontGlow.material as THREE.MeshBasicMaterial).opacity = glowPulse + art.glowIntensity * 0.8;
      (backGlowMesh.material as THREE.MeshBasicMaterial).opacity = glowPulse + art.glowIntensity * 0.8;

      const scale = 1.08 + art.glowIntensity * 0.12;
      frontGlow.scale.set(scale, scale, 1);
      backGlowMesh.scale.set(scale, scale, 1);

      const frameMat = art.frame.material as THREE.MeshStandardMaterial;
      frameMat.emissiveIntensity = 0.3 + art.glowIntensity * 0.7;

      const backMat = art.backLight.material as THREE.MeshBasicMaterial;
      backMat.opacity = art.glowIntensity * 0.45;

      const dist = camera.position.distanceTo(art.group.position);
      if (dist < minDistance) {
        minDistance = dist;
        nearestArtwork = art;
      }

      const wasNear = art.isNear;
      art.isNear = dist < 2.0;
      art.targetGlow = art.isNear ? 1 : 0;
      art.glowIntensity += (art.targetGlow - art.glowIntensity) * Math.min(1, delta * 5);

      if (art.isNear && !wasNear && callbacks.onArtworkFocus) {
        callbacks.onArtworkFocus(art, dist);
      } else if (!art.isNear && wasNear && callbacks.onArtworkFocus) {
        callbacks.onArtworkFocus(null, dist);
      }

      if (art.ringMesh) {
        const elapsed = time - art.ringStartTime;
        const duration = 1.5;
        if (elapsed < duration) {
          const t = elapsed / duration;
          const ringScale = 0.2 + t * 0.8;
          art.ringMesh.scale.set(ringScale * (1.2 / 0.5), ringScale * (1.5 / 0.5), 1);
          const ringMat = art.ringMesh.material as THREE.MeshBasicMaterial;
          ringMat.opacity = (1 - t) * 0.8;
        } else {
          art.painting.remove(art.ringMesh);
          art.ringMesh = undefined;
        }
      }

      const labelMat = art.label.material as THREE.SpriteMaterial;
      labelMat.opacity = 0.6 + art.glowIntensity * 0.4;
    }

    if (callbacks.onNearestDistance) {
      callbacks.onNearestDistance(minDistance);
    }
  }

  function handleClick(event: MouseEvent | Touch, camera: THREE.PerspectiveCamera): void {
    const rect = (event.target as HTMLElement).getBoundingClientRect?.() || 
      document.querySelector('canvas')!.getBoundingClientRect();
    const clientX = 'clientX' in event ? event.clientX : 0;
    const clientY = 'clientY' in event ? event.clientY : 0;
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const paintingMeshes = artworks.map(a => a.painting);
    const intersects = raycaster.intersectObjects(paintingMeshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const painting = hit.object as THREE.Mesh;
      const artwork = artworks.find(a => a.painting === painting);
      if (artwork) {
        const time = performance.now() / 1000;
        if (artwork.ringMesh) {
          artwork.painting.remove(artwork.ringMesh);
        }
        const ringGeom = new THREE.RingGeometry(0.45, 0.5, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xFFF0C0,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        const uv = hit.uv!;
        ring.position.x = (uv.x - 0.5) * 1.2;
        ring.position.y = (uv.y - 0.5) * 1.5;
        ring.position.z = 0.001;
        ring.scale.set(0.2 * (1.2 / 0.5), 0.2 * (1.5 / 0.5), 1);
        artwork.painting.add(ring);
        artwork.ringMesh = ring;
        artwork.ringStartTime = time;

        if (callbacks.onArtworkClick) {
          callbacks.onArtworkClick(artwork);
        }
      }
    }
  }

  function getThumbnailCanvas(index: number): HTMLCanvasElement {
    const painting = artworks[index]?.painting;
    if (!painting) {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 100;
      return c;
    }
    const mat = painting.material as THREE.MeshStandardMaterial;
    const srcTex = mat.map as THREE.CanvasTexture;
    const srcCanvas = srcTex.image as HTMLCanvasElement;

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 125;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, 100, 125);
    return canvas;
  }

  return {
    artworks,
    raycaster,
    mouse,
    teleportTo,
    update,
    handleClick,
    hoverArtwork: null,
    getThumbnailCanvas
  };
}
