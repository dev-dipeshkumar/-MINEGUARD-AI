import React, { useEffect, useMemo, useRef } from 'react'
import { CircleMarker, Marker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Zone } from '../lib/types'
import { bandFor, fmt } from '../lib/format'
import { Badge, Icon, cx } from './ui'

const inspectionIcon = L.divIcon({
  html: `<div style="background-color: var(--accent); border: 2px solid white; border-radius: 50%; width: 100%; height: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.4);"></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

/**
 * Module 2 — mine operations map (real GIS).
 *
 * Replaces the original SVG schematic with a Leaflet slippy map. The PS
 * SIH26024 expected-solution list explicitly asks for "GIS mapping" and
 * "geo-tagged and time-stamped field reporting". Every zone carries
 * real-world lat/long derived from the mine centre plus a small offset
 * (see api/seed.py). Risk is rendered as a colour-graded circle marker
 * with a popup that mirrors the schematic's dossier-link behaviour, so
 * downstream pages don't change.
 *
 * The map uses OpenStreetMap tiles by default. Set VITE_MAP_TILES_URL to
 * point at an internal WMS / Mapbox style for production deployments.
 */
const TILES_URL = String(import.meta.env.VITE_MAP_TILES_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
const TILES_ATTR = '&copy; OpenStreetMap contributors · DGMS / Coal India overlay illustrative'

interface MineCenter {
  id: string
  name: string
  latitude: number
  longitude: number
}

function FitBounds({ zones, mines, inspections = [] }: { zones: Zone[]; mines: MineCenter[]; inspections?: any[] }) {
  const map = useMap()
  useEffect(() => {
    const pts: L.LatLngExpression[] = []
    for (const z of zones) {
      if (z.latitude != null && z.longitude != null) {
        pts.push([z.latitude, z.longitude])
      }
    }
    for (const m of mines) {
      if (m.latitude != null && m.longitude != null) {
        pts.push([m.latitude, m.longitude])
      }
    }
    for (const i of inspections) {
      if (i.latitude != null && i.longitude != null) {
        pts.push([i.latitude, i.longitude])
      }
    }
    if (pts.length === 0) return
    if (pts.length === 1) {
      map.setView(pts[0] as L.LatLngExpression, 12)
    } else {
      const bounds = L.latLngBounds(pts as L.LatLngTuple[])
      map.fitBounds(bounds.pad(0.2))
    }
  }, [zones, mines, map])
  return null
}

export function MineMap({
  zones,
  onSelect,
  selected,
  onHover,
  compact,
  mines = [],
  inspections = [],
}: {
  zones: Zone[]
  onSelect: (id: string) => void
  selected?: string | null
  onHover?: (id: string | null) => void
  compact?: boolean
  mines?: MineCenter[]
  inspections?: any[]
}) {
  const active = zones.find((z) => z.id === selected)

  // Per-mine centre (for showing the parent marker). Pulls from
  // either the parent mines list or the first zone's mine_name.
  const mineCentres = useMemo<MineCenter[]>(() => {
    if (mines.length) return mines
    // Fall back: derive a centre per mine by averaging its zones.
    const byMine: Record<string, { id: string; name: string; lat: number[]; lon: number[] }> = {}
    for (const z of zones) {
      if (z.latitude == null || z.longitude == null) continue
      const key = z.mine_id
      if (!byMine[key]) byMine[key] = { id: z.mine_id, name: z.mine_name, lat: [], lon: [] }
      byMine[key].lat.push(z.latitude)
      byMine[key].lon.push(z.longitude)
    }
    return Object.values(byMine).map((m) => ({
      id: m.id,
      name: m.name,
      latitude: m.lat.reduce((a, b) => a + b, 0) / m.lat.length,
      longitude: m.lon.reduce((a, b) => a + b, 0) / m.lon.length,
    }))
  }, [zones, mines])

  return (
    <div className="relative">
      <div className={cx('overflow-hidden rounded-md border border-line', compact ? 'h-[280px]' : 'h-[460px]')}>
        <MapContainer
          center={[23.7, 86.4]}
          zoom={6}
          scrollWheelZoom={!compact}
          className="h-full w-full"
          attributionControl
        >
          <TileLayer url={TILES_URL} attribution={TILES_ATTR} />
          <FitBounds zones={zones} mines={mineCentres} inspections={inspections} />
          {/* Mine centre markers — drawn first so they sit under zone pins */}
          {mineCentres.map((m) => (
            <CircleMarker
              key={`mine-${m.id}`}
              center={[m.latitude, m.longitude]}
              radius={10}
              pathOptions={{ color: 'var(--text)', fillColor: 'var(--bg-sunken)', fillOpacity: 0.4, weight: 1.5 }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                <div className="text-[11px] font-semibold">{m.name}</div>
                <div className="text-[10px] text-ink-faint">mine centre</div>
              </Tooltip>
            </CircleMarker>
          ))}
          {/* Zone markers — colour by risk band */}
          {zones.map((z) => {
            if (z.latitude == null || z.longitude == null) return null
            const tone = z.risk_tone ?? bandFor(z.risk_score).tone
            const color = `var(--risk-${tone})`
            const isActive = selected === z.id
            const radius = 6 + Math.min(12, (z.open_violations ?? 0))
            return (
              <CircleMarker
                key={z.id}
                center={[z.latitude, z.longitude]}
                radius={radius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: isActive ? 0.55 : 0.32,
                  weight: isActive ? 2.5 : 1.4,
                }}
                eventHandlers={{
                  click: () => onSelect(z.id),
                  mouseover: () => onHover?.(z.id),
                  mouseout: () => onHover?.(null),
                }}
              >
                <Popup>
                  <div className="text-[12px]">
                    <div className="font-semibold">{z.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge tone={bandFor(z.risk_score).tone} dot>
                        {fmt(z.risk_score, 0)} risk
                      </Badge>
                      <span className="text-[10px] text-ink-faint">{z.zone_type.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-ink-dim">
                      Compliance: {fmt(z.compliance_score, 0)}/100 · Open findings: {z.open_violations ?? '—'}
                    </div>
                    <div className="mt-1 text-[10px] text-ink-faint">
                      {z.latitude?.toFixed(4)}, {z.longitude?.toFixed(4)} · Cadence {z.inspection_cadence_days}d
                    </div>
                    <button
                      className="mt-1.5 flex items-center gap-1 text-[10.5px] text-[color:var(--accent)]"
                      onClick={() => onSelect(z.id)}
                    >
                      open dossier <Icon name="arrowRight" className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </Popup>
                <Tooltip direction="top" offset={[0, -8]}>
                  <div className="text-[11px] font-semibold">{z.short_name}</div>
                  <div className="text-[10px]">{fmt(z.risk_score, 0)} · {bandFor(z.risk_score).label}</div>
                </Tooltip>
              </CircleMarker>
            )
          })}
          {/* Inspection markers */}
          {inspections.map((i) => {
            if (i.latitude == null || i.longitude == null) return null
            return (
              <Marker key={i.id} position={[i.latitude, i.longitude]} icon={inspectionIcon}>
                <Popup>
                  <div className="text-[12px]">
                    <div className="font-semibold text-[color:var(--accent)]">Field Inspection</div>
                    <div className="mt-1 text-ink-dim">Inspector: {i.inspector}</div>
                    <div className="mt-0.5 text-[10px] text-ink-faint">{i.inspection_date}</div>
                    <div className="mt-1 leading-snug">{i.observations}</div>
                    {i.image_url && <img src={i.image_url} alt="inspection" className="mt-2 rounded max-w-[120px] max-h-[120px]" />}
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {(['low', 'moderate', 'elevated', 'high', 'critical'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1 text-[10px] uppercase tracking-wide2 text-ink-faint">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: `var(--risk-${t})` }} />
            {t}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-ink-faint">GIS · Leaflet + OpenStreetMap · zone pins geo-tagged from mine centre</span>
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
            <Row label="Trend 30d" value={`${(active.trend ?? 0) > 0 ? '+' : ''}${(active.trend ?? 0).toFixed(0)}`} tone={(active.trend ?? 0) > 0 ? 'var(--risk-high)' : 'var(--risk-low)'} />
            <Row label="Cadence" value={`${active.inspection_cadence_days}d`} />
            <Row label="Lat/Lon" value={`${active.latitude?.toFixed(3)}, ${active.longitude?.toFixed(3)}`} />
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[color:var(--accent)]">
            click to open dossier <Icon name="arrowRight" className="h-2.5 w-2.5" />
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono" style={{ color: tone }}>
        {value}
      </span>
    </div>
  )
}
