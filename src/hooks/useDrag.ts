import { useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { Transform } from '../types';
import { useAppStore } from '../store';
import { isNearTarget, isInErrorZone } from '../utils/helpers';
import { AssemblyMode } from '../types';

interface UseDragOptions {
  id: string;
  enabled: boolean;
}

export const useDrag = ({ id, enabled }: UseDragOptions) => {
  const { camera, raycaster, mouse, size } = useThree();
  const isDragging = useRef(false);
  const dragPlane = useRef(new THREE.Plane());
  const dragOffset = useRef(new THREE.Vector3());
  const intersectionPoint = useRef(new THREE.Vector3());
  const meshRef = useRef<THREE.Mesh>(null);

  const {
    mode,
    selectedComponentId,
    draggingComponentId,
    selectComponent,
    setDragging,
    moveComponent,
    snapToTarget,
    errorSnap,
    playSound,
    components,
  } = useAppStore((state) => ({
    mode: state.mode,
    selectedComponentId: state.selectedComponentId,
    draggingComponentId: state.draggingComponentId,
    selectComponent: state.selectComponent,
    setDragging: state.setDragging,
    moveComponent: state.moveComponent,
    snapToTarget: state.snapToTarget,
    errorSnap: state.errorSnap,
    playSound: state.playSound,
    components: state.components,
  }));

  const component = components.find((c) => c.id === id);
  const canDrag = enabled && mode === AssemblyMode.Assemble && !component?.isSnapped;

  const getNextAssemblyOrder = useCallback(() => {
    const snappedComponents = components.filter((c) => c.isSnapped && c.assemblyOrder <= 12);
    if (snappedComponents.length === 0) return 1;
    const maxOrder = Math.max(...snappedComponents.map((c) => c.assemblyOrder));
    return maxOrder + 1;
  }, [components]);

  const canDragThisComponent = useCallback(() => {
    if (!canDrag) return false;
    if (!component) return false;
    const nextOrder = getNextAssemblyOrder();
    return component.assemblyOrder <= nextOrder;
  }, [canDrag, component, getNextAssemblyOrder]);

  const onPointerDown = useCallback(
    (event: any) => {
      if (!canDragThisComponent()) return;

      event.stopPropagation();
      event.setPointerCapture?.(event.pointerId);

      if (selectedComponentId !== id) {
        selectComponent(id);
      }

      const mesh = event.object as THREE.Mesh;
      meshRef.current = mesh;

      const worldPosition = new THREE.Vector3();
      mesh.getWorldPosition(worldPosition);

      dragPlane.current.setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 1, 0),
        worldPosition
      );

      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(dragPlane.current, intersectionPoint.current)) {
        dragOffset.current.copy(worldPosition).sub(intersectionPoint.current);
      }

      isDragging.current = true;
      setDragging(id);
      playSound('drag', 0.2, 1.1);

      document.body.style.cursor = 'grabbing';
    },
    [id, canDragThisComponent, selectedComponentId, selectComponent, setDragging, playSound, camera, mouse, raycaster]
  );

  const onPointerMove = useCallback(
    (event: any) => {
      if (!isDragging.current || draggingComponentId !== id) return;

      event.stopPropagation();

      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(dragPlane.current, intersectionPoint.current)) {
        const newPosition: Transform = {
          x: intersectionPoint.current.x + dragOffset.current.x,
          y: Math.max(5, intersectionPoint.current.y + dragOffset.current.y),
          z: intersectionPoint.current.z + dragOffset.current.z,
        };

        moveComponent(id, newPosition);
      }
    },
    [id, draggingComponentId, moveComponent, camera, mouse, raycaster]
  );

  const onPointerUp = useCallback(
    (event: any) => {
      if (!isDragging.current || draggingComponentId !== id) return;

      event.stopPropagation();
      event.releasePointerCapture?.(event.pointerId);

      isDragging.current = false;
      setDragging(null);
      document.body.style.cursor = 'auto';

      if (component) {
        if (isNearTarget(component)) {
          snapToTarget(id);
        } else if (isInErrorZone(component)) {
          errorSnap(id);
        }
      }
    },
    [id, draggingComponentId, component, setDragging, snapToTarget, errorSnap]
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging.current || draggingComponentId !== id) return;

      const x = (e.clientX / size.width) * 2 - 1;
      const y = -(e.clientY / size.height) * 2 + 1;

      mouse.set(x, y);
      raycaster.setFromCamera(mouse, camera);

      if (raycaster.ray.intersectPlane(dragPlane.current, intersectionPoint.current)) {
        const newPosition: Transform = {
          x: intersectionPoint.current.x + dragOffset.current.x,
          y: Math.max(5, intersectionPoint.current.y + dragOffset.current.y),
          z: intersectionPoint.current.z + dragOffset.current.z,
        };

        moveComponent(id, newPosition);
      }
    };

    const handlePointerUp = () => {
      if (!isDragging.current || draggingComponentId !== id) return;

      isDragging.current = false;
      setDragging(null);
      document.body.style.cursor = 'auto';

      if (component) {
        if (isNearTarget(component)) {
          snapToTarget(id);
        } else if (isInErrorZone(component)) {
          errorSnap(id);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [id, draggingComponentId, component, setDragging, moveComponent, snapToTarget, errorSnap, camera, mouse, raycaster, size]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    canDrag: canDragThisComponent(),
    isDragging: draggingComponentId === id,
  };
};
