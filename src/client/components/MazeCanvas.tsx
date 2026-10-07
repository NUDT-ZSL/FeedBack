import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';
import { Howl } from 'howler';

interface Marker {
  x: number;
  z: number;
  text: string;
  color?: string;
}

interface MazeCanvasProps {
  grid: number[][];
  markers?: Marker[];
  mode: 'edit' | 'play';
  theme?: 'dungeon' | 'forest' | 'ice' | 'lava';
  onGridChange?: (newGrid: number[][]) => void;
  onWin?: () => void;
  startPos?: { x: number; z: number };
  endPos?: { x: number; z: number };
}

const themes = {
  dungeon: { wall: '#3a2a1a', floor: '#5c4033', ambient: 0.3 },
  forest: { wall: '#2d4a2d', floor: '#4a6741', ambient: 0.4 },
  ice: { wall: '#a8d8ea', floor: '#e0f0f5', ambient: 0.5 },
  lava: { wall: '#8b2500', floor: '#cd5c5c', ambient: 0.35 },
};

interface WallProps {
  position: [number, number, number];
  color: string;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
  isHovered?: boolean;
}

const Wall: React.FC<WallProps> = ({ position, color, onClick, onPointerOver, onPointerOut, isHovered }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [scale, setScale] = useState(1);

  useFrame((state, delta) => {
    if (meshRef.current) {
      const targetScale = isHovered ? 1.1 : 1;
      setScale(prev => prev + (targetScale - prev) * delta * 8);
      meshRef.current.scale.setScalar(scale);
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={position}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 2, 1]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={isHovered ? 0.8 : 1}
        emissive={isHovered ? '#ffff00' : '#000000'}
        emissiveIntensity={isHovered ? 0.3 : 0}
      />
    </mesh>
  );
};

interface FloorProps {
  position: [number, number, number];
  color: string;
}

const Floor: React.FC<FloorProps> = ({ position, color }) => (
  <mesh position={position} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[1, 1]} />
    <meshStandardMaterial color={color} />
  </mesh>
);

interface MarkerPointProps {
  marker: Marker;
  playerPos?: { x: number; z: number };
}

const MarkerPoint: React.FC<MarkerPointProps> = ({ marker, playerPos }) => {
  const [showBubble, setShowBubble] = useState(false);
  const distance = playerPos
    ? Math.sqrt(Math.pow(marker.x - playerPos.x, 2) + Math.pow(marker.z - playerPos.z, 2))
    : 100;

  useEffect(() => {
    setShowBubble(distance < 1.5);
  }, [distance]);

  return (
    <group position={[marker.x, 1, marker.z]}>
      <Float speed={2} rotationIntensity={0} floatIntensity={0.1}>
        <mesh>
          <torusGeometry args={[0.3, 0.05, 8, 16]} />
          <meshStandardMaterial
            color={marker.color || '#ffd700'}
            emissive={marker.color || '#ffd700'}
            emissiveIntensity={0.5}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.05, 8, 16]} />
          <meshStandardMaterial
            color={marker.color || '#ffd700'}
            emissive={marker.color || '#ffd700'}
            emissiveIntensity={0.5}
          />
        </mesh>
      </Float>
      <AnimatePresence>
        {showBubble && (
          <Text
            position={[0, 1.5, 0]}
            fontSize={0.2}
            color="white"
            anchorX="center"
            anchorY="middle"
          >
            {marker.text}
            <meshBasicMaterial color="white" />
          </Text>
        )}
      </AnimatePresence>
    </group>
  );
};

interface TreasureChestProps {
  position: [number, number, number];
  playerPos?: { x: number; z: number };
  onWin?: () => void;
}

const TreasureChest: React.FC<TreasureChestProps> = ({ position, playerPos, onWin }) => {
  const [won, setWon] = useState(false);
  const chestRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const particlesGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(80 * 3);
    const velocities = new Float32Array(80 * 3);
    
    for (let i = 0; i < 80; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      
      velocities[i * 3] = (Math.random() - 0.5) * 2;
      velocities[i * 3 + 1] = Math.random() * 3;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    
    return geometry;
  }, []);

  useFrame((state, delta) => {
    if (chestRef.current) {
      chestRef.current.rotation.y += delta * 0.5;
    }

    if (won && particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
      const velocities = particlesRef.current.geometry.attributes.velocity.array as Float32Array;
      
      for (let i = 0; i < 80; i++) {
        positions[i * 3] += velocities[i * 3] * delta;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
        velocities[i * 3 + 1] -= delta * 5;
      }
      
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  useEffect(() => {
    if (playerPos && !won) {
      const dx = position[0] - playerPos.x;
      const dz = position[2] - playerPos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < 1) {
        setWon(true);
        onWin?.();
      }
    }
  }, [playerPos, position, won, onWin]);

  return (
    <group position={position}>
      <group ref={chestRef}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.6, 0.4, 0.4]} />
          <meshStandardMaterial color="#8B4513" />
        </mesh>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.6, 0.15, 0.4]} />
          <meshStandardMaterial color="#A0522D" />
        </mesh>
        <mesh position={[0, 0.45, 0.21]}>
          <boxGeometry args={[0.1, 0.1, 0.02]} />
          <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.5} />
        </mesh>
      </group>
      <pointLight position={[0, 1, 0]} color="#FFD700" intensity={2} distance={3} />
      {won && (
        <points ref={particlesRef} geometry={particlesGeometry}>
          <pointsMaterial size={0.1} color="#FFD700" transparent opacity={0.8} />
        </points>
      )}
    </group>
  );
};

interface PlayerControllerProps {
  grid: number[][];
  startPos: { x: number; z: number };
  onPositionChange: (pos: { x: number; z: number }) => void;
}

const PlayerController: React.FC<PlayerControllerProps> = ({ grid, startPos, onPositionChange }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const moveLeft = useRef(false);
  const moveRight = useRef(false);
  const footstepSound = useRef<Howl | null>(null);
  const lastStepTime = useRef(0);

  useEffect(() => {
    camera.position.set(startPos.x, 1.6, startPos.z);
    camera.fov = 70;
    camera.updateProjectionMatrix();

    footstepSound.current = new Howl({
      src: ['/sounds/footstep.mp3'],
      loop: true,
      volume: 0.3,
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': moveForward.current = true; break;
        case 'KeyS': moveBackward.current = true; break;
        case 'KeyA': moveLeft.current = true; break;
        case 'KeyD': moveRight.current = true; break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': moveForward.current = false; break;
        case 'KeyS': moveBackward.current = false; break;
        case 'KeyA': moveLeft.current = false; break;
        case 'KeyD': moveRight.current = false; break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      footstepSound.current?.unload();
    };
  }, [camera, startPos]);

  const checkCollision = useCallback((x: number, z: number): boolean => {
    const gridX = Math.floor(x + 0.5);
    const gridZ = Math.floor(z + 0.5);
    
    if (gridX < 0 || gridX >= grid[0].length || gridZ < 0 || gridZ >= grid.length) {
      return true;
    }
    
    return grid[gridZ][gridX] === 1;
  }, [grid]);

  useFrame((state, delta) => {
    if (!controlsRef.current?.isLocked) {
      footstepSound.current?.pause();
      return;
    }

    const speed = 5;
    const isMoving = moveForward.current || moveBackward.current || moveLeft.current || moveRight.current;

    if (isMoving) {
      velocity.current.x -= velocity.current.x * 10.0 * delta;
      velocity.current.z -= velocity.current.z * 10.0 * delta;

      direction.current.z = Number(moveForward.current) - Number(moveBackward.current);
      direction.current.x = Number(moveRight.current) - Number(moveLeft.current);
      direction.current.normalize();

      if (moveForward.current || moveBackward.current) {
        velocity.current.z -= direction.current.z * speed * delta * 50;
      }
      if (moveLeft.current || moveRight.current) {
        velocity.current.x -= direction.current.x * speed * delta * 50;
      }

      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

      const newPos = camera.position.clone();
      const moveVector = new THREE.Vector3();
      moveVector.addScaledVector(forward, -velocity.current.z * delta);
      moveVector.addScaledVector(right, -velocity.current.x * delta);

      const testX = newPos.x + moveVector.x;
      const testZ = newPos.z + moveVector.z;

      if (!checkCollision(testX, camera.position.z)) {
        newPos.x = testX;
      }
      if (!checkCollision(camera.position.x, testZ)) {
        newPos.z = testZ;
      }

      camera.position.copy(newPos);
      onPositionChange({ x: camera.position.x, z: camera.position.z });

      const currentTime = performance.now();
      const stepInterval = 300 - (Math.abs(velocity.current.z) + Math.abs(velocity.current.x)) * 20;
      
      if (currentTime - lastStepTime.current > stepInterval) {
        footstepSound.current?.play();
        lastStepTime.current = currentTime;
      }
    } else {
      footstepSound.current?.pause();
    }
  });

  return (
    <PointerLockControls ref={controlsRef}>
      <mesh position={[startPos.x, -100, startPos.z]} visible={false} />
    </PointerLockControls>
  );
};

interface EditGridProps {
  grid: number[][];
  theme: keyof typeof themes;
  onGridChange?: (newGrid: number[][]) => void;
}

const EditGrid: React.FC<EditGridProps> = ({ grid, theme, onGridChange }) => {
  const [hoveredCell, setHoveredCell] = useState<{ x: number; z: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'add' | 'remove' | null>(null);
  const themeColors = themes[theme];

  const handleCellClick = useCallback((x: number, z: number, e: any) => {
    e.stopPropagation();
    if (!onGridChange) return;
    
    const newGrid = grid.map(row => [...row]);
    newGrid[z][x] = newGrid[z][x] === 1 ? 0 : 1;
    onGridChange(newGrid);
  }, [grid, onGridChange]);

  const handlePointerDown = useCallback((x: number, z: number, e: any) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragMode(grid[z][x] === 1 ? 'remove' : 'add');
  }, [grid]);

  const handlePointerOver = useCallback((x: number, z: number) => {
    setHoveredCell({ x, z });
    
    if (isDragging && dragMode && onGridChange) {
      const newGrid = grid.map(row => [...row]);
      newGrid[z][x] = dragMode === 'add' ? 1 : 0;
      onGridChange(newGrid);
    }
  }, [isDragging, dragMode, grid, onGridChange]);

  const handlePointerOut = useCallback(() => {
    setHoveredCell(null);
  }, []);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };
    
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const offsetX = (grid[0].length - 1) / 2;
  const offsetZ = (grid.length - 1) / 2;

  return (
    <group>
      {grid.map((row, z) =>
        row.map((cell, x) => {
          const worldX = x - offsetX;
          const worldZ = z - offsetZ;
          const isHovered = hoveredCell?.x === x && hoveredCell?.z === z;

          return (
            <React.Fragment key={`${x}-${z}`}>
              <Floor position={[worldX, -0.5, worldZ]} color={themeColors.floor} />
              {cell === 1 && (
                <Wall
                  position={[worldX, 0.5, worldZ]}
                  color={themeColors.wall}
                  onClick={(e) => handleCellClick(x, z, e)}
                  onPointerDown={(e) => handlePointerDown(x, z, e)}
                  onPointerOver={() => handlePointerOver(x, z)}
                  onPointerOut={handlePointerOut}
                  isHovered={isHovered}
                />
              )}
              {cell === 0 && isHovered && (
                <mesh
                  position={[worldX, 0.5, worldZ]}
                  onClick={(e) => handleCellClick(x, z, e)}
                  onPointerDown={(e) => handlePointerDown(x, z, e)}
                  onPointerOver={() => handlePointerOver(x, z)}
                  onPointerOut={handlePointerOut}
                >
                  <boxGeometry args={[1, 2, 1]} />
                  <meshStandardMaterial
                    color="#ffff00"
                    transparent
                    opacity={0.3}
                  />
                </mesh>
              )}
            </React.Fragment>
          );
        })
      )}
    </group>
  );
};

interface PlayGridProps {
  grid: number[][];
  theme: keyof typeof themes;
  markers?: Marker[];
  endPos?: { x: number; z: number };
  startPos: { x: number; z: number };
  onWin?: () => void;
  onPositionChange: (pos: { x: number; z: number }) => void;
}

const PlayGrid: React.FC<PlayGridProps> = ({
  grid,
  theme,
  markers = [],
  endPos,
  startPos,
  onWin,
  onPositionChange,
}) => {
  const themeColors = themes[theme];
  const [playerPos, setPlayerPos] = useState(startPos);

  const offsetX = (grid[0].length - 1) / 2;
  const offsetZ = (grid.length - 1) / 2;

  const handlePositionChange = useCallback((pos: { x: number; z: number }) => {
    setPlayerPos(pos);
    onPositionChange(pos);
  }, [onPositionChange]);

  return (
    <group>
      <PlayerController
        grid={grid}
        startPos={startPos}
        onPositionChange={handlePositionChange}
      />
      
      {grid.map((row, z) =>
        row.map((cell, x) => {
          const worldX = x - offsetX;
          const worldZ = z - offsetZ;

          return (
            <React.Fragment key={`${x}-${z}`}>
              <Floor position={[worldX, -0.5, worldZ]} color={themeColors.floor} />
              {cell === 1 && (
                <Wall
                  position={[worldX, 0.5, worldZ]}
                  color={themeColors.wall}
                />
              )}
            </React.Fragment>
          );
        })
      )}

      {markers.map((marker, index) => (
        <MarkerPoint
          key={index}
          marker={{
            ...marker,
            x: marker.x - offsetX,
            z: marker.z - offsetZ,
          }}
          playerPos={playerPos}
        />
      ))}

      {endPos && (
        <TreasureChest
          position={[endPos.x - offsetX, 0, endPos.z - offsetZ]}
          playerPos={playerPos}
          onWin={onWin}
        />
      )}
    </group>
  );
};

const MazeCanvas: React.FC<MazeCanvasProps> = ({
  grid,
  markers = [],
  mode,
  theme = 'dungeon',
  onGridChange,
  onWin,
  startPos = { x: 0, z: 0 },
  endPos,
}) => {
  const themeColors = themes[theme];
  const [playerPos, setPlayerPos] = useState(startPos);
  const [showInstructions, setShowInstructions] = useState(mode === 'play');

  const handlePositionChange = useCallback((pos: { x: number; z: number }) => {
    setPlayerPos(pos);
  }, []);

  const gridWidth = grid[0]?.length || 0;
  const gridHeight = grid.length || 0;
  const cameraDistance = Math.max(gridWidth, gridHeight) * 0.8;

  return (
    <div className="w-full h-full relative">
      <AnimatePresence>
        {showInstructions && mode === 'play' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-black/70 text-white px-6 py-3 rounded-lg text-center"
          >
            <p className="text-sm">点击屏幕开始游戏</p>
            <p className="text-xs text-gray-400 mt-1">WASD移动，鼠标拖拽旋转视角</p>
            <button
              onClick={() => setShowInstructions(false)}
              className="mt-2 text-xs text-purple-400 hover:text-purple-300"
            >
              知道了
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Canvas
        shadows
        camera={
          mode === 'edit'
            ? {
                position: [0, cameraDistance, cameraDistance],
                fov: 50,
              }
            : {
                position: [startPos.x, 1.6, startPos.z],
                fov: 70,
              }
        }
        onPointerMissed={() => {}}
      >
        <color attach="background" args={['#1a1a2e']} />
        <fog attach="fog" args={['#1a1a2e', 5, 50]} />
        <ambientLight intensity={themeColors.ambient} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        {mode === 'edit' ? (
          <>
            <EditGrid grid={grid} theme={theme} onGridChange={onGridChange} />
            <OrbitControls
              makeDefault
              enableRotate
              enablePan
              enableZoom
              minDistance={5}
              maxDistance={cameraDistance * 2}
              maxPolarAngle={Math.PI / 2.5}
            />
          </>
        ) : (
          <PlayGrid
            grid={grid}
            theme={theme}
            markers={markers}
            endPos={endPos}
            startPos={startPos}
            onWin={onWin}
            onPositionChange={handlePositionChange}
          />
        )}
      </Canvas>

      {mode === 'edit' && (
        <div className="absolute bottom-4 left-4 bg-black/70 text-white px-4 py-2 rounded-lg text-sm">
          <p>点击或拖拽创建/删除墙壁</p>
          <p className="text-xs text-gray-400">鼠标滚轮缩放，右键拖拽平移</p>
        </div>
      )}
    </div>
  );
};

export default MazeCanvas;
