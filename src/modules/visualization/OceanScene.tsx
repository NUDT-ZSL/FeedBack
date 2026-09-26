import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { OceanRegion, ParticleData, PlanktonData, oceanDataService, OceanStats } from '../data/OceanDataService';

interface OceanSceneProps {
  region: OceanRegion;
  depthRange: [number, number];
  isPlaying: boolean;
  particleDensity: number;
  onStatsUpdate: (stats: OceanStats) => void;
  onPlanktonClick: (plankton: PlanktonData | null) => void;
}

interface SceneContentProps extends OceanSceneProps {
  particlesRef: React.MutableRefObject<ParticleData[]>;
  planktonRef: React.MutableRefObject<PlanktonData[]>;
  selectedPlankton: PlanktonData | null;
  setSelectedPlankton: (p: PlanktonData | null) => void;
}

const particleVertexShader = `
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float r = distance(gl_PointCoord, vec2(0.5));
    if (r > 0.5) discard;
    float alpha = (1.0 - r * 2.0) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const planktonVertexShader = `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aType;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vType;

  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vType = aType;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const planktonFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vType;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float alpha = 0.0;

    if (vType < 0.5) {
      float r = length(uv);
      if (r < 0.5) {
        alpha = (1.0 - r * 2.0) * vAlpha;
      }
    } else {
      float rx = abs(uv.x) * 2.0;
      float ry = abs(uv.y) * 6.0;
      if (rx < 1.0 && ry < 1.0) {
        alpha = (1.0 - max(rx, ry)) * vAlpha;
      }
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const COLORS = {
  lowSpeed: new THREE.Color('#0a3d62'),
  midSpeed: new THREE.Color('#00b894'),
  highSpeed: new THREE.Color('#00cec9'),
  algae: new THREE.Color('#00ff88'),
  krill: new THREE.Color('#ff8c42'),
};

const getSpeedColor = (speed: number, targetColor: THREE.Color): void => {
  if (speed < 0.5) {
    const t = speed / 0.5;
    targetColor.lerpColors(COLORS.lowSpeed, COLORS.midSpeed, t);
  } else if (speed < 1.0) {
    const t = (speed - 0.5) / 0.5;
    targetColor.lerpColors(COLORS.midSpeed, COLORS.highSpeed, t);
  } else {
    targetColor.copy(COLORS.highSpeed);
  }
};

const getDepthAlpha = (depth: number, minDepth: number, maxDepth: number): number => {
  if (depth < minDepth || depth > maxDepth) return 0;
  const fadeRange = 5;
  if (depth < minDepth + fadeRange) {
    return (depth - minDepth) / fadeRange;
  }
  if (depth > maxDepth - fadeRange) {
    return (maxDepth - depth) / fadeRange;
  }
  return 1;
};

const PlanktonInfoCard: React.FC<{ plankton: PlanktonData }> = ({ plankton }) => {
  return (
    <Html
      position={[plankton.position.x, plankton.position.y + 1.5, plankton.position.z]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div style={{
        background: 'rgba(13, 27, 42, 0.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '12px',
        padding: '12px 16px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        color: '#fff',
        fontSize: '12px',
        minWidth: '160px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: plankton.type === 'algae' ? '#00ff88' : '#ff8c42',
          marginBottom: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          {plankton.type === 'algae' ? '🌿' : '🦐'}
          {plankton.type === 'algae' ? '藻类' : '磷虾'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ color: '#778899' }}>密度估算:</span>
          <span style={{ color: '#00b894', fontFamily: 'monospace', fontWeight: 600 }}>
            {Math.round(plankton.density)} 个/m³
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#778899' }}>水深层:</span>
          <span style={{ color: '#00b894', fontFamily: 'monospace', fontWeight: 600 }}>
            {plankton.depth.toFixed(1)} m
          </span>
        </div>
      </div>
    </Html>
  );
};

const SceneContent: React.FC<SceneContentProps> = ({
  region,
  depthRange,
  isPlaying,
  particleDensity,
  onStatsUpdate,
  onPlanktonClick,
  particlesRef,
  planktonRef,
  selectedPlankton,
  setSelectedPlankton,
}) => {
  const particlesPointsRef = useRef<THREE.Points>(null);
  const trailPointsRef = useRef<THREE.Points>(null);
  const planktonPointsRef = useRef<THREE.Points>(null);
  const { camera } = useThree();
  const angleRef = useRef(Math.PI / 4);
  const statsTimerRef = useRef(0);
  const isUserInteractingRef = useRef(false);
  const tempColorRef = useRef(new THREE.Color());
  const depthRangeRef = useRef(depthRange);

  useEffect(() => {
    depthRangeRef.current = depthRange;
  }, [depthRange]);

  const displayParticleCount = useMemo(() => {
    return Math.floor(3500 * particleDensity);
  }, [particleDensity]);

  const displayPlanktonCount = useMemo(() => {
    return Math.floor(1800 * particleDensity);
  }, [particleDensity]);

  const particleMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {},
    });
  }, []);

  const planktonMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: planktonVertexShader,
      fragmentShader: planktonFragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      uniforms: {},
    });
  }, []);

  const particlesGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(displayParticleCount * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(displayParticleCount * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(displayParticleCount), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(displayParticleCount), 1));
    return geo;
  }, [displayParticleCount]);

  const trailGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(displayParticleCount * 3), 3));
    return geo;
  }, [displayParticleCount]);

  const planktonGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(displayPlanktonCount * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(displayPlanktonCount * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(displayPlanktonCount), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(displayPlanktonCount), 1));
    geo.setAttribute('aType', new THREE.BufferAttribute(new Float32Array(displayPlanktonCount), 1));
    return geo;
  }, [displayPlanktonCount]);

  useEffect(() => {
    const regionData = oceanDataService.getRegionData(region);
    particlesRef.current = [...regionData.particles].slice(0, displayParticleCount);
    planktonRef.current = [...regionData.plankton].slice(0, displayPlanktonCount);
    const [minDepth, maxDepth] = depthRangeRef.current;

    if (particlesPointsRef.current) {
      const posAttr = particlesPointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = particlesPointsRef.current.geometry.attributes.color as THREE.BufferAttribute;
      const sizeAttr = particlesPointsRef.current.geometry.attributes.aSize as THREE.BufferAttribute;
      const alphaAttr = particlesPointsRef.current.geometry.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < displayParticleCount; i++) {
        const p = particlesRef.current[i];
        const idx = i * 3;
        posAttr.array[idx] = p.position.x;
        posAttr.array[idx + 1] = p.position.y;
        posAttr.array[idx + 2] = p.position.z;

        getSpeedColor(p.speed, tempColorRef.current);
        colAttr.array[idx] = tempColorRef.current.r;
        colAttr.array[idx + 1] = tempColorRef.current.g;
        colAttr.array[idx + 2] = tempColorRef.current.b;

        sizeAttr.array[i] = 0.15 + Math.min(p.speed / 1.0, 1) * 0.45;
        alphaAttr.array[i] = getDepthAlpha(p.depth, minDepth, maxDepth);
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
    }

    if (trailPointsRef.current) {
      const posAttr = trailPointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < displayParticleCount; i++) {
        const p = particlesRef.current[i];
        const idx = i * 3;
        posAttr.array[idx] = p.position.x;
        posAttr.array[idx + 1] = p.position.y;
        posAttr.array[idx + 2] = p.position.z;
      }
      posAttr.needsUpdate = true;
    }

    if (planktonPointsRef.current) {
      const posAttr = planktonPointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = planktonPointsRef.current.geometry.attributes.color as THREE.BufferAttribute;
      const sizeAttr = planktonPointsRef.current.geometry.attributes.aSize as THREE.BufferAttribute;
      const alphaAttr = planktonPointsRef.current.geometry.attributes.aAlpha as THREE.BufferAttribute;
      const typeAttr = planktonPointsRef.current.geometry.attributes.aType as THREE.BufferAttribute;

      for (let i = 0; i < displayPlanktonCount; i++) {
        const p = planktonRef.current[i];
        const idx = i * 3;
        posAttr.array[idx] = p.position.x;
        posAttr.array[idx + 1] = p.position.y;
        posAttr.array[idx + 2] = p.position.z;

        const color = p.type === 'algae' ? COLORS.algae : COLORS.krill;
        colAttr.array[idx] = color.r;
        colAttr.array[idx + 1] = color.g;
        colAttr.array[idx + 2] = color.b;

        sizeAttr.array[i] = p.type === 'algae' ? 0.2 : 0.35;
        alphaAttr.array[i] = getDepthAlpha(p.depth, minDepth, maxDepth);
        typeAttr.array[i] = p.type === 'algae' ? 0 : 1;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      typeAttr.needsUpdate = true;
    }

    setSelectedPlankton(null);
  }, [region, displayParticleCount, displayPlanktonCount]);

  useFrame((state, delta) => {
    if (!particlesPointsRef.current || !particlesRef.current) return;

    const particlePosAttr = particlesPointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const particleColAttr = particlesPointsRef.current.geometry.attributes.color as THREE.BufferAttribute;
    const particleSizeAttr = particlesPointsRef.current.geometry.attributes.aSize as THREE.BufferAttribute;
    const particleAlphaAttr = particlesPointsRef.current.geometry.attributes.aAlpha as THREE.BufferAttribute;
    const trailPosAttr = trailPointsRef.current?.geometry.attributes.position as THREE.BufferAttribute;
    const [minDepth, maxDepth] = depthRangeRef.current;

    if (isPlaying && particlePosAttr && trailPosAttr) {
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];
        const idx = i * 3;

        trailPosAttr.array[idx] = particlePosAttr.array[idx];
        trailPosAttr.array[idx + 1] = particlePosAttr.array[idx + 1];
        trailPosAttr.array[idx + 2] = particlePosAttr.array[idx + 2];

        oceanDataService.updateParticle(p, delta, region);

        particlePosAttr.array[idx] = p.position.x;
        particlePosAttr.array[idx + 1] = p.position.y;
        particlePosAttr.array[idx + 2] = p.position.z;

        getSpeedColor(p.speed, tempColorRef.current);
        particleColAttr.array[idx] = tempColorRef.current.r;
        particleColAttr.array[idx + 1] = tempColorRef.current.g;
        particleColAttr.array[idx + 2] = tempColorRef.current.b;

        particleSizeAttr.array[i] = 0.15 + Math.min(p.speed / 1.0, 1) * 0.45;
        particleAlphaAttr.array[i] += (getDepthAlpha(p.depth, minDepth, maxDepth) - particleAlphaAttr.array[i]) * 0.1;
      }

      particlePosAttr.needsUpdate = true;
      particleColAttr.needsUpdate = true;
      particleSizeAttr.needsUpdate = true;
      particleAlphaAttr.needsUpdate = true;
      trailPosAttr.needsUpdate = true;
    } else {
      const alphaAttr = particleAlphaAttr;
      let alphaChanged = false;
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];
        const targetAlpha = getDepthAlpha(p.depth, minDepth, maxDepth);
        if (Math.abs(alphaAttr.array[i] - targetAlpha) > 0.001) {
          alphaAttr.array[i] += (targetAlpha - alphaAttr.array[i]) * 0.1;
          alphaChanged = true;
        }
      }
      if (alphaChanged) {
        alphaAttr.needsUpdate = true;
      }

      if (planktonPointsRef.current) {
        const plankAlphaAttr = planktonPointsRef.current.geometry.attributes.aAlpha as THREE.BufferAttribute;
        let plankAlphaChanged = false;
        for (let i = 0; i < planktonRef.current.length; i++) {
          const p = planktonRef.current[i];
          const targetAlpha = getDepthAlpha(p.depth, minDepth, maxDepth);
          if (Math.abs(plankAlphaAttr.array[i] - targetAlpha) > 0.001) {
            plankAlphaAttr.array[i] += (targetAlpha - plankAlphaAttr.array[i]) * 0.1;
            plankAlphaChanged = true;
          }
        }
        if (plankAlphaChanged) {
          plankAlphaAttr.needsUpdate = true;
        }
      }
    }

    if (!isUserInteractingRef.current) {
      angleRef.current += delta * (Math.PI * 2 / 20);
      const radius = 50;
      const height = 25;
      camera.position.x = Math.cos(angleRef.current) * radius;
      camera.position.z = Math.sin(angleRef.current) * radius;
      camera.position.y = height;
      camera.lookAt(0, 0, 0);
    }

    statsTimerRef.current += delta;
    if (statsTimerRef.current >= 2) {
      statsTimerRef.current = 0;
      const stats = oceanDataService.getRealTimeStats(region, particlesRef.current);
      onStatsUpdate(stats);
    }
  });

  const handlePlanktonClick = useCallback((event: any) => {
    event.stopPropagation();
    const point = event.point;

    let closest: PlanktonData | null = null;
    let minDist = Infinity;

    for (const p of planktonRef.current) {
      const dist = p.position.distanceTo(point);
      if (dist < minDist && dist < 2.5) {
        minDist = dist;
        closest = p;
      }
    }

    setSelectedPlankton(closest);
    onPlanktonClick(closest);
  }, [onPlanktonClick, setSelectedPlankton]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[20, 30, 20]} intensity={0.6} color="#88ccff" />
      <pointLight position={[-20, 10, -20]} intensity={0.3} color="#00aaff" />

      <mesh>
        <boxGeometry args={[50, 35, 40]} />
        <meshBasicMaterial
          color="#0d1b2a"
          side={THREE.BackSide}
          transparent
          opacity={0.4}
        />
      </mesh>

      <gridHelper args={[50, 20, '#1b2838', '#162233']} position={[0, -17.5, 0]} />

      <points ref={trailPointsRef} geometry={trailGeometry}>
        <pointsMaterial
          size={0.1}
          color="#00b894"
          transparent
          opacity={0.25}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      <points
        ref={particlesPointsRef}
        geometry={particlesGeometry}
        material={particleMaterial}
      />

      <points
        ref={planktonPointsRef}
        geometry={planktonGeometry}
        material={planktonMaterial}
        onClick={handlePlanktonClick}
      />

      {selectedPlankton && <PlanktonInfoCard plankton={selectedPlankton} />}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={25}
        maxDistance={150}
        enablePan={true}
        onStart={() => { isUserInteractingRef.current = true; }}
        onEnd={() => { isUserInteractingRef.current = false; }}
      />
    </>
  );
};

const OceanScene: React.FC<OceanSceneProps> = ({
  region,
  depthRange,
  isPlaying,
  particleDensity,
  onStatsUpdate,
  onPlanktonClick,
}) => {
  const particlesRef = useRef<ParticleData[]>([]);
  const planktonRef = useRef<PlanktonData[]>([]);
  const [selectedPlankton, setSelectedPlankton] = useState<PlanktonData | null>(null);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [50, 25, 0], fov: 50 }}
        style={{ background: '#0d1b2a' }}
      >
        <SceneContent
          region={region}
          depthRange={depthRange}
          isPlaying={isPlaying}
          particleDensity={particleDensity}
          onStatsUpdate={onStatsUpdate}
          onPlanktonClick={onPlanktonClick}
          particlesRef={particlesRef}
          planktonRef={planktonRef}
          selectedPlankton={selectedPlankton}
          setSelectedPlankton={setSelectedPlankton}
        />
      </Canvas>
    </div>
  );
};

export default OceanScene;
