/**
 * Mine shafts, galleries and benches — mine-type-specific geometry.
 *
 * For UNDERGROUND mines we draw a vertical shaft going down from the
 * surface to the extraction zone, with horizontal galleries at the
 * extraction depth. For OPEN_CAST mines we draw stepped terraced
 * benches cut into the surface, mimicking a real open-cast profile.
 *
 * Both are derived from the zone's schematic geometry — not latents —
 * so the 3D view always agrees with the 2D schematic and the dossier
 * drawer.
 */
import React, { useMemo } from 'react'
import { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

// ------------------------------------------------------------------ SHAFT
export function UndergroundShaft({
  position,
  size,
  riskColor,
  selected,
  onClick,
}: {
  position: [number, number, number]
  size: [number, number]
  riskColor: string
  selected: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
}) {
  const shaftRadius = Math.min(size[0], size[1]) * 0.18
  const shaftDepth = 8.0
  const galleryLength = Math.max(size[0], size[1]) * 0.9

  const galleries = useMemo(() => {
    const out: { depth: number; rotY: number; length: number }[] = []
    for (let i = 0; i < 3; i++) {
      out.push({
        depth: 4 + i * 2,
        rotY: (i * Math.PI) / 2,
        length: galleryLength,
      })
    }
    return out
  }, [galleryLength])

  return (
    <group position={position}>
      <mesh position={[0, 0.05, 0]} onClick={onClick}>
        <cylinderGeometry args={[shaftRadius * 1.4, shaftRadius * 1.4, 0.2, 24]} />
        <meshStandardMaterial color="#4a5568" metalness={0.6} roughness={0.3} />
      </mesh>
      <group position={[0, 1.5, 0]}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[shaftRadius * 2.5, 3.0, shaftRadius * 0.4]} />
          <meshStandardMaterial color="#5a6478" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.6, 0]}>
          <cylinderGeometry args={[shaftRadius * 0.4, shaftRadius * 0.4, 0.2, 16]} />
          <meshStandardMaterial color="#2d3748" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[shaftRadius * 0.15, 0.6, shaftRadius * 0.15]} />
          <meshStandardMaterial color={riskColor} emissive={riskColor} emissiveIntensity={selected ? 0.7 : 0.3} />
        </mesh>
      </group>
      <mesh position={[0, -shaftDepth / 2, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftDepth, 20, 1, true]} />
        <meshStandardMaterial
          color={riskColor}
          emissive={riskColor}
          emissiveIntensity={selected ? 0.4 : 0.15}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {galleries.map((g, i) => (
        <group key={i} position={[0, -g.depth, 0]} rotation={[0, g.rotY, 0]}>
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[shaftRadius * 0.7, shaftRadius * 0.7, g.length, 12, 1, true]} />
            <meshStandardMaterial
              color={riskColor}
              emissive={riskColor}
              emissiveIntensity={selected ? 0.5 : 0.2}
              transparent
              opacity={0.45}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, 0, g.length / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[shaftRadius * 0.7, shaftRadius * 0.08, 8, 16]} />
            <meshStandardMaterial color="#1a202c" />
          </mesh>
          <mesh position={[0, 0, -g.length / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[shaftRadius * 0.7, shaftRadius * 0.08, 8, 16]} />
            <meshStandardMaterial color="#1a202c" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ BENCHES
export function OpenCastBenches({
  position,
  size,
  height,
  riskColor,
  selected,
  onClick,
}: {
  position: [number, number, number]
  size: [number, number]
  height: number
  riskColor: string
  selected: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
}) {
  const benchCount = 4
  const benchHeight = height / benchCount
  const baseW = size[0]
  const baseD = size[1]
  const shrinkPerStep = 0.85

  return (
    <group position={position}>
      {Array.from({ length: benchCount }).map((_, i) => {
        const scale = Math.pow(shrinkPerStep, i)
        const w = baseW * scale
        const d = baseD * scale
        const y = -i * benchHeight * 0.6
        return (
          <group key={i}>
            <mesh position={[0, y, 0]} receiveShadow onClick={onClick}>
              <boxGeometry args={[w, 0.15, d]} />
              <meshStandardMaterial
                color={riskColor}
                emissive={riskColor}
                emissiveIntensity={selected ? 0.5 : 0.18}
                transparent
                opacity={0.75 - i * 0.1}
                metalness={0.15}
                roughness={0.85}
              />
            </mesh>
            <mesh position={[0, y - benchHeight * 0.3, 0]}>
              <boxGeometry args={[w, benchHeight, d]} />
              <meshStandardMaterial
                color="#5a4a3a"
                roughness={0.95}
                metalness={0.05}
                transparent
                opacity={0.85}
              />
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, -benchCount * benchHeight * 0.6 - 0.1, 0]} receiveShadow>
        <boxGeometry args={[baseW * Math.pow(shrinkPerStep, benchCount), 0.1, baseD * Math.pow(shrinkPerStep, benchCount)]} />
        <meshStandardMaterial color="#2d2018" roughness={1.0} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ BUILDING
export function BuildingStructure({
  position,
  size,
  height,
  riskColor,
  selected,
  onClick,
}: {
  position: [number, number, number]
  size: [number, number]
  height: number
  riskColor: string
  selected: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
}) {
  const roofHeight = height * 0.3
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow onClick={onClick}>
        <boxGeometry args={[size[0], height, size[1]]} />
        <meshStandardMaterial
          color="#3d4458"
          emissive={riskColor}
          emissiveIntensity={selected ? 0.4 : 0.12}
          metalness={0.4}
          roughness={0.55}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh position={[0, height + roofHeight * 0.3, 0]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[size[0] * 1.05, roofHeight, size[1] * 1.05]} />
        <meshStandardMaterial color="#2d3142" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, height + roofHeight * 0.6, 0]}>
        <boxGeometry args={[size[0] * 0.9, 0.08, size[1] * 0.9]} />
        <meshStandardMaterial color={riskColor} emissive={riskColor} emissiveIntensity={selected ? 0.9 : 0.45} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ WATER BODY
export function WaterBody({
  position,
  size,
  depth,
}: {
  position: [number, number, number]
  size: [number, number]
  depth: number
}) {
  return (
    <group position={position}>
      <mesh position={[0, -depth / 2, 0]} receiveShadow>
        <boxGeometry args={[size[0] + 0.2, depth, size[1] + 0.2]} />
        <meshStandardMaterial color="#3a4a3a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[size[0], 0.05, size[1]]} />
        <meshStandardMaterial
          color="#1e3a5f"
          emissive="#4a7fa8"
          emissiveIntensity={0.4}
          transparent
          opacity={0.85}
          metalness={0.85}
          roughness={0.15}
        />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ STOCKPILE
export function StockpileCone({
  position,
  height,
  radius,
  material,
}: {
  position: [number, number, number]
  height: number
  radius: number
  material: 'COAL' | 'OVERBURDEN'
}) {
  const color = material === 'COAL' ? '#1a1a1a' : '#6b5544'
  return (
    <mesh position={[position[0], height / 2, position[2]]} castShadow receiveShadow>
      <coneGeometry args={[radius, height, 16]} />
      <meshStandardMaterial color={color} roughness={0.95} metalness={0.05} />
    </mesh>
  )
}

// ------------------------------------------------------------------ TREE
export function Tree({
  position,
  height,
}: {
  position: [number, number, number]
  height: number
}) {
  return (
    <group position={position}>
      <mesh position={[0, height * 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, height * 0.5, 6]} />
        <meshStandardMaterial color="#4a2d1a" roughness={0.95} />
      </mesh>
      <mesh position={[0, height * 0.6, 0]} castShadow>
        <coneGeometry args={[0.45, height * 0.6, 8]} />
        <meshStandardMaterial color="#2d6a4f" roughness={0.8} />
      </mesh>
      <mesh position={[0, height * 0.85, 0]} castShadow>
        <coneGeometry args={[0.3, height * 0.4, 8]} />
        <meshStandardMaterial color="#40916c" roughness={0.8} />
      </mesh>
    </group>
  )
}
