import * as THREE from 'three';

export interface PlanetData {
  name: string;
  nameCn: string;
  radius: number;
  distance: number;
  orbitSpeed: number;
  rotationSpeed: number;
  color: number;
  realDiameter: string;
  realOrbitPeriod: string;
  realDistance: string;
  hasRings?: boolean;
}

export interface PlanetObject {
  mesh: THREE.Mesh;
  data: PlanetData;
  orbit: THREE.Line;
  angle: number;
  label: HTMLElement;
  glow: THREE.Sprite;
  rings?: THREE.Mesh;
}

export interface SolarSystem {
  sun: THREE.Mesh;
  sunGlow: THREE.Sprite;
  sunLight: THREE.PointLight;
  planets: PlanetObject[];
  particles: THREE.Points;
  group: THREE.Group;
}

export const PLANET_DATA: PlanetData[] = [
  {
    name: 'Mercury',
    nameCn: '水星',
    radius: 0.38,
    distance: 8,
    orbitSpeed: 4.15,
    rotationSpeed: 0.03,
    color: 0xb5b5b5,
    realDiameter: '4,879 km',
    realOrbitPeriod: '88 天',
    realDistance: '5,790 万 km'
  },
  {
    name: 'Venus',
    nameCn: '金星',
    radius: 0.95,
    distance: 12,
    orbitSpeed: 1.62,
    rotationSpeed: 0.005,
    color: 0xffc649,
    realDiameter: '12,104 km',
    realOrbitPeriod: '225 天',
    realDistance: '1.08 亿 km'
  },
  {
    name: 'Earth',
    nameCn: '地球',
    radius: 1.0,
    distance: 16,
    orbitSpeed: 1.0,
    rotationSpeed: 0.1,
    color: 0x4a90d9,
    realDiameter: '12,742 km',
    realOrbitPeriod: '365 天',
    realDistance: '1.5 亿 km'
  },
  {
    name: 'Mars',
    nameCn: '火星',
    radius: 0.53,
    distance: 21,
    orbitSpeed: 0.53,
    rotationSpeed: 0.097,
    color: 0xc1440e,
    realDiameter: '6,779 km',
    realOrbitPeriod: '687 天',
    realDistance: '2.28 亿 km'
  },
  {
    name: 'Jupiter',
    nameCn: '木星',
    radius: 2.5,
    distance: 30,
    orbitSpeed: 0.084,
    rotationSpeed: 0.2,
    color: 0xd8ca9d,
    realDiameter: '139,820 km',
    realOrbitPeriod: '12 年',
    realDistance: '7.78 亿 km'
  },
  {
    name: 'Saturn',
    nameCn: '土星',
    radius: 2.1,
    distance: 40,
    orbitSpeed: 0.034,
    rotationSpeed: 0.18,
    color: 0xead6b8,
    realDiameter: '116,460 km',
    realOrbitPeriod: '29 年',
    realDistance: '14.3 亿 km',
    hasRings: true
  },
  {
    name: 'Uranus',
    nameCn: '天王星',
    radius: 1.5,
    distance: 50,
    orbitSpeed: 0.012,
    rotationSpeed: 0.14,
    color: 0x9fe8e8,
    realDiameter: '50,724 km',
    realOrbitPeriod: '84 年',
    realDistance: '28.7 亿 km'
  },
  {
    name: 'Neptune',
    nameCn: '海王星',
    radius: 1.4,
    distance: 58,
    orbitSpeed: 0.006,
    rotationSpeed: 0.15,
    color: 0x3b5998,
    realDiameter: '49,244 km',
    realOrbitPeriod: '165 年',
    realDistance: '45 亿 km'
  }
];

function createSun(): { mesh: THREE.Mesh; glow: THREE.Sprite; light: THREE.PointLight } {
  const sunGeometry = new THREE.SphereGeometry(4, 64, 64);
  
  const sunMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color1: { value: new THREE.Color(0xffcc33) },
      color2: { value: new THREE.Color(0xff6600) }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 color1;
      uniform vec3 color2;
      varying vec2 vUv;
      varying vec3 vNormal;
      
      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }
      
      void main() {
        vec2 uv = vUv;
        float n = noise(uv * 8.0 + time * 0.5);
        n += noise(uv * 16.0 - time * 0.3) * 0.5;
        n += noise(uv * 32.0 + time * 0.1) * 0.25;
        n = n / 1.75;
        
        vec3 color = mix(color1, color2, n);
        
        float edge = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.0);
        color = mix(color, vec3(1.0, 0.8, 0.3), edge * 0.5);
        
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  
  const sun = new THREE.Mesh(sunGeometry, sunMaterial);
  sun.name = 'Sun';
  
  const glowTexture = createGlowTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffcc33,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(14, 14, 1);
  sun.add(glow);
  
  const light = new THREE.PointLight(0xffcc33, 2.5, 300, 1);
  light.position.set(0, 0, 0);
  sun.add(light);
  
  return { mesh: sun, glow, light };
}

function createGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.1, 'rgba(255, 230, 150, 0.8)');
  gradient.addColorStop(0.3, 'rgba(255, 200, 100, 0.4)');
  gradient.addColorStop(0.6, 'rgba(255, 150, 50, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createPlanet(data: PlanetData): { mesh: THREE.Mesh; glow: THREE.Sprite; rings?: THREE.Mesh } {
  const geometry = new THREE.SphereGeometry(data.radius, 32, 32);
  
  let material: THREE.MeshStandardMaterial;
  
  if (data.name === 'Jupiter') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#c9a86c');
    gradient.addColorStop(0.2, '#d8ca9d');
    gradient.addColorStop(0.4, '#a67c52');
    gradient.addColorStop(0.5, '#d8ca9d');
    gradient.addColorStop(0.6, '#8b6914');
    gradient.addColorStop(0.8, '#d8ca9d');
    gradient.addColorStop(1, '#c9a86c');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 256);
    
    for (let i = 0; i < 8; i++) {
      const y = 20 + i * 30;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < 512; x += 10) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 5);
      }
      ctx.strokeStyle = `rgba(139, 90, 43, ${0.3 + Math.random() * 0.3})`;
      ctx.lineWidth = 2 + Math.random() * 3;
      ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.8,
      metalness: 0.1
    });
  } else if (data.name === 'Earth') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#1a5f9c';
    ctx.fillRect(0, 0, 512, 256);
    
    ctx.fillStyle = '#2d8a4e';
    ctx.beginPath();
    ctx.ellipse(150, 80, 60, 40, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(350, 150, 50, 30, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(280, 60, 30, 20, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(100, 180, 25, 15, 0.4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 256;
      ctx.beginPath();
      ctx.ellipse(x, y, 20 + Math.random() * 20, 8 + Math.random() * 8, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.6,
      metalness: 0.1
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      color: data.color,
      roughness: 0.7,
      metalness: 0.1
    });
  }
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = data.name;
  
  const glowTexture = createGlowTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: data.color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.4
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(data.radius * 3, data.radius * 3, 1);
  mesh.add(glow);
  
  let rings: THREE.Mesh | undefined;
  if (data.hasRings) {
    const ringGeometry = new THREE.RingGeometry(data.radius * 1.4, data.radius * 2.5, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9b896,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    rings = new THREE.Mesh(ringGeometry, ringMaterial);
    rings.rotation.x = Math.PI / 2.5;
    mesh.add(rings);
  }
  
  return { mesh, glow, rings };
}

function createOrbit(distance: number, color: number): THREE.Line {
  const points: THREE.Vector3[] = [];
  const segments = 128;
  
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance
    ));
  }
  
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({
    color: color,
    dashSize: 0.3,
    gapSize: 0.2,
    transparent: true,
    opacity: 0.5
  });
  
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  
  return line;
}

function createLabel(data: PlanetData, container: HTMLElement): HTMLElement {
  const label = document.createElement('div');
  label.className = 'planet-label';
  label.dataset.planet = data.name;
  label.innerHTML = `
    <div class="label-name">${data.nameCn} · ${data.name}</div>
    <div class="label-info"><span>直径:</span>${data.realDiameter}</div>
    <div class="label-info"><span>公转周期:</span>${data.realOrbitPeriod}</div>
    <div class="label-info"><span>距太阳:</span>${data.realDistance}</div>
  `;
  container.appendChild(label);
  return label;
}

function createParticleSystem(): THREE.Points {
  const particleCount = 250;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 25 + Math.random() * 8;
    const y = (Math.random() - 0.5) * 2;
    
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    
    const colorT = Math.random();
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.9 + colorT * 0.1;
    colors[i * 3 + 2] = 0.6 + colorT * 0.2;
    
    sizes[i] = 0.1 + Math.random() * 0.15;
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.6)');
  gradient.addColorStop(1, 'rgba(255, 200, 100, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const particleTexture = new THREE.CanvasTexture(canvas);
  
  const material = new THREE.PointsMaterial({
    size: 0.3,
    map: particleTexture,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  
  const particles = new THREE.Points(geometry, material);
  return particles;
}

export function createSolarSystem(scene: THREE.Scene, uiContainer: HTMLElement): SolarSystem {
  const group = new THREE.Group();
  
  const { mesh: sun, glow: sunGlow, light: sunLight } = createSun();
  group.add(sun);
  
  const planets: PlanetObject[] = [];
  
  PLANET_DATA.forEach((data) => {
    const { mesh, glow, rings } = createPlanet(data);
    const orbit = createOrbit(data.distance, data.color);
    const label = createLabel(data, uiContainer);
    
    const angle = Math.random() * Math.PI * 2;
    mesh.position.x = Math.cos(angle) * data.distance;
    mesh.position.z = Math.sin(angle) * data.distance;
    
    group.add(mesh);
    group.add(orbit);
    
    planets.push({
      mesh,
      data,
      orbit,
      angle,
      label,
      glow,
      rings
    });
  });
  
  const particles = createParticleSystem();
  group.add(particles);
  
  scene.add(group);
  
  return {
    sun,
    sunGlow,
    sunLight,
    planets,
    particles,
    group
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function updateSolarSystem(
  system: SolarSystem,
  delta: number,
  speedMultiplier: number,
  camera: THREE.Camera,
  showOrbits: boolean,
  focusTarget: THREE.Vector3 | null,
  focusProgress: number
): { focusProgress: number; shouldUpdateControls: boolean } {
  const time = performance.now() * 0.001;
  
  if (system.sun.material instanceof THREE.ShaderMaterial) {
    system.sun.material.uniforms.time.value = time;
  }
  
  system.planets.forEach((planet) => {
    planet.angle += planet.data.orbitSpeed * delta * 0.1 * speedMultiplier;
    planet.mesh.position.x = Math.cos(planet.angle) * planet.data.distance;
    planet.mesh.position.z = Math.sin(planet.angle) * planet.data.distance;
    
    planet.mesh.rotation.y += planet.data.rotationSpeed * delta * speedMultiplier;
    
    planet.orbit.visible = showOrbits;
    
    const screenPos = planet.mesh.position.clone().project(camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    
    const distance = planet.mesh.position.distanceTo(camera.position);
    const isVisible = distance < 25 && screenPos.z < 1;
    
    planet.label.style.left = `${x}px`;
    planet.label.style.top = `${y}px`;
    planet.label.classList.toggle('visible', isVisible);
    
    const glowScale = planet.data.radius * 3 * (1 + distance * 0.02);
    planet.glow.scale.set(glowScale, glowScale, 1);
  });
  
  const sunDistance = system.sun.position.distanceTo(camera.position);
  const sunGlowScale = 14 * (1 + sunDistance * 0.01);
  system.sunGlow.scale.set(sunGlowScale, sunGlowScale, 1);
  
  system.particles.rotation.y += delta * 0.05 * speedMultiplier;
  
  const positions = system.particles.geometry.attributes.position.array as Float32Array;
  const sizes = system.particles.geometry.attributes.size.array as Float32Array;
  for (let i = 0; i < positions.length / 3; i++) {
    const pos = new THREE.Vector3(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2]
    );
    const dist = pos.distanceTo(camera.position);
    sizes[i] = Math.max(0.05, Math.min(0.5, 0.3 * (1 / (dist * 0.1))));
  }
  system.particles.geometry.attributes.size.needsUpdate = true;
  
  let shouldUpdateControls = false;
  if (focusTarget && focusProgress < 1) {
    focusProgress = Math.min(1, focusProgress + delta);
    const t = easeInOutCubic(focusProgress);
    camera.position.lerp(focusTarget, t * 0.05);
    shouldUpdateControls = true;
  }
  
  return { focusProgress, shouldUpdateControls };
}

export function getPlanetFocusPosition(
  system: SolarSystem,
  planetName: string,
  camera: THREE.Camera
): THREE.Vector3 | null {
  const planet = system.planets.find(p => p.data.name === planetName);
  if (!planet) return null;
  
  const direction = new THREE.Vector3()
    .subVectors(camera.position, planet.mesh.position)
    .normalize();
  
  const distance = planet.data.radius * 6 + 5;
  return planet.mesh.position.clone().add(direction.multiplyScalar(distance));
}
