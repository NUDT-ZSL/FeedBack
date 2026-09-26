import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import axios from 'axios'
import PlayerShip from './PlayerShip'
import type { Equipment } from '../../App'
import { FragmentType, FRAGMENT_COLORS } from '../craft/CraftRecipe'

interface GameSceneProps {
  equipment: Equipment | null
  onDamage: () => void
  onCollectFragment: () => void
}

interface Bullet {
  id: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  damage: number
  color: string
}

interface Enemy {
  id: number
  mesh: THREE.Group
  velocity: THREE.Vector3
  health: number
  maxHealth: number
  pattern: 'wave' | 'spiral'
  patternTime: number
  lastShot: number
  shootInterval: number
}

interface EnemyBullet {
  id: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
}

interface Fragment {
  id: number
  mesh: THREE.Mesh
  type: FragmentType
  velocity: THREE.Vector3
  collected: boolean
}

const API_BASE = 'http://localhost:3001/api'

function GameContent({ equipment, onDamage, onCollectFragment }: GameSceneProps) {
  const sceneRef = useRef<THREE.Group>(null)
  const [isDamaged, setIsDamaged] = useState(false)
  const playerPosRef = useRef(new THREE.Vector3(0, -3, 0))
  
  const bulletsRef = useRef<Bullet[]>([])
  const enemiesRef = useRef<Enemy[]>([])
  const enemyBulletsRef = useRef<EnemyBullet[]>([])
  const fragmentsRef = useRef<Fragment[]>([])
  
  const nextIdRef = useRef(1)
  const lastEnemySpawnRef = useRef(0)
  const enemySpawnIntervalRef = useRef(2000)

  const starsGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const starCount = 250
    const positions = new Float32Array(starCount * 3)
    const sizes = new Float32Array(starCount)
    const alphas = new Float32Array(starCount)

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20
      positions[i * 3 + 2] = -10 - Math.random() * 5
      sizes[i] = 1 + Math.random() * 2
      alphas[i] = 0.3 + Math.random() * 0.5
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))

    return geometry
  }, [])

  const starsMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        varying float vTwinkle;
        uniform float time;
        void main() {
          vAlpha = alpha;
          vTwinkle = sin(time * 2.0 + position.x * 10.0) * 0.3 + 0.7;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vTwinkle;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float glow = 1.0 - dist * 2.0;
          gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * vTwinkle * glow);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  }, [])

  const collectFragment = useCallback(async (type: FragmentType) => {
    try {
      await axios.post(`${API_BASE}/collect-fragment`, { type })
      onCollectFragment()
    } catch (err) {
      console.error('Failed to collect fragment:', err)
    }
  }, [onCollectFragment])

  const handleShoot = useCallback((position: THREE.Vector3, color: string, damage: number) => {
    if (!sceneRef.current) return

    const geometry = new THREE.SphereGeometry(0.15, 8, 8)
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    sceneRef.current.add(mesh)

    bulletsRef.current.push({
      id: nextIdRef.current++,
      mesh,
      velocity: new THREE.Vector3(0, 15, 0),
      damage,
      color
    })
  }, [])

  const spawnEnemy = useCallback(() => {
    if (!sceneRef.current) return

    const group = new THREE.Group()
    const geometry = new THREE.OctahedronGeometry(0.8, 0)
    const material = new THREE.MeshStandardMaterial({
      color: '#ff4444',
      emissive: '#ff2222',
      emissiveIntensity: 0.5,
      flatShading: true
    })
    const body = new THREE.Mesh(geometry, material)
    group.add(body)

    const x = (Math.random() - 0.5) * 12
    group.position.set(x, 8, 0)
    sceneRef.current.add(group)

    const pattern: 'wave' | 'spiral' = Math.random() > 0.5 ? 'wave' : 'spiral'

    enemiesRef.current.push({
      id: nextIdRef.current++,
      mesh: group,
      velocity: new THREE.Vector3(0, -2 - Math.random(), 0),
      health: 30,
      maxHealth: 30,
      pattern,
      patternTime: Math.random() * Math.PI * 2,
      lastShot: 0,
      shootInterval: 1500 + Math.random() * 1000
    })
  }, [])

  const spawnEnemyBullet = useCallback((position: THREE.Vector3) => {
    if (!sceneRef.current) return

    const geometry = new THREE.SphereGeometry(0.3, 8, 8)
    const material = new THREE.MeshStandardMaterial({
      color: '#ff0000',
      emissive: '#ff0000',
      emissiveIntensity: 1
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    sceneRef.current.add(mesh)

    const direction = new THREE.Vector3()
      .subVectors(playerPosRef.current, position)
      .normalize()
      .multiplyScalar(5)

    enemyBulletsRef.current.push({
      id: nextIdRef.current++,
      mesh,
      velocity: direction
    })
  }, [])

  const spawnFragment = useCallback((position: THREE.Vector3) => {
    if (!sceneRef.current) return

    const types: FragmentType[] = ['red', 'blue', 'green']
    const type = types[Math.floor(Math.random() * types.length)]

    const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4)
    const material = new THREE.MeshStandardMaterial({
      color: FRAGMENT_COLORS[type],
      emissive: FRAGMENT_COLORS[type],
      emissiveIntensity: 0.8
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    sceneRef.current.add(mesh)

    fragmentsRef.current.push({
      id: nextIdRef.current++,
      mesh,
      type,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        -1 - Math.random(),
        0
      ),
      collected: false
    })
  }, [])

  const handleDamageEnd = useCallback(() => {
    setIsDamaged(false)
  }, [])

  useEffect(() => {
    return () => {
      bulletsRef.current.forEach(b => b.mesh.geometry.dispose())
      enemiesRef.current.forEach(e => e.mesh.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose()
        }
      }))
      enemyBulletsRef.current.forEach(b => b.mesh.geometry.dispose())
      fragmentsRef.current.forEach(f => f.mesh.geometry.dispose())
    }
  }, [])

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime

    if (starsMaterial.uniforms) {
      starsMaterial.uniforms.time.value = time
    }

    if (time * 1000 - lastEnemySpawnRef.current > enemySpawnIntervalRef.current) {
      spawnEnemy()
      lastEnemySpawnRef.current = time * 1000
      enemySpawnIntervalRef.current = Math.max(800, 2000 - time * 50)
    }

    if (sceneRef.current) {
      sceneRef.current.children.forEach(child => {
        if (child instanceof THREE.Points) {
          const positions = child.geometry.attributes.position.array as Float32Array
          for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] -= delta * 0.5
            if (positions[i + 1] < -10) {
              positions[i + 1] = 10
            }
          }
          child.geometry.attributes.position.needsUpdate = true
        }
      })
    }

    for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
      const bullet = bulletsRef.current[i]
      bullet.mesh.position.addScaledVector(bullet.velocity, delta)
      bullet.mesh.rotation.z += delta * 5

      if (bullet.mesh.position.y > 10) {
        sceneRef.current?.remove(bullet.mesh)
        bullet.mesh.geometry.dispose()
        ;(bullet.mesh.material as THREE.Material).dispose()
        bulletsRef.current.splice(i, 1)
      }
    }

    for (let i = enemiesRef.current.length - 1; i >= 0; i--) {
      const enemy = enemiesRef.current[i]
      enemy.patternTime += delta * 3

      let xOffset = 0
      if (enemy.pattern === 'wave') {
        xOffset = Math.sin(enemy.patternTime) * 3
      } else if (enemy.pattern === 'spiral') {
        xOffset = Math.sin(enemy.patternTime) * 2
        enemy.mesh.rotation.z += delta * 2
      }

      enemy.mesh.position.x += (enemy.velocity.x + xOffset * delta) * delta
      enemy.mesh.position.y += enemy.velocity.y * delta

      if (time * 1000 - enemy.lastShot > enemy.shootInterval && enemy.mesh.position.y < 6) {
        spawnEnemyBullet(enemy.mesh.position.clone())
        enemy.lastShot = time * 1000
      }

      if (enemy.mesh.position.y < -10) {
        sceneRef.current?.remove(enemy.mesh)
        enemy.mesh.traverse(c => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose()
            ;(c.material as THREE.Material).dispose()
          }
        })
        enemiesRef.current.splice(i, 1)
        continue
      }

      for (let j = bulletsRef.current.length - 1; j >= 0; j--) {
        const bullet = bulletsRef.current[j]
        const dist = enemy.mesh.position.distanceTo(bullet.mesh.position)
        if (dist < 1) {
          enemy.health -= bullet.damage
          sceneRef.current?.remove(bullet.mesh)
          bullet.mesh.geometry.dispose()
          ;(bullet.mesh.material as THREE.Material).dispose()
          bulletsRef.current.splice(j, 1)

          if (enemy.health <= 0) {
            const fragmentCount = 1 + Math.floor(Math.random() * 2)
            for (let k = 0; k < fragmentCount; k++) {
              spawnFragment(enemy.mesh.position.clone())
            }
            sceneRef.current?.remove(enemy.mesh)
            enemy.mesh.traverse(c => {
              if (c instanceof THREE.Mesh) {
                c.geometry.dispose()
                ;(c.material as THREE.Material).dispose()
              }
            })
            enemiesRef.current.splice(i, 1)
          }
          break
        }
      }
    }

    for (let i = enemyBulletsRef.current.length - 1; i >= 0; i--) {
      const bullet = enemyBulletsRef.current[i]
      bullet.mesh.position.addScaledVector(bullet.velocity, delta)
      bullet.mesh.rotation.x += delta * 2
      bullet.mesh.rotation.y += delta * 2

      const dist = playerPosRef.current.distanceTo(bullet.mesh.position)
      if (dist < 1.2) {
        if (!isDamaged) {
          setIsDamaged(true)
          onDamage()
        }
        sceneRef.current?.remove(bullet.mesh)
        bullet.mesh.geometry.dispose()
        ;(bullet.mesh.material as THREE.Material).dispose()
        enemyBulletsRef.current.splice(i, 1)
        continue
      }

      if (bullet.mesh.position.y < -10 || bullet.mesh.position.y > 10 ||
          bullet.mesh.position.x < -15 || bullet.mesh.position.x > 15) {
        sceneRef.current?.remove(bullet.mesh)
        bullet.mesh.geometry.dispose()
        ;(bullet.mesh.material as THREE.Material).dispose()
        enemyBulletsRef.current.splice(i, 1)
      }
    }

    for (let i = fragmentsRef.current.length - 1; i >= 0; i--) {
      const fragment = fragmentsRef.current[i]
      
      if (!fragment.collected) {
        const distToPlayer = playerPosRef.current.distanceTo(fragment.mesh.position)
        if (distToPlayer < 2) {
          fragment.collected = true
          const pullForce = new THREE.Vector3()
            .subVectors(playerPosRef.current, fragment.mesh.position)
            .normalize()
            .multiplyScalar(20)
          fragment.velocity.add(pullForce.multiplyScalar(delta))
        }

        fragment.mesh.position.addScaledVector(fragment.velocity, delta)
        fragment.mesh.rotation.x += delta * 3
        fragment.mesh.rotation.y += delta * 2

        if (distToPlayer < 0.5) {
          collectFragment(fragment.type)
          sceneRef.current?.remove(fragment.mesh)
          fragment.mesh.geometry.dispose()
          ;(fragment.mesh.material as THREE.Material).dispose()
          fragmentsRef.current.splice(i, 1)
          continue
        }
      }

      if (fragment.mesh.position.y < -10) {
        sceneRef.current?.remove(fragment.mesh)
        fragment.mesh.geometry.dispose()
        ;(fragment.mesh.material as THREE.Material).dispose()
        fragmentsRef.current.splice(i, 1)
      }
    }
  })

  return (
    <group ref={sceneRef}>
      <ambientLight intensity={0.3} />
      <directionalLight position={[0, 5, 5]} intensity={0.8} color="#ffffff" />
      <pointLight position={[0, -5, 0]} intensity={0.5} color="#4444ff" />
      
      <points geometry={starsGeometry} material={starsMaterial} />
      
      <group
        onUpdate={(self) => {
          playerPosRef.current.copy(self.position)
        }}
      >
        <PlayerShip
          equipment={equipment}
          onShoot={handleShoot}
          isDamaged={isDamaged}
          onDamageEnd={handleDamageEnd}
        />
      </group>
    </group>
  )
}

export default function GameScene(props: GameSceneProps) {
  return (
    <Canvas gl={{ antialias: true }} style={{ background: '#0b0c10' }}>
      <OrthographicCamera
        makeDefault
        zoom={50}
        position={[0, 0, 10]}
        near={0.1}
        far={100}
      />
      <fog attach="fog" args={['#0b0c10', 10, 30]} />
      <color attach="background" args={['#0b0c10']} />
      <GameContent {...props} />
    </Canvas>
  )
}
