import React, { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html, Environment, Grid, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import type { Zone } from '../lib/types'
import { bandFor, fmt } from '../lib/format'
import { Badge, Icon, cx } from './ui'

/**
 * MineMap3D — interactive 3D mine site view.
 *
 * PS SIH26024 explicitly mentions "GIS mapping". The 2D Leaflet map already
 * covers the lat/long requirement; this 3D view answers a different
 * question: "what does risk look like when you stand in the mine?".
 *
 * Design choices:
 *  * Zones are extruded boxes positioned from their stored `geometry`
 *    (so 2D and 3D views agree), with extrusion height proportional to
 *    risk score (0-100 → 0.5-4 units).
 *  * Colour follows the band scale used everywhere else, so this view
 *    cannot drift away from the rest of the product's risk encoding.
 *  * Critical zones carry a slow vertical pulse — the only piece of
 *    motion in the scene, so attention is drawn without becoming noise.
 *  * Camera defaults to a 30° oblique view, which is the most readable
 *    for a multi-zone site; OrbitControls lets the user inspect from
 *    any angle, including top-down for a plan-view.
 *  * Click a zone to open the dossier — the same `onSelect` prop the 2D
 *    map exposes, so the 3D map is a drop-in replacement.
 */
const RISK_TO_HEIGHT = (score: number) => 0.4 + (score / 100) * 3.6

interface ZoneBoxProps {
  zone: Zone
  position: [number, number, number]
  size: [number, number]
  height: number
  selected: boolean
  onClick: () => void
  onHover: (id: string | null) => void
}

function ZoneBox({ zone, position, size, height, selected, onClick, onHover }: ZoneBoxProps) {
  const ref = useRef<THREE.Mesh>(null!)
  const tone = zone.risk_tone ?? bandFor(zone.risk_score).tone
  const color = toneToHex(tone)
  const isCritical = tone === 'critical' || tone === 'high'
  // Pulse the y-scale for critical zones
  useFrame((state) => {
    if (!ref.current) return
    if (isCritical) {
      const t = state.clock.getElapsedTime()
      const phase = (Math.sin(t * 1.4) * 0.5 + 0.5) * 0.18 + 1
      ref.current.scale.y = phase
    } else {
      ref.current.scale.y = 1
    }
  })
  return (
    <group position={position}>
      {/* The extruded risk box */}
      <mesh
        ref={ref}
        position={[0, height / 2, 0]}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onClick()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover(zone.id)
        }}
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
      {/* Outline frame */}
      <lineSegments position={[0, height / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(size[0], height, size[1])]} />
        <lineBasicMaterial color={selected ? '#ffffff' : color} linewidth={selected ? 2 : 1} />
      </lineSegments>
      {/* Label floating above the zone */}
      <Html position={[0, height + 0.6, 0]} center distanceFactor={9} occlude>
        <div className="pointer-events-none flex flex-col items-center gap-0.5">
          <div className="rounded bg-panel/95 px-1.5 py-0.5 text-[10px] font-semibold text-ink shadow">{zone.short_name}</div>
          <div className="font-mono text-[11px] font-bold" style={{ color }}>{fmt(zone.risk_score, 0)}</div>
        </div>
      </Html>
    </group>
  )
}

function GroundPlane() {
  return (
    <>
      <Grid
        args={[120, 120]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="var(--line)"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="var(--accent)"
        fadeDistance={80}
        fadeStrength={1.5}
        infiniteGrid
      />
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={120} blur={1.5} far={20} />
    </>
  )
}

interface MineSiteProps {
  zones: Zone[]
  selected: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  hovered: string | null
}

function MineSite({ zones, selected, onSelect, onHover, hovered }: MineSiteProps) {
  // Convert the schematic geometry {x,y,w,h in 0-100 space} into world coordinates.
  // We translate so the site is centred at origin: x' = x - 50, z' = y - 50.
  // Scale 0-100 to ~0-40 world units so the scene is reasonable to orbit.
  const SCALE = 0.4
  const zoneBoxes = useMemo(() => {
    return zones.map((z) => {
      const g = z.geometry ?? { x: 10, y: 10, w: 30, h: 30 }
      const cx = (g.x + g.w / 2 - 50) * SCALE
      const cz = (g.y + g.h / 2 - 50) * SCALE
      const w = g.w * SCALE
      const d = g.h * SCALE
      const h = RISK_TO_HEIGHT(z.risk_score)
      return { zone: z, position: [cx, 0, cz] as [number, number, number], size: [w, d] as [number, number], height: h }
    })
  }, [zones])

  return (
    <group>
      <GroundPlane />
      {zoneBoxes.map((b) => (
        <ZoneBox
          key={b.zone.id}
          zone={b.zone}
          position={b.position}
          size={b.size}
          height={b.height}
          selected={selected === b.zone.id || hovered === b.zone.id}
          onClick={() => onSelect(b.zone.id)}
          onHover={onHover}
        />
      ))}
    </group>
  )
}

export function MineMap3D({
  zones,
  onSelect,
  selected,
  onHover,
  compact,
}: {
  zones: Zone[]
  onSelect: (id: string) => void
  selected?: string | null
  onHover?: (id: string | null) => void
  compact?: boolean
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const active = zones.find((z) => z.id === (hovered ?? selected))

  const handleHover = (id: string | null) => {
    setHovered(id)
    onHover?.(id)
  }

  return (
    <div className="relative">
      <div className={cx('overflow-hidden rounded-md border border-line', compact ? 'h-[280px]' : 'h-[460px]')} style={{ background: 'var(--bg-sunken)' }}>
        <Canvas
          shadows
          camera={{ position: [22, 22, 22], fov: 38 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#0a0e14'))
          }}
        >
          <ambientLight intensity={0.6} />
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
          <MineSite zones={zones} selected={selected ?? null} onSelect={onSelect} onHover={handleHover} hovered={hovered} />
          <OrbitControls
            enablePan
            enableZoom={!compact}
            minDistance={8}
            maxDistance={50}
            maxPolarAngle={Math.PI / 2.05}
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
        <span className="ml-auto text-[10px] text-ink-faint">3D · drag to orbit · scroll to zoom · click a zone to open the dossier</span>
      </div>

      {active && (
        <div className="pointer-events-none absolute right-2 top-2 w-[210px] rounded-md border border-line bg-panel/95 p-2 text-left shadow-pop backdrop-blur">
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
            <Row label="Cadence" value={`${active.inspection_cadence_days}d`} />
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[color:var(--accent)]">
            click to open dossier <Icon name="arrowRight" className="h-2.5 w-2.5" />
          </p>
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

/**
 * Convert a CSS risk tone name to the matching hex colour, used as a
 * fallback when the WebGL material can't read CSS variables directly.
 * The values mirror those in frontend/src/index.css so the 3D map
 * cannot drift away from the rest of the design system.
 */
function toneToHex(tone: string): string {
  const map: Record<string, string> = {
    low: '#4ade80',
    moderate: '#facc15',
    elevated: '#fb923c',
    high: '#f87171',
    critical: '#dc2626',
  }
  return map[tone] ?? '#94a3b8'
}
