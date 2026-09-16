/**
 * Animated entities — haul trucks, conveyor belts, ventilation particles,
 * gas sensor pulses, and risk beacons. Each lives inside the R3F Canvas
 * and uses `useFrame` to animate per-frame.
 */
import React, { useMemo, useRef } from 'react'
import { useFrame, ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

// ---------------------------------------------------------------- TRUCK
/**
 * A haul truck that follows a closed-loop spline of 2D waypoints.
 * Each truck has a `phaseOffset` so multiple trucks don't overlap.
 */
export function HaulTruck({ truck }: { truck: any }) {
  const ref = useRef<THREE.Group>(null!)
  const wheels = useRef<THREE.Mesh[]>([])
  const waypoints = useMemo(
    () => truck.waypoints.map(([x, z]: [number, number]) => new THREE.Vector3(x, 0.15, z)),
    [truck],
  )

  // Build a closed Catmull-Rom curve through the waypoints
  const curve = useMemo(() => {
    if (waypoints.length < 2) return null
    return new THREE.CatmullRomCurve3(waypoints, true, 'catmullrom', 0.5)
  }, [waypoints])

  useFrame((state) => {
    if (!curve || !ref.current) return
    // Total time to traverse the loop: 1 / speed
    const t = ((state.clock.elapsedTime * truck.speed) + truck.phase_offset) % 1
    const pos = curve.getPoint(t)
    ref.current.position.copy(pos)
    // Orient along the tangent
    const lookAhead = (t + 0.01) % 1
    const tangent = curve.getPoint(lookAhead).sub(pos).normalize()
    const target = pos.clone().add(tangent)
    ref.current.lookAt(target.x, ref.current.position.y, target.z)
    // Spin wheels
    wheels.current.forEach((w) => {
      if (w) w.rotation.x += 0.15
    })
  })

  return (
    <group ref={ref}>
      {/* Body */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.6, 0.4, 1.0]} />
        <meshStandardMaterial color="#d97706" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Dump bed */}
      <mesh position={[0, 0.55, 0.15]} castShadow rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.55, 0.3, 0.7]} />
        <meshStandardMaterial color="#92400e" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Cab */}
      <mesh position={[0, 0.45, -0.45]} castShadow>
        <boxGeometry args={[0.5, 0.4, 0.35]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Wheels — 4 */}
      {[
        [-0.3, 0.15, 0.35], [0.3, 0.15, 0.35],
        [-0.3, 0.15, -0.35], [0.3, 0.15, -0.35],
      ].map((p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) wheels.current[i] = m
          }}
          position={p as [number, number, number]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.13, 0.13, 0.08, 12]} />
          <meshStandardMaterial color="#1f2937" metalness={0.3} roughness={0.7} />
        </mesh>
      ))}
      {/* Headlight glow */}
      <pointLight position={[0, 0.4, -0.6]} intensity={0.6} distance={3} color="#fff7d6" />
      {/* Label */}
      <Html position={[0, 1.0, 0]} center distanceFactor={12} occlude>
        <div className="pointer-events-none rounded bg-panel/95 px-1 py-0.5 text-[9px] font-mono text-ink shadow">
          {truck.label}
        </div>
      </Html>
    </group>
  )
}

// ---------------------------------------------------------------- CONVEYOR
/**
 * A conveyor belt between two points — the belt surface scrolls via
 * an animated texture offset so the belt looks like it's moving.
 */
export function ConveyorBelt({ conveyor }: { conveyor: any }) {
  const beltRef = useRef<THREE.Mesh>(null!)
  const from = useMemo(() => new THREE.Vector3(conveyor.from[0], 0.8, conveyor.from[1]), [conveyor])
  const to = useMemo(() => new THREE.Vector3(conveyor.to[0], 0.8, conveyor.to[1]), [conveyor])
  const length = useMemo(() => from.distanceTo(to), [from, to])
  const midpoint = useMemo(() => from.clone().add(to).multiplyScalar(0.5), [from, to])
  const quaternion = useMemo(() => {
    const dir = to.clone().sub(from).normalize()
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
    return q
  }, [from, to])

  // Animated texture offset via useFrame
  useFrame((state) => {
    if (!beltRef.current) return
    const mat = beltRef.current.material as THREE.MeshStandardMaterial
    if (mat && mat.map) {
      // Need to clone the texture so we don't mutate the shared one
      if (!mat.userData.offsetted) {
        mat.map = mat.map.clone()
        mat.userData.offsetted = true
      }
      mat.map.offset.x = -((state.clock.elapsedTime * 0.5) % 1)
    }
  })

  // Generate a procedural striped texture for the belt
  const beltTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 8
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(0, 0, 64, 8)
    ctx.fillStyle = '#374151'
    for (let i = 0; i < 64; i += 8) {
      ctx.fillRect(i, 0, 4, 8)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(Math.max(1, length * 2), 1)
    return tex
  }, [length])

  return (
    <group position={midpoint.toArray() as [number, number, number]} quaternion={quaternion}>
      {/* Belt surface */}
      <mesh ref={beltRef} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.05, length]} />
        <meshStandardMaterial map={beltTexture} color="#444b5a" metalness={0.4} roughness={0.7} />
      </mesh>
      {/* Support trestles — every ~1.5 units */}
      {Array.from({ length: Math.max(2, Math.floor(length / 1.5)) }).map((_, i) => {
        const z = -length / 2 + (i + 0.5) * (length / Math.max(2, Math.floor(length / 1.5)))
        return (
          <mesh key={i} position={[0, -0.4, z]}>
            <boxGeometry args={[0.45, 0.8, 0.06]} />
            <meshStandardMaterial color="#5a6478" metalness={0.7} roughness={0.3} />
          </mesh>
        )
      })}
      {/* Pulley housings at the ends */}
      <mesh position={[0, 0, length / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 0.45, 12]} />
        <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0, -length / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 0.45, 12]} />
        <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- VENTILATION
/**
 * Ventilation particles flowing through a duct from `from` to `to`.
 * A series of small emissive spheres that move along the duct direction,
 * fading in and out, simulating airflow.
 */
export function VentilationDuct({ duct }: { duct: any }) {
  const particles = useRef<THREE.Mesh[]>([])
  const from = useMemo(() => new THREE.Vector3(...duct.from), [duct])
  const to = useMemo(() => new THREE.Vector3(...duct.to), [duct])
  const dir = useMemo(() => to.clone().sub(from), [from, to])
  const length = dir.length()

  useFrame((state) => {
    particles.current.forEach((p, i) => {
      if (!p) return
      // Each particle moves at a slightly different speed and phase
      const speed = 0.6 + (i * 0.05) % 0.4
      const phase = (state.clock.elapsedTime * speed + i * 0.3) % 1
      const pos = from.clone().add(dir.clone().multiplyScalar(phase))
      p.position.copy(pos)
      // Fade in/out at the ends
      const fade = Math.sin(phase * Math.PI)
      const mat = p.material as THREE.MeshStandardMaterial
      if (mat) mat.opacity = 0.6 * fade
    })
  })

  return (
    <group>
      {/* Duct housing — translucent tube */}
      <mesh position={from.clone().add(dir.clone().multiplyScalar(0.5)).toArray()}>
        <cylinderGeometry args={[0.18, 0.18, length, 12, 1, true]} />
        <meshStandardMaterial
          color="#4a5568"
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
        <group quaternion={(() => {
          const q = new THREE.Quaternion()
          q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
          return q
        })()} />
      </mesh>
      {/* Particles */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) particles.current[i] = m
          }}
        >
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#60a5fa" emissive="#3b82f6" emissiveIntensity={0.9} transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- GAS SENSOR
/**
 * A gas sensor — small box on a pole, with an animated status indicator.
 * Alarming sensors pulse red; normal sensors glow green.
 */
export function GasSensor({ sensor }: { sensor: any }) {
  const indicator = useRef<THREE.Mesh>(null!)
  const isAlarm = sensor.status === 'ALARM'
  useFrame((state) => {
    if (!indicator.current) return
    const t = state.clock.elapsedTime
    const pulse = isAlarm ? 0.5 + 0.5 * Math.sin(t * 4) : 0.4 + 0.1 * Math.sin(t * 1.5)
    const mat = indicator.current.material as THREE.MeshStandardMaterial
    if (mat) mat.emissiveIntensity = pulse * 1.5
  })
  return (
    <group position={sensor.position}>
      {/* Pole */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 2.0, 8]} />
        <meshStandardMaterial color="#4a5568" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Sensor box */}
      <mesh position={[0, 2.0, 0]} castShadow>
        <boxGeometry args={[0.3, 0.2, 0.15]} />
        <meshStandardMaterial color="#374151" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Status indicator — emissive sphere */}
      <mesh ref={indicator} position={[0, 2.15, 0.08]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshStandardMaterial
          color={isAlarm ? '#dc2626' : '#10b981'}
          emissive={isAlarm ? '#dc2626' : '#10b981'}
          emissiveIntensity={1.0}
        />
      </mesh>
      <Html position={[0, 2.4, 0]} center distanceFactor={11} occlude>
        <div className="pointer-events-none flex flex-col items-center gap-0.5">
          <div className={`rounded px-1 py-0.5 text-[8px] font-mono shadow ${isAlarm ? 'bg-[#dc2626] text-white' : 'bg-panel/95 text-ink'}`}>
            {sensor.id}
          </div>
          <div className="text-[9px] font-mono text-ink">
            CH₄ {sensor.reading_pct.toFixed(2)}%
          </div>
        </div>
      </Html>
    </group>
  )
}

// ---------------------------------------------------------------- BEACON
/**
 * Risk beacon — a vertical light beam rising from a CRITICAL zone.
 * The beam pulses slowly and is visible across the whole scene so a
 * judge walking the room can see where the risk is from any angle.
 */
export function RiskBeacon({ beacon, heightFactor = 1.0 }: { beacon: any; heightFactor?: number }) {
  const beamRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const pulse = 0.5 + 0.5 * Math.sin(t * (beacon.pulse_hz || 0.8) * Math.PI * 2)
    if (beamRef.current) {
      const mat = beamRef.current.material as THREE.MeshBasicMaterial
      if (mat) mat.opacity = 0.25 + 0.35 * pulse
    }
    if (ringRef.current) {
      ringRef.current.scale.x = ringRef.current.scale.z = 1 + pulse * 1.5
      const mat = ringRef.current.material as THREE.MeshBasicMaterial
      if (mat) mat.opacity = 0.6 * (1 - pulse)
    }
  })
  const height = beacon.height * heightFactor
  return (
    <group position={beacon.position}>
      {/* The vertical beam */}
      <mesh ref={beamRef} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.18, 0.32, height, 12, 1, true]} />
        <meshBasicMaterial color={beacon.color} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* A ground-level ring that expands and fades */}
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.9, 32]} />
        <meshBasicMaterial color={beacon.color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* A bright base sphere */}
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshBasicMaterial color={beacon.color} />
      </mesh>
      <pointLight position={[0, height / 2, 0]} intensity={1.2} distance={12} color={beacon.color} />
    </group>
  )
}

// ---------------------------------------------------------------- VIOLATION MARKER
/**
 * A floating red sphere for each open violation on a zone. Severity
 * determines the size — CRITICAL violations are the largest.
 */
export function ViolationMarker({ marker }: { marker: any }) {
  const ref = useRef<THREE.Mesh>(null!)
  const sevColor = marker.severity === 'CRITICAL' ? '#dc2626' : marker.severity === 'HIGH' ? '#f87171' : marker.severity === 'MEDIUM' ? '#fb923c' : '#facc15'
  const sevSize = marker.severity === 'CRITICAL' ? 0.18 : marker.severity === 'HIGH' ? 0.14 : 0.1
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    ref.current.position.y = marker.position[1] + 0.15 * Math.sin(t * 1.2 + marker.position[0])
  })
  return (
    <group position={marker.position}>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[sevSize, 12, 12]} />
        <meshStandardMaterial color={sevColor} emissive={sevColor} emissiveIntensity={0.6} />
      </mesh>
      <pointLight position={[0, 0, 0]} intensity={0.2} distance={1.5} color={sevColor} />
    </group>
  )
}

// ---------------------------------------------------------------- WORKER CLUSTER
/**
 * A cluster of workers at the muster point — a low dome with N dots on it.
 * The cluster size is derived from live attendance data.
 */
export function WorkerCluster({ cluster }: { cluster: any }) {
  // Render N small dots arranged in a grid — capped at 30 dots to keep draw calls reasonable
  const dotCount = Math.min(30, Math.max(3, Math.floor(Math.sqrt(cluster.count)) * 2))
  const positions = useMemo(() => {
    const out: [number, number, number][] = []
    const side = Math.ceil(Math.sqrt(dotCount))
    for (let i = 0; i < dotCount; i++) {
      const r = Math.floor(i / side)
      const c = i % side
      out.push([(c - side / 2) * 0.18 + (cluster.position[0] as number), 0.02, (r - side / 2) * 0.18 + (cluster.position[2] as number)])
    }
    return out
  }, [dotCount, cluster.position])

  const isOff = cluster.shift === 'OFF'
  const dotColor = isOff ? '#6b7280' : '#fbbf24'

  return (
    <group>
      {/* Platform */}
      <mesh position={[cluster.position[0], 0, cluster.position[2]]} receiveShadow>
        <cylinderGeometry args={[1.0, 1.1, 0.04, 24]} />
        <meshStandardMaterial color="#374151" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* Workers */}
      {positions.map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color={dotColor} emissive={dotColor} emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  )
}
