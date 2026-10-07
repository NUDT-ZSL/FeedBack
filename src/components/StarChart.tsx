import React, { useRef, useState, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStar } from '../context/StarContext';
import { CelestialBody, PLANET_DATA, STAR_NAMES } from '../types';
import { sphericalToCartesian, cartesianToSpherical, getStarColor, getStarSize, lerp } from '../utils';

const SKY_RADIUS = 50;

const generateStars = (): CelestialBody[] => {
  const stars: CelestialBody[] = [];

  for (let i = 0; i < 20; i++) {
    const ra = Math.random() * 360;
    const dec = (Math.random() - 0.5) * 180;
    const pos = sphericalToCartesian(SKY_RADIUS, ra, dec);
    const starInfo = STAR_NAMES[i % STAR_NAMES.length];
    stars.push({
      position: pos,
      color: getStarColor(),
      size: 0.06 + Math.random() * 0.04,
      name: starInfo.name,
      latinName: starInfo.latin,
      magnitude: 1.5 + Math.random() * 1.5,
      description: starInfo.desc,
      type: 'star',
    });
  }

  for (let i = 20; i < 300; i++) {
    const ra = Math.random() * 360;
    const dec = (Math.random() - 0.5) * 180;
    const pos = sphericalToCartesian(SKY_RADIUS, ra, dec);
    stars.push({
      position: pos,
      color: getStarColor(),
      size: getStarSize(),
      name: `星 ${i}`,
      latinName: `HD ${Math.floor(Math.random() * 100000)}`,
      magnitude: 3 + Math.random() * 3,
      description: '无名恒星',
      type: 'star',
    });
  }

  return stars;
};

const StarPoint: React.FC<{
  star: CelestialBody;
  isSelected: boolean;
  onClick: () => void;
  onHover: (e: React.PointerEvent) => void;
  onHoverEnd: () => void;
}> = ({ star, isSelected, onClick, onHover, onHoverEnd }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(Math.random() * 100);

  useFrame((_, delta) => {
    timeRef.current += delta;
    if (meshRef.current) {
      const twinkle = 0.8 + Math.sin(timeRef.current * 3) * 0.2;
      meshRef.current.scale.setScalar(star.size * twinkle * (isSelected ? 1.2 : 1));
    }
    if (glowRef.current && isSelected) {
      const pulse = 1 + Math.sin(timeRef.current * Math.PI * 2) * 0.5;
      glowRef.current.scale.setScalar(pulse);
      const material = glowRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.4 + Math.sin(timeRef.current * Math.PI * 2) * 0.2;
    }
  });

  const handleClick = (e: React.PointerEvent) => {
    e.stopPropagation();
    onClick();
  };

  return (
    <group position={star.position}>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          onHover(e);
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
          onHoverEnd();
        }}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={star.color} />
      </mesh>
      {isSelected && (
        <mesh ref={glowRef}>
          <sphereGeometry args={[1.5, 16, 16]} />
          <meshBasicMaterial color={star.color} transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
};

const Planet: React.FC<{
  planet: typeof PLANET_DATA[0];
  angle: number;
  isSelected: boolean;
  onClick: () => void;
  onHover: (e: React.PointerEvent) => void;
  onHoverEnd: () => void;
}> = ({ planet, angle, isSelected, onClick, onHover, onHoverEnd }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const currentAngle = angle + timeRef.current * planet.orbitSpeed * 0.1;
    const x = planet.orbitRadius * Math.cos(currentAngle);
    const z = planet.orbitRadius * Math.sin(currentAngle);
    const y = Math.sin(currentAngle * 0.7) * 2;

    if (meshRef.current) {
      meshRef.current.position.set(x, y, z);
      meshRef.current.rotation.y += delta * 2;
    }
    if (glowRef.current && isSelected) {
      glowRef.current.position.set(x, y, z);
      const pulse = 1 + Math.sin(timeRef.current * Math.PI * 2) * 0.5;
      glowRef.current.scale.setScalar(pulse * planet.size * 1.5);
      const material = glowRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.4 + Math.sin(timeRef.current * Math.PI * 2) * 0.2;
    }
  });

  const handleClick = (e: React.PointerEvent) => {
    e.stopPropagation();
    onClick();
  };

  return (
    <>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          onHover(e);
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
          onHoverEnd();
        }}>
        <sphereGeometry args={[planet.size, 16, 16]} />
        <meshStandardMaterial
          color={planet.color}
          emissive={planet.color}
          emissiveIntensity={0.5}
          metalness={0.3}
          roughness={0.6}
        />
      </mesh>
      {isSelected && (
        <mesh ref={glowRef}>
          <sphereGeometry args={[planet.size * 1.5, 16, 16]} />
          <meshBasicMaterial color={planet.color} transparent opacity={0.4} />
        </mesh>
      )}
    </>
  );
};

const Moon: React.FC<{
  hour: number;
  isSelected: boolean;
  onClick: () => void;
  onHover: (e: React.PointerEvent) => void;
  onHoverEnd: () => void;
}> = ({ hour, isSelected, onClick, onHover, onHoverEnd }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const angle = (hour / 24) * Math.PI * 2 + timeRef.current * 0.05;
    const radius = 20;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle * 0.5) + 5;
    const z = radius * Math.sin(angle);

    if (meshRef.current) {
      meshRef.current.position.set(x, y, z);
      meshRef.current.rotation.y += delta;
    }
    if (glowRef.current && isSelected) {
      glowRef.current.position.set(x, y, z);
      const pulse = 1 + Math.sin(timeRef.current * Math.PI * 2) * 0.5;
      glowRef.current.scale.setScalar(pulse * 1.5);
      const material = glowRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.4 + Math.sin(timeRef.current * Math.PI * 2) * 0.2;
    }
  });

  const handleClick = (e: React.PointerEvent) => {
    e.stopPropagation();
    onClick();
  };

  return (
    <>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          onHover(e);
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
          onHoverEnd();
        }}>
        <sphereGeometry args={[0.25, 32, 32]} />
        <meshStandardMaterial
          color="#f5f5dc"
          emissive="#ffffe0"
          emissiveIntensity={0.3}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      {isSelected && (
        <mesh ref={glowRef}>
          <sphereGeometry args={[0.25 * 1.5, 16, 16]} />
          <meshBasicMaterial color="#f5f5dc" transparent opacity={0.4} />
        </mesh>
      )}
    </>
  );
};

const InfoPopup: React.FC<{
  star: CelestialBody | null;
  position: { x: number; y: number };
}> = ({ star, position }) => {
  if (!star) return null;

  const { ra, dec } = cartesianToSpherical(...star.position);

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x + 10,
        top: position.y + 10,
        background: '#00000088',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        pointerEvents: 'none',
        fontSize: '14px',
        backdropFilter: 'blur(4px)',
        minWidth: '200px',
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
        {star.name}
      </div>
      <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '8px' }}>
        {star.latinName}
      </div>
      <div>赤经: {ra.toFixed(1)}°</div>
      <div>赤纬: {dec.toFixed(1)}°</div>
      <div>视星等: {star.magnitude.toFixed(1)}</div>
      <div style={{ marginTop: '8px', color: '#ccc', fontSize: '12px' }}>
        {star.description}
      </div>
    </div>
  );
};

const StarChart: React.FC = () => {
  const { currentHour, selectedStar, setSelectedStar } = useStar();
  const groupRef = useRef<THREE.Group>(null);
  const targetRotation = useRef(0);
  const currentRotation = useRef(0);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [hoveredStar, setHoveredStar] = useState<CelestialBody | null>(null);

  const stars = useMemo(() => generateStars(), []);

  targetRotation.current = (currentHour / 24) * Math.PI * 2;

  useFrame((_, delta) => {
    if (groupRef.current) {
      currentRotation.current = lerp(
        currentRotation.current,
        targetRotation.current,
        delta * 0.5
      );
      groupRef.current.rotation.y = currentRotation.current;
    }
  });

  const handleStarClick = useCallback((star: CelestialBody) => {
    const { ra, dec } = cartesianToSpherical(...star.position);
    const adjustedRa = (ra - currentRotation.current * (180 / Math.PI) + 360) % 360;
    const adjustedStar: CelestialBody = {
      ...star,
      position: sphericalToCartesian(SKY_RADIUS, adjustedRa, dec),
    };
    if (selectedStar?.name === star.name) {
      setSelectedStar(null);
    } else {
      setSelectedStar(adjustedStar);
    }
  }, [selectedStar, setSelectedStar, currentRotation.current]);

  const handleStarHover = useCallback((star: CelestialBody | null, e?: React.PointerEvent) => {
    if (star && e) {
      setHoveredStar(star);
      setPopupPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredStar(null);
    }
  }, []);

  const handlePlanetClick = useCallback((planet: typeof PLANET_DATA[0], angle: number) => {
    const currentAngle = angle;
    const x = planet.orbitRadius * Math.cos(currentAngle);
    const z = planet.orbitRadius * Math.sin(currentAngle);
    const y = Math.sin(currentAngle * 0.7) * 2;
    const { ra, dec } = cartesianToSpherical(x, y, z);
    const adjustedRa = (ra - currentRotation.current * (180 / Math.PI) + 360) % 360;
    const planetBody: CelestialBody = {
      position: sphericalToCartesian(SKY_RADIUS, adjustedRa, dec),
      color: planet.color,
      size: planet.size,
      name: planet.name,
      latinName: planet.latinName,
      magnitude: planet.magnitude,
      description: planet.description,
      type: 'planet',
    };
    if (selectedStar?.name === planet.name) {
      setSelectedStar(null);
    } else {
      setSelectedStar(planetBody);
    }
  }, [selectedStar, setSelectedStar, currentRotation.current]);

  const handleMoonClick = useCallback(() => {
    const angle = (currentHour / 24) * Math.PI * 2;
    const radius = 20;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle * 0.5) + 5;
    const z = radius * Math.sin(angle);
    const { ra, dec } = cartesianToSpherical(x, y, z);
    const adjustedRa = (ra - currentRotation.current * (180 / Math.PI) + 360) % 360;
    const moonBody: CelestialBody = {
      position: sphericalToCartesian(SKY_RADIUS, adjustedRa, dec),
      color: '#f5f5dc',
      size: 0.25,
      name: '月亮',
      latinName: 'Luna',
      magnitude: -12.0,
      description: '地球的天然卫星',
      type: 'moon',
    };
    if (selectedStar?.name === '月亮') {
      setSelectedStar(null);
    } else {
      setSelectedStar(moonBody);
    }
  }, [currentHour, selectedStar, setSelectedStar, currentRotation.current]);

  const getPlanetBody = useCallback((planet: typeof PLANET_DATA[0], angle: number): CelestialBody => {
    const x = planet.orbitRadius * Math.cos(angle);
    const z = planet.orbitRadius * Math.sin(angle);
    const y = Math.sin(angle * 0.7) * 2;
    const { ra, dec } = cartesianToSpherical(x, y, z);
    return {
      position: sphericalToCartesian(SKY_RADIUS, ra, dec),
      color: planet.color,
      size: planet.size,
      name: planet.name,
      latinName: planet.latinName,
      magnitude: planet.magnitude,
      description: planet.description,
      type: 'planet',
    };
  }, []);

  const getMoonBody = useCallback((): CelestialBody => {
    const angle = (currentHour / 24) * Math.PI * 2;
    const radius = 20;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle * 0.5) + 5;
    const z = radius * Math.sin(angle);
    const { ra, dec } = cartesianToSpherical(x, y, z);
    return {
      position: sphericalToCartesian(SKY_RADIUS, ra, dec),
      color: '#f5f5dc',
      size: 0.25,
      name: '月亮',
      latinName: 'Luna',
      magnitude: -12.0,
      description: '地球的天然卫星',
      type: 'moon',
    };
  }, [currentHour]);

  return (
    <>
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[SKY_RADIUS, 64, 64]} />
          <meshBasicMaterial
            color="#050515"
            side={THREE.BackSide}
            transparent
            opacity={0.5}
          />
        </mesh>

        {stars.map((star, i) => (
          <StarPoint
            key={`star-${i}`}
            star={star}
            isSelected={selectedStar?.name === star.name}
            onClick={() => handleStarClick(star)}
            onHover={(e) => handleStarHover(star, e)}
            onHoverEnd={() => handleStarHover(null)}
          />
        ))}

        {PLANET_DATA.map((planet, i) => (
          <Planet
            key={`planet-${i}`}
            planet={planet}
            angle={i * 1.2}
            isSelected={selectedStar?.name === planet.name}
            onClick={() => handlePlanetClick(planet, i * 1.2)}
            onHover={(e) => handleStarHover(getPlanetBody(planet, i * 1.2), e)}
            onHoverEnd={() => handleStarHover(null)}
          />
        ))}

        <Moon
          hour={currentHour}
          isSelected={selectedStar?.name === '月亮'}
          onClick={handleMoonClick}
          onHover={(e) => handleStarHover(getMoonBody(), e)}
          onHoverEnd={() => handleStarHover(null)}
        />
      </group>

      {hoveredStar && !selectedStar && <InfoPopup star={hoveredStar} position={popupPos} />}
    </>
  );
};

export default StarChart;
