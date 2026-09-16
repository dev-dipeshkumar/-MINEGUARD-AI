import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html, Environment, Grid, ContactShadows, Line } from '@react-three/drei'
import * as THREE from 'three'
import { Badge, Button, Icon, SegmentedControl, cx } from '../ui'
import { bandFor, fmt } from '../../lib/format'
import { useAsync } from '../../state/app'
import { api, endpoints } from '../../lib/api'
import {
  UndergroundShaft,
  OpenCastBenches,
  BuildingStructure,
  WaterBody,
  StockpileCone,
  Tree,
} from './Geometry'
import {
  HaulTruck,
  ConveyorBelt,
  VentilationDuct,
  GasSensor,
  RiskBeacon,
  ViolationMarker,
  WorkerCluster,
} from './Entities'

/**
 * MineScene3D — the deep 3D mine site view.
 *
 * This is the novel feature of v2.1: a per-mine immersive scene that
 * composes mine-type-specific geometry (underground shafts / open-cast
 * benches), zone-type-specific structures (buildings, water bodies,
 * stockpiles, trees), and animated entities (haul trucks, conveyor belts,
 * ventilation particles, gas sensors, risk beacons) into a single scene.
 *
 * The scene also supports:
 *   * Layer toggles (risk zones, violations, alerts, workers)
 *   * A time scrubber that animates zone heights through 90-day risk history
 *   * Camera presets (overview, top-down, oblique, underground cutaway)
 *
 * See docs/3D_MAP.md for the full design rationale.
 */

// ----------------------------------------------------------------- helpers
const RISK_TO_HEIGHT = (score: number) => 0.4 + (score / 100) * 3.6

function toneToHex(tone: string): string {
  const map: Record<string, string> = {
    low: '#4ade80', moderate: '#facc15', elevated: '#fb923c',
    high: '#f87171', critical: '#dc2626',
  }
  return map[tone] ?? '#94a3b8'
}

interface SceneZone {
  id: string
  name: string
  short_name: string
  zone_type: string
  mine_type?: string
  geometry: { x: number; y: number; w: number; h: number }
  latitude?: number
  longitude?: number
  risk_score: number
  risk_level: string
  risk_tone: string
  compliance_score: number
  open_violations: number
  history_90d?: number[]
  beacon?: any
  violation_markers?: any[]
  position?: [number, number, number]
  size?: [number, number]
}

// ----------------------------------------------------------------- ZONE BOX
interface ZoneBoxProps {
  zone: SceneZone
  position: [number, number, number]
  size: [number, number]
  height: number
  selected: boolean
  hovered: boolean
  onClick: () => void
  onHover: (id: string | null) => void
  showViolations: boolean
  showBeacon: boolean
}

function ZoneBox({ zone, position, size, height, selected, hovered, onClick, onHover, showViolations, showBeacon }: ZoneBoxProps) {
  const ref = useRef<THREE.Mesh>(null!)
  const tone = zone.risk_tone ?? bandFor(zone.risk_score).tone
  const color = toneToHex(tone)
  const isCritical = tone === 'critical' || tone === 'high'
  const isUnderground = zone.mine_type === 'UNDERGROUND'

  useFrame((state) => {
    if (!ref.current) return
    if (isCritical) {
      const t = state.clock.elapsedTime
      const phase = (Math.sin(t * 1.4) * 0.5 + 0.5) * 0.18 + 1
      ref.current.scale.y = phase
    } else {
      ref.current.scale.y = 1
    }
  })

  // Mine-type + zone-type specific structure selection
  const renderZoneSpecificGeometry = () => {
    const handler = (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      onClick()
    }
    // EXTRACTION zone — geometry depends on mine type
    if (zone.zone_type === 'EXTRACTION') {
      if (isUnderground) {
        return <UndergroundShaft position={position} size={size} riskColor={color} selected={selected} onClick={handler} />
      }
      return <OpenCastBenches position={position} size={size} height={height} riskColor={color} selected={selected} onClick={handler} />
    }
    // EQUIPMENT / WORKER_OPERATIONS — buildings
    if (zone.zone_type === 'EQUIPMENT' || zone.zone_type === 'WORKER_OPERATIONS') {
      return <BuildingStructure position={position} size={size} height={height} riskColor={color} selected={selected} onClick={handler} />
    }
    // ENVIRONMENTAL — water body + trees
    if (zone.zone_type === 'ENVIRONMENTAL') {
      return (
        <group position={position} onClick={handler}>
          <WaterBody position={[0, 0, 0]} size={[size[0] * 0.8, size[1] * 0.8]} depth={0.4} />
          <Tree position={[size[0] * 0.3, 0, size[1] * 0.3]} height={0.9} />
          <Tree position={[-size[0] * 0.25, 0, size[1] * 0.2]} height={1.1} />
          <Tree position={[size[0] * 0.15, 0, -size[1] * 0.3]} height={0.8} />
        </group>
      )
    }
    // STORAGE — stockpiles
    if (zone.zone_type === 'STORAGE') {
      return (
        <group position={position} onClick={handler}>
          <StockpileCone position={[-1.5, 0, 0]} height={1.4} radius={1.0} material="COAL" />
          <StockpileCone position={[0, 0, 0]} height={1.6} radius={1.2} material="COAL" />
          <StockpileCone position={[1.5, 0, 0]} height={1.2} radius={0.9} material="OVERBURDEN" />
        </group>
      )
    }
    // Default — extruded risk box
    return (
      <mesh
        ref={ref}
        position={[position[0], height / 2, position[2]]}
        castShadow
        receiveShadow
        onClick={handler}
        onPointerOver={(e) => { e.stopPropagation(); onHover(zone.id) }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[size[0], height, size[1]]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.6 : 0.18}
          metalness={0.25}
          roughness={0.55}
          transparent
          opacity={selected ? 0.95 : 0.78}
        />
      </mesh>
    )
  }

  return (
    <group>
      {renderZoneSpecificGeometry()}
      {/* Outline frame — only on default extruded boxes, not on bespoke geometry */}
      {(zone.zone_type !== 'EXTRACTION' && zone.zone_type !== 'EQUIPMENT' && zone.zone_type !== 'WORKER_OPERATIONS' && zone.zone_type !== 'ENVIRONMENTAL' && zone.zone_type !== 'STORAGE') && (
        <lineSegments position={[position[0], height / 2, position[2]]}>
          <edgesGeometry args={[new THREE.BoxGeometry(size[0], height, size[1])]} />
          <lineBasicMaterial color={selected ? '#ffffff' : color} />
        </lineSegments>
      )}
      {/* Floating label */}
      <Html position={[position[0], height + 0.6, position[2]]} center distanceFactor={9} occlude>
        <div className="pointer-events-none flex flex-col items-center gap-0.5">
          <div className="rounded bg-panel/95 px-1.5 py-0.5 text-[10px] font-semibold text-ink shadow">{zone.short_name}</div>
          <div className="font-mono text-[11px] font-bold" style={{ color }}>{fmt(zone.risk_score, 0)}</div>
        </div>
      </Html>
      {/* Violation markers */}
      {showViolations && zone.violation_markers?.map((m) => (
        <ViolationMarker key={m.id} marker={{ ...m, position: [m.position[0] + position[0], m.position[1] + height, m.position[2] + position[2]] }} />
      ))}
      {/* Risk beacon */}
      {showBeacon && zone.beacon && (
        <RiskBeacon beacon={{ ...zone.beacon, position: [zone.beacon.position[0] + position[0], zone.beacon.position[1] + position[2]] }} />
      )}
    </group>
  )
}

// ----------------------------------------------------------------- GROUND
function GroundPlane() {
  return (
    <>
      <Grid
        args={[160, 160]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="var(--line)"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="var(--accent)"
        fadeDistance={90}
        fadeStrength={1.5}
        infiniteGrid
      />
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={160} blur={1.5} far={20} />
    </>
  )
}

// ----------------------------------------------------------------- CAMERA PRESETS
type CameraPreset = 'overview' | 'top' | 'oblique' | 'underground'

function CameraPresetController({ preset }: { preset: CameraPreset }) {
  const { camera, controls } = useThree() as any
  useEffect(() => {
    // Animate to the new position over ~800ms by lerping on each frame
    const targets: Record<CameraPreset, [number, number, number]> = {
      overview: [22, 22, 22],
      top: [0, 50, 0.1],
      oblique: [12, 8, 28],
      underground: [4, -8, 12],
    }
    const [tx, ty, tz] = targets[preset]
    // Smooth lerp — 60 frames at ~0.1 = ~1 second
    let frame = 0
    const maxFrames = 60
    const startPos = camera.position.clone()
    const target = new THREE.Vector3(tx, ty, tz)
    const interval = setInterval(() => {
      frame++
      const t = Math.min(1, frame / maxFrames)
      const eased = 1 - Math.pow(1 - t, 3)  // ease-out cubic
      camera.position.lerpVectors(startPos, target, eased)
      camera.lookAt(0, 1, 0)
      if (controls && controls.target) {
        controls.target.set(0, 1, 0)
        controls.update()
      }
      if (frame >= maxFrames) clearInterval(interval)
    }, 16)
    return () => clearInterval(interval)
  }, [preset, camera, controls])
  return null
}

// ----------------------------------------------------------------- MAIN SCENE
interface MineScene3DProps {
  scene: any
  selected: string | null
  onSelect: (id: string) => void
  onHover?: (id: string | null) => void
  compact?: boolean
  layers: {
    violations: boolean
    beacon: boolean
    workers: boolean
    conveyors: boolean
    trucks: boolean
    ventilation: boolean
    gasSensors: boolean
  }
  historyDay: number  // 0 = today, 89 = 90 days ago
  cameraPreset: CameraPreset
}

function MineScene({ scene, selected, onSelect, onHover, layers, historyDay, cameraPreset }: MineScene3DProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  const handleHover = (id: string | null) => {
    setHovered(id)
    onHover?.(id)
  }

  // Compute zone world positions and time-interpolated heights
  const SCALE = 0.4
  const zoneBoxes = useMemo(() => {
    return (scene.zones || []).map((z: SceneZone) => {
      const g = z.geometry || { x: 10, y: 10, w: 30, h: 30 }
      const cx = (g.x + g.w / 2 - 50) * SCALE
      const cz = (g.y + g.h / 2 - 50) * SCALE
      // Time-scrubbed height — interpolate through the 90-day history
      let liveScore = z.risk_score
      if (z.history_90d && z.history_90d.length === 90) {
        // history_90d is oldest-first, so day 0 = today is index 89
        const idx = 89 - historyDay
        liveScore = z.history_90d[idx] ?? liveScore
      }
      const height = RISK_TO_HEIGHT(liveScore)
      return { zone: { ...z, risk_score: liveScore }, position: [cx, 0, cz] as [number, number, number], size: [g.w * SCALE, g.h * SCALE] as [number, number], height }
    })
  }, [scene.zones, historyDay])

  return (
    <group>
      <GroundPlane />
      <CameraPresetController preset={cameraPreset} />
      {/* Zones */}
      {zoneBoxes.map((b: any) => (
        <ZoneBox
          key={b.zone.id}
          zone={b.zone}
          position={b.position}
          size={b.size}
          height={b.height}
          selected={selected === b.zone.id || hovered === b.zone.id}
          hovered={hovered === b.zone.id}
          onClick={() => onSelect(b.zone.id)}
          onHover={handleHover}
          showViolations={layers.violations}
          showBeacon={layers.beacon}
        />
      ))}
      {/* Conveyor belts */}
      {layers.conveyors && (scene.conveyors || []).map((c: any) => (
        <ConveyorBelt key={c.id} conveyor={c} />
      ))}
      {/* Haul trucks (open-cast only) */}
      {layers.trucks && (scene.trucks || []).map((t: any) => (
        <HaulTruck key={t.id} truck={t} />
      ))}
      {/* Ventilation ducts (underground only) */}
      {layers.ventilation && (scene.ventilation || []).map((v: any) => (
        <VentilationDuct key={v.id} duct={v} />
      ))}
      {/* Gas sensors (underground only) */}
      {layers.gasSensors && (scene.gas_sensors || []).map((g: any) => (
        <GasSensor key={g.id} sensor={g} />
      ))}
      {/* Worker clusters */}
      {layers.workers && (scene.worker_clusters || []).map((w: any) => (
        <WorkerCluster key={w.id} cluster={w} />
      ))}
      {/* Environmental features */}
      {(scene.environmental?.stockpiles || []).map((s: any) => (
        <StockpileCone key={s.id} position={s.position} height={s.height} radius={s.radius} material={s.material} />
      ))}
      {(scene.environmental?.water || []).map((w: any) => (
        <WaterBody key={w.id} position={w.position} size={w.size} depth={w.depth} />
      ))}
      {(scene.environmental?.greenery || []).map((t: any) => (
        <Tree key={t.id} position={t.position} height={t.height} />
      ))}
    </group>
  )
}

// ----------------------------------------------------------------- PUBLIC COMPONENT
export function MineScene3D({
  mineId,
  selected,
  onSelect,
  onHover,
  compact,
}: {
  mineId: string
  selected?: string | null
  onSelect: (id: string) => void
  onHover?: (id: string | null) => void
  compact?: boolean
}) {
  const { data: scene, loading, error } = useAsync<any>(`/api/3d/mine/${mineId}`, [mineId])
  const [hovered, setHovered] = useState<string | null>(null)
  const [layers, setLayers] = useState({
    violations: true,
    beacon: true,
    workers: true,
    conveyors: true,
    trucks: true,
    ventilation: true,
    gasSensors: true,
  })
  const [historyDay, setHistoryDay] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('oblique')

  // Auto-play the time scrubber
  useEffect(() => {
    if (!autoPlay) return
    const id = setInterval(() => {
      setHistoryDay((d) => (d + 1) % 90)
    }, 200)
    return () => clearInterval(id)
  }, [autoPlay])

  const active = scene?.zones?.find((z: any) => z.id === (hovered ?? selected))

  if (error) {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-md border border-line bg-sunken text-[12px] text-ink-dim">
        3D scene failed to load: {String(error)}
      </div>
    )
  }

  if (!scene) {
    return (
      <div className={cx('flex items-center justify-center rounded-md border border-line bg-sunken', compact ? 'h-[280px]' : 'h-[460px]')}>
        <div className="text-[12px] text-ink-faint">Building 3D scene…</div>
      </div>
    )
  }

  const todayScore = scene.zones?.find((z: any) => z.id === selected)?.risk_score
  const dayScore = (() => {
    const z = scene.zones?.find((z: any) => z.id === selected)
    if (!z?.history_90d) return todayScore
    return z.history_90d[89 - historyDay]
  })()

  return (
    <div className="relative">
      {/* Layer toggle toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel p-1.5">
        <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Layers</span>
        {([
          ['violations', 'Violations', 'alert'],
          ['beacon', 'Risk beacon', 'spark'],
          ['workers', 'Workers', 'user'],
          ['conveyors', 'Conveyors', 'wrench'],
          ['trucks', 'Trucks', 'wrench'],
          ['ventilation', 'Ventilation', 'spark'],
          ['gasSensors', 'Gas sensors', 'spark'],
        ] as const).map(([key, label, _icon]) => (
          <button
            key={key}
            onClick={() => setLayers((l) => ({ ...l, [key]: !l[key as keyof typeof l] }))}
            className={cx(
              'rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors',
              layers[key as keyof typeof layers]
                ? 'bg-raised text-ink'
                : 'bg-sunken text-ink-faint hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-ink-faint">Camera</span>
          <SegmentedControl
            value={cameraPreset}
            onChange={(v) => setCameraPreset(v as CameraPreset)}
            options={[
              { value: 'oblique', label: 'Oblique' },
              { value: 'overview', label: 'Overview' },
              { value: 'top', label: 'Top' },
              { value: 'underground', label: 'UG cut' },
            ]}
          />
        </div>
      </div>

      {/* Time scrubber */}
      <div className="mb-2 flex items-center gap-2 rounded-md border border-line bg-panel p-1.5">
        <Button size="sm" variant="ghost" onClick={() => setAutoPlay((v) => !v)} className="!px-1.5">
          <Icon name={autoPlay ? 'pause' : 'play'} className="h-3 w-3" />
        </Button>
        <span className="text-[10px] text-ink-faint">Risk history</span>
        <input
          type="range"
          min={0}
          max={89}
          value={historyDay}
          onChange={(e) => { setHistoryDay(parseInt(e.target.value)); setAutoPlay(false) }}
          className="flex-1"
        />
        <span className="font-mono text-[10.5px] text-ink-dim">
          {historyDay === 0 ? 'today' : `${historyDay}d ago`}
          {selected && dayScore != null && (
            <span className="ml-2 text-ink-faint">
              · {scene.zones.find((z: any) => z.id === selected)?.short_name}: {fmt(dayScore, 0)}
            </span>
          )}
        </span>
      </div>

      <div className={cx('overflow-hidden rounded-md border border-line', compact ? 'h-[280px]' : 'h-[480px]')} style={{ background: 'var(--bg-sunken)' }}>
        <Canvas
          shadows
          camera={{ position: [12, 8, 28], fov: 38 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#0a0e14'))
          }}
        >
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[15, 25, 10]}
            intensity={1.1}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-near={0.1}
            shadow-camera-far={60}
            shadow-camera-left={-25}
            shadow-camera-right={25}
            shadow-camera-top={25}
            shadow-camera-bottom={-25}
          />
          <MineScene
            scene={scene}
            selected={selected ?? null}
            onSelect={onSelect}
            onHover={(id) => { setHovered(id); onHover?.(id) }}
            layers={layers}
            historyDay={historyDay}
            cameraPreset={cameraPreset}
          />
          <OrbitControls
            enablePan
            enableZoom={!compact}
            minDistance={8}
            maxDistance={70}
            maxPolarAngle={cameraPreset === 'underground' ? Math.PI : Math.PI / 2.05}
            target={[0, 1, 0]}
          />
          <Environment preset="city" />
        </Canvas>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {(['low', 'moderate', 'elevated', 'high', 'critical'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1 text-[10px] uppercase tracking-wide2 text-ink-faint">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: `var(--risk-${t})` }} />
            {t}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-ink-faint">drag to orbit · scroll to zoom · click a zone to open the dossier</span>
      </div>

      {/* Hover info card */}
      {active && (
        <div className="pointer-events-none absolute right-2 top-2 w-[220px] rounded-md border border-line bg-panel/95 p-2 text-left shadow-pop backdrop-blur">
          <p className="text-[12px] font-semibold leading-tight">{active.name}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge tone={bandFor(active.risk_score).tone} dot>
              {fmt(active.risk_score, 0)} risk
            </Badge>
            <span className="text-[10px] text-ink-faint">{active.zone_type.replace(/_/g, ' ')}</span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-[10.5px] text-ink-dim">
            <Row label="Compliance" value={`${fmt(active.compliance_score, 0)}/100`} />
            <Row label="Open findings" value={String(active.open_violations ?? '—')} />
            <Row label="Cadence" value={`${active.zone_type === 'EXTRACTION' ? (active.mine_type === 'UNDERGROUND' ? 'UG' : 'OC') + ' extraction' : active.zone_type.toLowerCase()}`} />
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
