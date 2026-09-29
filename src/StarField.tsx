import { useRef, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Star, FilterState, SpectralType } from './types';
import { SPECTRAL_MAP } from './StarData';

interface StarFieldProps {
  stars: Star[];
  filter: FilterState;
  selectedStarId: number | null;
  onStarClick: (star: Star | null) => void;
  resetTrigger: number;
}

const vertexShader = `
  attribute float size;
  attribute vec4 customColor;
  varying vec4 vColor;
  
  void main() {
    vColor = customColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec4 vColor;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    if (dist > 0.5) {
      discard;
    }
    
    float alpha = smoothstep(0.5, 0.0, dist) * vColor.a;
    float glow = smoothstep(0.5, 0.2, dist) * 0.5 + 0.5;
    
    gl_FragColor = vec4(vColor.rgb * glow, alpha);
  }
`;

function StarPoints({ stars, filter, selectedStarId, onStarClick }: Omit<StarFieldProps, 'resetTrigger'>) {
  const pointsRef = useRef<THREE.Points>(null);
  const { camera, gl } = useThree();
  const pulseRef = useRef(0);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);

  const { positions, colors, sizes, originalSizes } = useMemo(() => {
    const positions = new Float32Array(stars.length * 3);
    const colors = new Float32Array(stars.length * 4);
    const sizes = new Float32Array(stars.length);
    const originalSizes = new Float32Array(stars.length);

    stars.forEach((star, i) => {
      positions[i * 3] = star.position.x;
      positions[i * 3 + 1] = star.position.y;
      positions[i * 3 + 2] = star.position.z;

      const color = new THREE.Color(SPECTRAL_MAP[star.spectralType].color);
      colors[i * 4] = color.r;
      colors[i * 4 + 1] = color.g;
      colors[i * 4 + 2] = color.b;
      colors[i * 4 + 3] = 1.0;

      const brightnessFactor = (10 - star.apparentMagnitude + 1.5) / 12;
      const size = Math.max(0.5, brightnessFactor * 4);
      sizes[i] = size;
      originalSizes[i] = size;
    });

    return { positions, colors, sizes, originalSizes };
  }, [stars]);

  useEffect(() => {
    if (!pointsRef.current) return;

    const geometry = pointsRef.current.geometry;
    const colorAttribute = geometry.getAttribute('customColor') as THREE.BufferAttribute;
    const sizeAttribute = geometry.getAttribute('size') as THREE.BufferAttribute;

    const colorArray = colorAttribute.array as Float32Array;
    const sizeArray = sizeAttribute.array as Float32Array;

    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const isSpectralMatch = filter.spectralTypes.includes(star.spectralType);
      const isMagnitudeMatch = 
        star.apparentMagnitude >= filter.magnitudeRange[0] && 
        star.apparentMagnitude <= filter.magnitudeRange[1];

      const isSelected = selectedStarId === star.id;

      if (isSpectralMatch && isMagnitudeMatch) {
        colorArray[i * 4 + 3] = 1.0;
        sizeArray[i] = isSelected ? originalSizes[i] * 1.8 : originalSizes[i];
      } else if (!isSpectralMatch) {
        colorArray[i * 4 + 3] = 0.1;
        sizeArray[i] = originalSizes[i] * 0.7;
      } else {
        colorArray[i * 4 + 3] = 0.2;
        sizeArray[i] = originalSizes[i] * 0.3;
      }
    }

    colorAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
  }, [filter, selectedStarId, stars, originalSizes]);

  useFrame((_, delta) => {
    pulseRef.current += delta * Math.PI * 2;
    
    if (selectedStarId !== null && pointsRef.current) {
      const sizeAttribute = pointsRef.current.geometry.getAttribute('size') as THREE.BufferAttribute;
      const sizeArray = sizeAttribute.array as Float32Array;
      const pulseScale = 1 + Math.sin(pulseRef.current) * 0.3;
      sizeArray[selectedStarId] = originalSizes[selectedStarId] * 1.8 * pulseScale;
      sizeAttribute.needsUpdate = true;
    }
  });

  const pointerDownPos = useRef({ x: 0, y: 0, time: 0 });

  const handlePointerDown = useCallback((event: any) => {
    pointerDownPos.current = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
    };
  }, []);

  const handlePointerUp = useCallback((event: any) => {
    if (!pointsRef.current) return;

    const dx = event.clientX - pointerDownPos.current.x;
    const dy = event.clientY - pointerDownPos.current.y;
    const dt = Date.now() - pointerDownPos.current.time;

    if (Math.sqrt(dx * dx + dy * dy) > 5 || dt > 300) {
      return;
    }

    const rect = gl.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    raycaster.params.Points = { threshold: 3 };
    
    const intersects = raycaster.intersectObject(pointsRef.current);

    if (intersects.length > 0) {
      const index = intersects[0].index;
      if (index !== undefined) {
        onStarClick(stars[index]);
        return;
      }
    }
    onStarClick(null);
  }, [camera, gl.domElement, onStarClick, stars, raycaster, mouse]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
    };
  }, [gl.domElement, handlePointerDown, handlePointerUp]);

  const uniforms = useMemo(() => ({}), []);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-customColor"
          count={colors.length / 4}
          array={colors}
          itemSize={4}
        />
        <bufferAttribute
          attach="attributes-size"
          count={sizes.length}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function CameraController({ resetTrigger }: { resetTrigger: number }) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const targetPosition = useRef(new THREE.Vector3(0, 5, 40));
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const isAnimating = useRef(false);
  const animationProgress = useRef(0);
  const startPosition = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    if (resetTrigger === 0) return;
    
    if (controlsRef.current) {
      startPosition.current.copy(camera.position);
      startTarget.current.copy(controlsRef.current.target);
      targetPosition.current.set(0, 5, 40);
      targetLookAt.current.set(0, 0, 0);
      isAnimating.current = true;
      animationProgress.current = 0;
    }
  }, [resetTrigger, camera]);

  useFrame((_, delta) => {
    if (isAnimating.current && controlsRef.current) {
      animationProgress.current += delta / 0.8;
      
      if (animationProgress.current >= 1) {
        animationProgress.current = 1;
        isAnimating.current = false;
      }

      const t = animationProgress.current;
      const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      camera.position.lerpVectors(startPosition.current, targetPosition.current, easeT);
      controlsRef.current.target.lerpVectors(startTarget.current, targetLookAt.current, easeT);
      controlsRef.current.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.9}
      minDistance={5}
      maxDistance={100}
    />
  );
}

export default function StarField({ stars, filter, selectedStarId, onStarClick, resetTrigger }: StarFieldProps) {
  return (
    <Canvas
      camera={{ position: [0, 5, 40], fov: 45, near: 0.1, far: 1000 }}
      style={{ background: '#0a0a1e' }}
      gl={{ antialias: true, alpha: false }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <StarPoints stars={stars} filter={filter} selectedStarId={selectedStarId} onStarClick={onStarClick} />
      <CameraController resetTrigger={resetTrigger} />
    </Canvas>
  );
}
