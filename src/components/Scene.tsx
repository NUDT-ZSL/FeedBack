import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import * as Comlink from 'comlink';
import type { MaterialType, ModelType } from '../types';
import { MATERIAL_CONFIGS } from '../types';
import type { ClothWorkerAPI } from '../workers/clothWorker';
import { Screenshot } from './Screenshot';

interface SceneContentProps {
  modelType: ModelType;
  materialType: MaterialType;
  wrinkleIntensity: number;
  ambientIntensity: number;
  lightAngle: number;
}

const createTshirtGeometry = (): THREE.BufferGeometry => {
  const bodyGeo = new THREE.CylinderGeometry(1.2, 1.5, 2.5, 32, 16, true);
  const positions = bodyGeo.attributes.position.array as Float32Array;

  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y > 1.0) {
      const scale = (1.2 - (y - 1.0) * 0.8) / 1.2;
      positions[i] *= scale;
      positions[i + 2] *= scale;
    }
    if (y < -1.0) {
      const scale = (1.5 - (y + 1.0) * 0.3) / 1.5;
      positions[i] *= scale;
      positions[i + 2] *= scale;
    }
  }

  bodyGeo.computeVertexNormals();
  return bodyGeo;
};

const createSkirtGeometry = (): THREE.BufferGeometry => {
  const skirtGeo = new THREE.ConeGeometry(1.8, 2.2, 40, 20, true);
  const positions = skirtGeo.attributes.position.array as Float32Array;

  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const wave = Math.sin(positions[i] * 3 + y * 2) * 0.05;
    positions[i + 2] += wave;
    const ringWave = Math.sin((positions[i] + positions[i + 2]) * 5) * 0.08 * (y + 1.1);
    positions[i] += ringWave * 0.5;
    positions[i + 2] += ringWave * 0.5;
  }

  skirtGeo.computeVertexNormals();
  return skirtGeo;
};

const createScarfGeometry = (): THREE.BufferGeometry => {
  const width = 3;
  const height = 1.2;
  const segmentsW = 60;
  const segmentsH = 20;
  const scarfGeo = new THREE.PlaneGeometry(width, height, segmentsW, segmentsH);
  const positions = scarfGeo.attributes.position.array as Float32Array;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    positions[i + 2] = Math.sin(x * Math.PI) * 0.5 + Math.sin(y * 3) * 0.15;
  }

  scarfGeo.computeVertexNormals();
  return scarfGeo;
};

const modelGeometries: Record<ModelType, () => THREE.BufferGeometry> = {
  tshirt: createTshirtGeometry,
  skirt: createSkirtGeometry,
  scarf: createScarfGeometry
};

const ClothMesh: React.FC<{
  modelType: ModelType;
  materialType: MaterialType;
  wrinkleIntensity: number;
}> = ({ modelType, materialType, wrinkleIntensity }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const originalPositions = useRef<Float32Array | null>(null);
  const workerRef = useRef<Comlink.Remote<ClothWorkerAPI> | null>(null);
  const timeRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const vertexCountRef = useRef(0);

  const geometry = useMemo(() => {
    const geo = modelGeometries[modelType]();
    const posArray = geo.attributes.position.array as Float32Array;
    originalPositions.current = new Float32Array(posArray);
    vertexCountRef.current = posArray.length / 3;

    const colors = new Float32Array(posArray.length);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geo;
  }, [modelType]);

  const materialConfig = MATERIAL_CONFIGS[materialType];

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(materialConfig.color),
      roughness: materialConfig.roughness,
      metalness: materialConfig.metalness,
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false
    });
  }, [materialConfig]);

  useEffect(() => {
    material.color.set(materialConfig.color);
    material.roughness = materialConfig.roughness;
    material.metalness = materialConfig.metalness;
    material.needsUpdate = true;
  }, [material, materialConfig]);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/clothWorker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = Comlink.wrap<ClothWorkerAPI>(worker);

    return () => {
      worker.terminate();
      if (workerRef.current) {
        (workerRef.current as Comlink.Remote<ClothWorkerAPI>)[Comlink.releaseProxy]();
      }
    };
  }, []);

  useFrame((_, delta) => {
    timeRef.current += delta;
    lastUpdateRef.current += delta;

    if (lastUpdateRef.current < 0.016) return;
    lastUpdateRef.current = 0;

    if (!meshRef.current || !originalPositions.current || !workerRef.current) return;

    const posAttribute = meshRef.current.geometry.attributes.position;
    const colorAttribute = meshRef.current.geometry.attributes.color;

    void (async () => {
      if (!workerRef.current || !originalPositions.current) return;

      const newPositions = await workerRef.current.computeWrinklePositions(
        originalPositions.current,
        wrinkleIntensity,
        timeRef.current,
        vertexCountRef.current
      );

      const newColors = await workerRef.current.computeVertexColors(
        newPositions,
        vertexCountRef.current
      );

      if (posAttribute.array instanceof Float32Array) {
        posAttribute.array.set(newPositions);
        posAttribute.needsUpdate = true;
      }

      if (colorAttribute.array instanceof Float32Array) {
        colorAttribute.array.set(newColors);
        colorAttribute.needsUpdate = true;
      }

      meshRef.current?.geometry.computeVertexNormals();
    })();
  });

  const rotation = useMemo(() => {
    switch (modelType) {
      case 'scarf':
        return [0.2, 0, 0];
      case 'skirt':
        return [0, 0, 0];
      default:
        return [0, 0, 0];
    }
  }, [modelType]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      rotation={rotation as [number, number, number]}
    />
  );
};

const Lighting: React.FC<{
  ambientIntensity: number;
  lightAngle: number;
}> = ({ ambientIntensity, lightAngle }) => {
  const directionalLightRef = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();

  useEffect(() => {
    const t = ambientIntensity / 2;
    const bgColor = new THREE.Color('#263238').lerp(new THREE.Color('#eceff1'), t);
    scene.background = bgColor;
  }, [ambientIntensity, scene]);

  const lightPosition = useMemo(() => {
    const angleRad = (lightAngle * Math.PI) / 180;
    const radius = 5;
    return [radius * Math.cos(angleRad), radius * Math.sin(angleRad), 2] as [number, number, number];
  }, [lightAngle]);

  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      <directionalLight
        ref={directionalLightRef}
        position={lightPosition}
        intensity={1.2}
        castShadow
      />
    </>
  );
};

interface SceneProps extends SceneContentProps {
  isTransitioning: boolean;
}

const SceneContent: React.FC<SceneContentProps> = (props) => {
  return (
    <>
      <Lighting
        ambientIntensity={props.ambientIntensity}
        lightAngle={props.lightAngle}
      />
      <ClothMesh
        modelType={props.modelType}
        materialType={props.materialType}
        wrinkleIntensity={props.wrinkleIntensity}
      />
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={3}
        maxDistance={10}
      />
      <Screenshot />
    </>
  );
};

const Scene: React.FC<SceneProps> = ({
  modelType,
  materialType,
  wrinkleIntensity,
  ambientIntensity,
  lightAngle,
  isTransitioning
}) => {
  const [key, setKey] = useState(0);

  useEffect(() => {
    setKey((prev) => prev + 1);
  }, [modelType]);

  return (
    <div className={`canvas-wrapper ${isTransitioning ? 'fade' : ''}`}>
      <Canvas
        key={key}
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <SceneContent
          modelType={modelType}
          materialType={materialType}
          wrinkleIntensity={wrinkleIntensity}
          ambientIntensity={ambientIntensity}
          lightAngle={lightAngle}
        />
      </Canvas>
    </div>
  );
};

export default Scene;
