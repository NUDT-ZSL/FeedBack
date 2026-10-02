import { useEffect, useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/store/useStore';
import { clamp } from '@/utils/curveInterpolation';
import { LIGHT_CONSTRAINTS, MURAL_DIMENSIONS } from '@/types';

export function LightController() {
  const { camera, size } = useThree();
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const setLightSource = useStore((state) => state.setLightSource);

  const updateLightPosition = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const ndc = new THREE.Vector2(x, y);
    raycasterRef.current.setFromCamera(ndc, camera);
    
    const targetPoint = new THREE.Vector3();
    raycasterRef.current.ray.intersectPlane(planeRef.current, targetPoint);

    if (targetPoint) {
      const halfWidth = MURAL_DIMENSIONS.width / 2;
      const halfHeight = MURAL_DIMENSIONS.height / 2;
      
      const clampedX = clamp(targetPoint.x, -halfWidth, halfWidth);
      const clampedY = clamp(targetPoint.y, -halfHeight, halfHeight);
      
      const currentState = useStore.getState().lightSource;
      setLightSource({
        x: clampedX,
        y: clampedY,
        z: currentState.z,
      });
    }
  }, [camera, setLightSource]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    updateLightPosition(e.clientX, e.clientY);
  }, [updateLightPosition]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) {
      updateLightPosition(e.clientX, e.clientY);
    } else {
      updateLightPosition(e.clientX, e.clientY);
    }
  }, [updateLightPosition]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    
    const currentState = useStore.getState().lightSource;
    const newRadius = clamp(
      currentState.radius + delta,
      LIGHT_CONSTRAINTS.minRadiusThree,
      LIGHT_CONSTRAINTS.maxRadiusThree
    );
    
    setLightSource({ radius: newRadius });
  }, [setLightSource]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 cursor-none"
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      style={{ touchAction: 'none' }}
    />
  );
}
