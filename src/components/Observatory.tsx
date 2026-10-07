import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Html, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { LightBeamData } from '../App';
import { planets, constellations, trigrams } from '../lib/starData';

interface ObservatoryProps {
  rotation: [number, number];
  onSphereMouseDown: (e: React.MouseEvent) => void;
  isDraggingSphere: boolean;
  lightBeam: LightBeamData | null;
}

export default function Observatory({ rotation, onSphereMouseDown, isDraggingSphere, lightBeam }: ObservatoryProps) {
  const observatoryRef = useRef<THREE.Group>(null);
  const armillaryRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (observatoryRef.current) {
      observatoryRef.current.rotation.y += delta * (Math.PI * 2 / 90);
    }
    if (armillaryRef.current) {
      armillaryRef.current.rotation.x = rotation[0] * Math.PI / 180;
      armillaryRef.current.rotation.y = rotation[1] * Math.PI / 180;
    }
  });

  const starFieldPoints = useMemo(() => {
    const positions = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 40 + Math.random() * 20;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    return positions;
  }, []);

  const constellationLinePoints = useMemo(() => {
    const points: [number, number, number][] = [];
    const radius = 8;
    for (let i = 0; i < 28; i++) {
      const angle1 = (i / 28) * Math.PI * 2;
      const angle2 = ((i + 1) / 28) * Math.PI * 2;
      points.push([
        Math.cos(angle1) * radius,
        0.1,
        Math.sin(angle1) * radius
      ]);
      points.push([
        Math.cos(angle2) * radius,
        0.1,
        Math.sin(angle2) * radius
      ]);
    }
    return points;
  }, []);

  return (
    <group>
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
      
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={500}
            array={starFieldPoints}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial size={0.15} color="#ffffff" sizeAttenuation transparent opacity={0.8} />
      </points>

      <group ref={observatoryRef}>
        <mesh position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <cylinderGeometry args={[8, 9, 0.5, 64]} />
          <meshStandardMaterial color="#f5f5f5" roughness={0.8} metalness={0.1} />
        </mesh>

        <mesh position={[0, -3.7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[7.8, 8, 64]} />
          <meshBasicMaterial color="#b8860b" />
        </mesh>

        <lineSegments>
          <bufferGeometry setFromPoints={constellationLinePoints} />
          <lineBasicMaterial color="#b8860b" />
        </lineSegments>

        <mesh position={[0, -3.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[7.8, 64]} />
          <meshBasicMaterial color="#f0f0f0" transparent opacity={0.3} />
        </mesh>
      </group>

      <group
        ref={armillaryRef}
        onPointerDown={onSphereMouseDown}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        style={{ cursor: isDraggingSphere ? 'grabbing' : hovered ? 'grab' : 'pointer' }}
      >
        <mesh>
          <sphereGeometry args={[6, 48, 48]} />
          <meshBasicMaterial color="#0099cc" wireframe transparent opacity={0.3} />
        </mesh>

        <mesh rotation={[0, 0, 0]}>
          <torusGeometry args={[6, 0.05, 16, 100]} />
          <meshBasicMaterial color="#0099cc" transparent opacity={0.5} />
        </mesh>

        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[6, 0.05, 16, 100]} />
          <meshBasicMaterial color="#0099cc" transparent opacity={0.5} />
        </mesh>

        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[6, 0.05, 16, 100]} />
          <meshBasicMaterial color="#0099cc" transparent opacity={0.5} />
        </mesh>

        {[0, 45, 90, 135].map((angle, i) => (
          <mesh key={i} rotation={[angle * Math.PI / 180, 0, 0]}>
            <torusGeometry args={[6, 0.03, 16, 100]} />
            <meshBasicMaterial color="#0099cc" transparent opacity={0.3} />
          </mesh>
        ))}

        {[0, 45, 90, 135].map((angle, i) => (
          <mesh key={`v-${i}`} rotation={[0, angle * Math.PI / 180, 0]}>
            <torusGeometry args={[6, 0.03, 16, 100]} />
            <meshBasicMaterial color="#0099cc" transparent opacity={0.3} />
          </mesh>
        ))}

        {planets.map((planet, i) => (
          <Planet key={i} planet={planet} />
        ))}

        {constellations.map((constellation, i) => (
          <ConstellationLabel key={i} constellation={constellation} visible={isDraggingSphere || hovered} />
        ))}
      </group>

      {trigrams.map((trigram, i) => (
        <TalismanFlag key={i} trigram={trigram} index={i} />
      ))}

      <BaguaDiagram />

      {lightBeam && lightBeam.visible && (
        <LightBeam position={lightBeam.position} />
      )}
    </group>
  );
}

function Planet({ planet }: { planet: typeof planets[0] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const startTime = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (Math.PI * 2 / planet.period);
    }
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 2;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, startTime.current, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[planet.orbitRadius, 0.01, 8, 100]} />
        <meshBasicMaterial color={planet.color} transparent opacity={0.2} />
      </mesh>
      <mesh ref={meshRef} position={[planet.orbitRadius, 0, 0]}>
        <sphereGeometry args={[planet.size, 24, 24]} />
        <meshStandardMaterial color={planet.color} emissive={planet.color} emissiveIntensity={0.3} roughness={0.3} />
      </mesh>
    </group>
  );
}

function ConstellationLabel({ constellation, visible }: { constellation: typeof constellations[0]; visible: boolean }) {
  return (
    <Billboard position={constellation.position}>
      <Html
        center
        distanceFactor={15}
        style={{
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease-out',
          pointerEvents: 'none'
        }}
      >
        <div
          style={{
            padding: '4px 8px',
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
            color: '#ffffff',
            fontFamily: "'ZCOOL XiaoWei', serif",
            fontSize: '14px',
            whiteSpace: 'nowrap',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            backdropFilter: 'blur(4px)'
          }}
        >
          {constellation.name}
        </div>
      </Html>
    </Billboard>
  );
}

function TalismanFlag({ trigram, index }: { trigram: typeof trigrams[0]; index: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const baseAngle = (index / 8) * Math.PI * 2;
  const radius = 12;
  const x = Math.cos(baseAngle) * radius;
  const z = Math.sin(baseAngle) * radius;

  useFrame((state) => {
    if (meshRef.current) {
      const time = state.clock.elapsedTime;
      meshRef.current.rotation.z = Math.sin(time * 2 + index) * 0.1;
      meshRef.current.position.y = -2 + Math.sin(time + index * 0.5) * 0.2;
    }
  });

  return (
    <group position={[x, -2, z]}>
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 5, 8]} />
        <meshStandardMaterial color="#8b4513" />
      </mesh>
      <mesh ref={meshRef} position={[0.75, 2.5, 0]}>
        <planeGeometry args={[1.5, 1]} />
        <meshStandardMaterial
          color={trigram.color}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Billboard position={[0.75, 2.5, 0.01]}>
        <Html center distanceFactor={10} style={{ pointerEvents: 'none' }}>
          <div style={{
            fontSize: '32px',
            color: '#ffffff',
            fontFamily: "'ZCOOL XiaoWei', serif",
            textShadow: '0 0 10px rgba(0,0,0,0.5)'
          }}>
            {trigram.symbol}
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

function BaguaDiagram() {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const radius = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }, []);

  return (
    <group position={[0, -3.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <extrudeGeometry args={[shape, { depth: 0.05, bevelEnabled: false }]} />
        <meshBasicMaterial color="#b8860b" transparent opacity={0.6} />
      </mesh>
      <mesh>
        <ringGeometry args={[1.9, 1.95, 8]} />
        <meshBasicMaterial color="#b8860b" />
      </mesh>
      <mesh>
        <ringGeometry args={[0.8, 0.85, 64]} />
        <meshBasicMaterial color="#b8860b" />
      </mesh>
      <mesh>
        <circleGeometry args={[0.75, 64]} />
        <meshBasicMaterial color="#0d0d1a" />
      </mesh>

      {trigrams.map((trigram, i) => {
        const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * 1.4;
        const y = Math.sin(angle) * 1.4;
        return (
          <mesh key={i} position={[x, y, 0.03]} rotation={[0, 0, angle + Math.PI / 2]}>
            <planeGeometry args={[0.3, 0.3]} />
            <meshBasicMaterial color={trigram.color} transparent opacity={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

function LightBeam({ position }: { position: [number, number, number] }) {
  const particlesRef = useRef<THREE.Points>(null);
  const startTime = useRef(Date.now());

  const particleData = useMemo(() => {
    const positions = new Float32Array(30 * 3);
    const speeds = new Float32Array(30);
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.25;
      positions[i * 3] = position[0] + Math.cos(angle) * radius;
      positions[i * 3 + 1] = position[1] + Math.random() * 8;
      positions[i * 3 + 2] = position[2] + Math.sin(angle) * radius;
      speeds[i] = 0.5 + Math.random() * 1;
    }
    return { positions, speeds };
  }, [position]);

  useFrame((_, delta) => {
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
      const elapsed = (Date.now() - startTime.current) / 1000;
      
      for (let i = 0; i < 30; i++) {
        positions[i * 3 + 1] += delta * particleData.speeds[i];
        if (positions[i * 3 + 1] > position[1] + 8) {
          positions[i * 3 + 1] = position[1];
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * 0.25;
          positions[i * 3] = position[0] + Math.cos(angle) * radius;
          positions[i * 3 + 2] = position[2] + Math.sin(angle) * radius;
        }
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
      
      const material = particlesRef.current.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - elapsed / 2);
    }
  });

  return (
    <group>
      <mesh position={[position[0], position[1] + 4, position[2]]}>
        <cylinderGeometry args={[0.25, 0.5, 8, 32, 1, true]} />
        <meshBasicMaterial color="#ffd700" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      
      <mesh position={[position[0], position[1] + 4, position[2]]}>
        <cylinderGeometry args={[0.1, 0.3, 8, 32, 1, true]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={30}
            array={particleData.positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial size={0.15} color="#ffd700" transparent opacity={1} sizeAttenuation />
      </points>
    </group>
  );
}
