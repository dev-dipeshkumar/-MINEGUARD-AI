import React, { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html, Environment, Grid, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { Badge, Button, Icon, cx } from '../ui'
import { bandFor, fmt } from '../../lib/format'
import { useAsync } from '../../state/app'
import { endpoints } from '../../lib/api'
import { OpenCastBenches, UndergroundShaft, BuildingStructure, WaterBody, StockpileCone, Tree } from './Geometry'
import { HaulTruck, ConveyorBelt, VentilationDuct, GasSensor, RiskBeacon } from './Entities'

/**
 * PortfolioScene3D — multi-mine portfolio: all 4 mines as islands in
 * a single 3D scene. The user can orbit the whole portfolio, click an
 * island to drill into the per-mine detail.
 *
 * This is the "wow" view for SIH judging: one scene, four mines, all
 * the risk profiles visible at once. Critical zones across the
 * portfolio have beacons that pulse together.
 */
const SCALE = 0.4

function toneToHex(tone: string): string {
  const map: Record<string, string> = {
    low: '#4ade80', moderate: '#facc15', elevated: '#fb923c',
    high: '#f87171', critical: '#dc2626',
  }
  return map[tone] ?? '#94a3b8'
}

const RISK_TO_HEIGHT = (score: number) => 0.4 + (score / 100) * 3.0

interface IslandZone {
  id: string
  name: string
  short_name: string
  zone_type: string
  position: [number, number, number]
  size: [number, number]
  risk_score: number
  risk_level: string
  risk_tone: string
  beacon?: any
}

interface Island {
  id: string
  code: string
  name: string
  mine_type: string
  position: [number, number, number]
  risk_score: number
  risk_level: string
  compliance_score: number
  workforce: number
  annual_output_kt: number
  zones: IslandZone[]
  trucks: any[]
  conveyors: any[]
  ventilation: any[]
  gas_sensors: any[]
}

function IslandZoneBox({ zone, islandPos, selected, onSelect }: { zone: IslandZone; islandPos: [number, number, number]; selected: boolean; onSelect: () => void }) {
  const color = toneToHex(zone.risk_tone)
  const height = RISK_TO_HEIGHT(zone.risk_score)
  const worldPos: [number, number, number] = [islandPos[0] + zone.position[0], 0, islandPos[2] + zone.position[2]]
  const isUnderground = (zone as any).mine_type === 'UNDERGROUND'

  const handler = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect()
  }

  return (
    <group>
      {/* Mine-type-specific geometry */}
      {zone.zone_type === 'EXTRACTION' && (
        isUnderground ? (
          <UndergroundShaft position={worldPos} size={zone.size} riskColor={color} selected={selected} onClick={handler} />
        ) : (
          <OpenCastBenches position={worldPos} size={zone.size} height={height} riskColor={color} selected={selected} onClick={handler} />
        )
      )}
      {zone.zone_type === 'EQUIPMENT' && (
        <BuildingStructure position={worldPos} size={zone.size} height={height} riskColor={color} selected={selected} onClick={handler} />
      )}
      {zone.zone_type === 'WORKER_OPERATIONS' && (
        <BuildingStructure position={worldPos} size={zone.size} height={height} riskColor={color} selected={selected} onClick={handler} />
      )}
      {zone.zone_type === 'ENVIRONMENTAL' && (
        <group position={worldPos} onClick={handler}>
          <WaterBody position={[0, 0, 0]} size={[zone.size[0] * 0.7, zone.size[1] * 0.7]} depth={0.3} />
          <Tree position={[zone.size[0] * 0.25, 0, zone.size[1] * 0.25]} height={0.7} />
        </group>
      )}
      {zone.zone_type === 'STORAGE' && (
        <group position={worldPos} onClick={handler}>
          <StockpileCone position={[-1.2, 0, 0]} height={1.0} radius={0.8} material="COAL" />
          <StockpileCone position={[0, 0, 0]} height={1.2} radius={0.9} material="COAL" />
          <StockpileCone position={[1.2, 0, 0]} height={0.9} radius={0.7} material="OVERBURDEN" />
        </group>
      )}
      {/* Label — only on selected to keep the scene readable */}
      {selected && (
        <Html position={[worldPos[0], height + 0.6, worldPos[2]]} center distanceFactor={9} occlude>
          <div className="pointer-events-none flex flex-col items-center gap-0.5">
            <div className="rounded bg-panel/95 px-1.5 py-0.5 text-[10px] font-semibold text-ink shadow">{zone.short_name}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color }}>{fmt(zone.risk_score, 0)}</div>
          </div>
        </Html>
      )}
      {/* Risk beacon */}
      {zone.beacon && (
        <RiskBeacon beacon={{ ...zone.beacon, position: [worldPos[0], worldPos[2]] }} heightFactor={0.7} />
      )}
    </group>
  )
}

function IslandLabel({ island, onClick }: { island: Island; onClick: () => void }) {
  return (
    <Html position={[island.position[0], 5.5, island.position[2]]} center distanceFactor={11} occlude>
      <button onClick={onClick} className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg border border-line bg-panel/95 px-2 py-1 shadow-pop hover:border-line-strong">
        <span className="text-[11px] font-semibold text-ink">{island.name}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-ink-dim">
          <Badge tone={bandFor(island.risk_score).tone} dot>
            {fmt(island.risk_score, 0)}
          </Badge>
          <span>{island.mine_type === 'UNDERGROUND' ? 'UG' : 'OC'}</span>
        </span>
      </button>
    </Html>
  )
}

function PortfolioScene({ data, selectedMine, onSelectMine, selectedZone, onSelectZone }: { data: any; selectedMine: string | null; onSelectMine: (id: string) => void; selectedZone: string | null; onSelectZone: (id: string) => void }) {
  const islands: Island[] = data.islands || []
  return (
    <group>
      <Grid
        args={[200, 200]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="var(--line)"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="var(--accent)"
        fadeDistance={120}
        fadeStrength={1.5}
        infiniteGrid
      />
      <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={200} blur={1.8} far={20} />
      {islands.map((island) => (
        <group key={island.id}>
          {/* Island base — a faint pad under each mine so it reads as one island */}
          <mesh position={[island.position[0], -0.02, island.position[2]]} receiveShadow>
            <cylinderGeometry args={[14, 14.5, 0.04, 48]} />
            <meshStandardMaterial color="var(--bg-app)" opacity={0.6} transparent />
          </mesh>
          {island.zones.map((z) => (
            <IslandZoneBox
              key={z.id}
              zone={z}
              islandPos={island.position}
              selected={selectedZone === z.id || (selectedMine === island.id && !selectedZone)}
              onSelect={() => {
                onSelectMine(island.id)
                onSelectZone(z.id)
              }}
            />
          ))}
          {/* Animated entities — trucks, conveyors, ventilation, gas sensors */}
          {island.trucks.map((t) => (
            <HaulTruck key={t.id} truck={{ ...t, waypoints: t.waypoints.map((wp: [number, number]) => [wp[0] + island.position[0], wp[1] + island.position[2]]) }} />
          ))}
          {island.conveyors.map((c) => (
            <ConveyorBelt key={c.id} conveyor={{ ...c, from: [c.from[0] + island.position[0], c.from[1] + island.position[2]], to: [c.to[0] + island.position[0], c.to[1] + island.position[2]] }} />
          ))}
          {island.ventilation.map((v) => (
            <VentilationDuct key={v.id} duct={{ ...v, from: [v.from[0] + island.position[0], v.from[1], v.from[2] + island.position[2]], to: [v.to[0] + island.position[0], v.to[1], v.to[2] + island.position[2]] }} />
          ))}
          {island.gas_sensors.map((g) => (
            <GasSensor key={g.id} sensor={{ ...g, position: [g.position[0] + island.position[0], g.position[1], g.position[2] + island.position[2]] }} />
          ))}
          {/* Mine name floating label */}
          <IslandLabel island={island} onClick={() => onSelectMine(island.id)} />
        </group>
      ))}
    </group>
  )
}

export function PortfolioScene3D({ onSelectMine }: { onSelectMine: (mineId: string) => void }) {
  const { data, loading, error } = useAsync<any>(endpoints.scene3dPortfolio, [])
  const [selectedMine, setSelectedMine] = useState<string | null>(null)
  const [selectedZone, setSelectedZone] = useState<string | null>(null)

  if (error) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-line bg-sunken text-[12px] text-ink-dim">
        Portfolio scene failed to load: {String(error)}
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-line bg-sunken text-[12px] text-ink-faint">
        Building portfolio 3D scene…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border border-line h-[640px]" style={{ background: 'var(--bg-sunken)' }}>
        <Canvas
          shadows
          camera={{ position: [0, 35, 35], fov: 38 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#0a0e14'))
          }}
        >
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[25, 35, 15]}
            intensity={1.1}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-near={0.1}
            shadow-camera-far={120}
            shadow-camera-left={-50}
            shadow-camera-right={50}
            shadow-camera-top={50}
            shadow-camera-bottom={-50}
          />
          <PortfolioScene
            data={data}
            selectedMine={selectedMine}
            onSelectMine={(id) => { setSelectedMine(id); setSelectedZone(null) }}
            selectedZone={selectedZone}
            onSelectZone={(id) => setSelectedZone(id)}
          />
          <OrbitControls
            enablePan
            minDistance={15}
            maxDistance={100}
            maxPolarAngle={Math.PI / 2.05}
            target={[0, 1, 0]}
          />
          <Environment preset="city" />
        </Canvas>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-2 text-[11px] text-ink-dim">
        <span className="text-ink-faint">Tip:</span>
        <span>Drag to orbit · scroll to zoom · click an island label or zone to drill in</span>
        <span className="ml-auto flex items-center gap-2">
          {(['low', 'moderate', 'elevated', 'high', 'critical'] as const).map((t) => (
            <span key={t} className="flex items-center gap-1 text-[10px] uppercase tracking-wide2 text-ink-faint">
              <span className="h-1.5 w-3 rounded-sm" style={{ background: `var(--risk-${t})` }} />
              {t}
            </span>
          ))}
          {selectedMine && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onSelectMine(selectedMine)}
              icon={<Icon name="arrowRight" className="h-3 w-3" />}
            >
              Open mine detail
            </Button>
          )}
        </span>
      </div>
    </div>
  )
}
