import { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Product, FilterState } from './types';
import { COLOR_MAP } from './types';

interface Scene3DProps {
  products: Product[];
  selectedIds: string[];
  filters: FilterState;
  isFilterReset: boolean;
  onSelectProduct: (id: string) => void;
}

interface ProductCardProps {
  product: Product;
  index: number;
  total: number;
  isSelected: boolean;
  isFiltered: boolean;
  isComparing: boolean;
  compareIndex: number;
  compareTotal: number;
  filterReset: boolean;
  onSelect: (id: string) => void;
}

function createTextTexture(text: string, subText?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 340;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#e94560');
  gradient.addColorStop(1, '#0f3460');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const lines = text.split(' ');
  let y = canvas.height / 2 - (lines.length - 1) * 20;
  lines.forEach(line => {
    ctx.fillText(line, canvas.width / 2, y);
    y += 45;
  });

  if (subText) {
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(subText, canvas.width / 2, canvas.height - 60);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createBackTexture(description: string, params: string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 340;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(description, canvas.width / 2, 60);

  ctx.font = '22px sans-serif';
  ctx.textAlign = 'left';
  let y = 130;
  params.forEach(param => {
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(param, 60, y);
    y += 40;
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function ProductCard({
  product,
  index,
  total,
  isSelected,
  isFiltered,
  isComparing,
  compareIndex,
  compareTotal,
  filterReset,
  onSelect
}: ProductCardProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [bounceOffset, setBounceOffset] = useState(0);
  const bounceRef = useRef(0);

  const frontTexture = useMemo(
    () => createTextTexture(product.name, `¥${product.price}`),
    [product.name, product.price]
  );

  const backTexture = useMemo(
    () => createBackTexture(product.description, [
      `尺寸: ${product.size}cm`,
      `颜色: ${product.color}`,
      `材质: ${product.material}`,
      `库存: ${product.stock}/${product.maxStock}`
    ]),
    [product]
  );

  const targetPosition = useMemo(() => {
    if (isComparing && isSelected) {
      const spacing = 4;
      const totalWidth = (compareTotal - 1) * spacing;
      const x = compareIndex * spacing - totalWidth / 2;
      return new THREE.Vector3(x, 0, 0);
    }
    const spread = 6;
    const angle = (index / total) * Math.PI * 0.8 - Math.PI * 0.4;
    const radius = 8 + (index % 3) * 2;
    const z = -radius + Math.random() * 2 - 1;
    const x = Math.sin(angle) * spread;
    const y = (index - total / 2) * 1.5;
    return new THREE.Vector3(x, y, z);
  }, [isComparing, isSelected, compareIndex, compareTotal, index, total]);

  useEffect(() => {
    if (!isFiltered && !filterReset) {
      bounceRef.current = 1;
    }
  }, [isFiltered, filterReset]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;

    mesh.position.x += (targetPosition.x - mesh.position.x) * 0.05;
    mesh.position.y += (targetPosition.y + bounceOffset - mesh.position.y) * 0.05;
    mesh.position.z += (targetPosition.z - mesh.position.z) * 0.05;

    if (bounceRef.current > 0) {
      bounceRef.current -= delta * 2;
      const bounce = Math.sin(bounceRef.current * Math.PI) * 0.2;
      setBounceOffset(Math.max(0, bounce));
    }

    const shouldRotate = !hovered && !isFiltered && !isComparing;
    if (shouldRotate) {
      mesh.rotation.y += delta * 0.5;
    } else if (isComparing && isSelected) {
      mesh.rotation.y += (0 - mesh.rotation.y) * 0.1;
    }

    const targetScale = hovered ? 1.2 : (isSelected ? 1.1 : 1);
    mesh.scale.x += (targetScale - mesh.scale.x) * 0.1;
    mesh.scale.y += (targetScale - mesh.scale.y) * 0.1;
    mesh.scale.z += (targetScale - mesh.scale.z) * 0.1;

    const material = mesh.material as THREE.MeshStandardMaterial[];
    const targetOpacity = isFiltered ? 0.2 : 1;
    material.forEach(mat => {
      mat.opacity += (targetOpacity - mat.opacity) * 0.1;
      mat.transparent = targetOpacity < 1;
    });
  });

  const accentColor = COLOR_MAP[product.color] || '#e94560';
  const emissionColor = hovered || isSelected ? '#00d2ff' : '#000000';
  const emissionIntensity = hovered || isSelected ? 0.5 : 0;

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[targetPosition.x, targetPosition.y, targetPosition.z]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'default';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(product.id);
        }}
      >
        <boxGeometry args={[3, 2, 0.5]} />
        <meshStandardMaterial
          attach="material-0"
          map={frontTexture}
          transparent
          emissive={emissionColor}
          emissiveIntensity={emissionIntensity}
        />
        <meshStandardMaterial
          attach="material-1"
          map={backTexture}
          transparent
          emissive={emissionColor}
          emissiveIntensity={emissionIntensity}
        />
        <meshStandardMaterial
          attach="material-2"
          color={accentColor}
          transparent
          emissive={emissionColor}
          emissiveIntensity={emissionIntensity * 0.5}
        />
        <meshStandardMaterial
          attach="material-3"
          color={accentColor}
          transparent
          emissive={emissionColor}
          emissiveIntensity={emissionIntensity * 0.5}
        />
        <meshStandardMaterial
          attach="material-4"
          color={accentColor}
          transparent
          emissive={emissionColor}
          emissiveIntensity={emissionIntensity * 0.5}
        />
        <meshStandardMaterial
          attach="material-5"
          color={accentColor}
          transparent
          emissive={emissionColor}
          emissiveIntensity={emissionIntensity * 0.5}
        />
      </mesh>

      {hovered && (
        <Billboard position={[targetPosition.x, targetPosition.y + 2.5, targetPosition.z]}>
          <Html center style={{ pointerEvents: 'none' }}>
            <div style={{
              background: 'rgba(15, 52, 96, 0.95)',
              border: '1px solid #00d2ff',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#fff',
              fontSize: '12px',
              minWidth: '180px',
              boxShadow: '0 0 20px rgba(0, 210, 255, 0.3)',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#00d2ff' }}>
                {product.name}
              </div>
              <div>价格: ¥{product.price}</div>
              <div>尺寸: {product.size}cm</div>
              <div>颜色: {product.color}</div>
              <div>材质: {product.material}</div>
              <div>库存: {product.stock}/{product.maxStock}</div>
            </div>
          </Html>
        </Billboard>
      )}
    </group>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#16213e" />
    </mesh>
  );
}

function CameraController({ isComparing }: { isComparing: boolean }) {
  const { camera } = useThree();
  const targetZ = isComparing ? 14 : 12;

  useFrame(() => {
    camera.position.z += (targetZ - camera.position.z) * 0.02;
  });

  return null;
}

function SceneContent({
  products,
  selectedIds,
  filters,
  isFilterReset,
  onSelectProduct
}: Omit<Scene3DProps, 'products'> & { products: Product[] }) {
  const isComparing = selectedIds.length >= 2;

  const isProductFiltered = (product: Product): boolean => {
    if (product.price < filters.priceRange[0] || product.price > filters.priceRange[1]) return true;
    if (product.size < filters.sizeRange[0] || product.size > filters.sizeRange[1]) return true;
    if (filters.colors.length > 0 && !filters.colors.includes(product.color)) return true;
    if (filters.materials.length > 0 && !filters.materials.includes(product.material)) return true;
    return false;
  };

  const selectedProductsList = products.filter(p => selectedIds.includes(p.id));

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
      <pointLight position={[-10, 5, -10]} intensity={0.5} color="#e94560" />
      <pointLight position={[10, 5, -10]} intensity={0.5} color="#0f3460" />

      <CameraController isComparing={isComparing} />
      <Ground />

      {products.map((product, index) => {
        const compareIndex = selectedProductsList.findIndex(p => p.id === product.id);
        return (
          <ProductCard
            key={product.id}
            product={product}
            index={index}
            total={products.length}
            isSelected={selectedIds.includes(product.id)}
            isFiltered={isProductFiltered(product)}
            isComparing={isComparing}
            compareIndex={compareIndex >= 0 ? compareIndex : 0}
            compareTotal={selectedIds.length}
            filterReset={isFilterReset}
            onSelect={onSelectProduct}
          />
        );
      })}

      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={25}
        maxPolarAngle={Math.PI / 2 + 0.2}
      />
    </>
  );
}

const Scene3D: React.FC<Scene3DProps> = ({
  products,
  selectedIds,
  filters,
  isFilterReset,
  onSelectProduct
}) => {
  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 60 }}
      style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
      frameloop="always"
    >
      <fog attach="fog" args={['#1a1a2e', 15, 40]} />
      <SceneContent
        products={products}
        selectedIds={selectedIds}
        filters={filters}
        isFilterReset={isFilterReset}
        onSelectProduct={onSelectProduct}
      />
    </Canvas>
  );
};

export default Scene3D;
