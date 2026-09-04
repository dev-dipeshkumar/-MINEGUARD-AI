import React, { useState } from 'react'
import type { Zone } from '../lib/types'
import { bandFor, fmt } from '../lib/format'
import { Badge, Icon, cx } from './ui'

/**
 * Module 2 — mine operations map.
 *
 * A schematic of the site drawn from each zone's stored geometry, painted by
 * engine score. Deliberately not a slippy map: no government GIS feed exists
 * for a hackathon, and a stylised plan is more readable for risk than satellite
 * imagery. Zone rectangles, pits, shafts, tips and the haul road are rendered as
 * SVG so it stays crisp at any zoom and works with zero network requests.
 */
export function MineMap({
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

  return (
    <div className="relative">
      <svg viewBox="0 0 100 96" className={cx('w-full select-none', compact ? 'max-h-[280px]' : 'max-h-[460px]')} role="img" aria-label="Mine zone map, coloured by risk band">
        <defs>
          <pattern id="hatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--line-strong)" strokeWidth="1" opacity="0.5" />
          </pattern>
          <radialGradient id="pit" r="0.5">
            <stop offset="0%" stopColor="var(--bg-sunken)" />
            <stop offset="100%" stopColor="var(--bg-panel)" />
          </radialGradient>
        </defs>

        {/* site boundary + terrain furniture */}
        <rect x="2" y="2" width="96" height="92" rx="2.5" fill="url(#pit)" stroke="var(--line-strong)" strokeWidth="0.4" strokeDasharray="1.6 1.2" />
        <path d="M2 74 Q 30 68 52 76 T 98 70" fill="none" stroke="var(--line)" strokeWidth="0.6" opacity="0.8" />
        <text x="4" y="91" className="font-mono" fontSize="2.4" fill="var(--text-faint)">
          HAUL ROAD · PIT LIMITS · SURFACE INFRASTRUCTURE
        </text>
        {/* shaft symbol */}
        <g opacity="0.85">
          <circle cx="9" cy="55" r="2.1" fill="none" stroke="var(--line-strong)" strokeWidth="0.4" />
          <path d="M7 55h4M9 53v4" stroke="var(--line-strong)" strokeWidth="0.35" />
        </g>
        {/* tip / dump triangles */}
        <g opacity="0.7" fill="url(#hatch)" stroke="var(--line-strong)" strokeWidth="0.3">
          <path d="M92 88l3 5h-6z" />
          <path d="M86 89l2.4 4h-4.8z" />
        </g>

        {zones.map((z) => {
          const tone = z.risk_tone ?? bandFor(z.risk_score).tone
          const color = `var(--risk-${tone})`
          const g = z.geometry ?? { x: 10, y: 10, w: 30, h: 30 }
          const isActive = selected === z.id
          const isHover = hovered === z.id
          const critical = tone === 'critical' || tone === 'high'
          return (
            <g
              key={z.id}
              tabIndex={0}
              role="button"
              aria-label={`${z.name}, risk ${z.risk_score.toFixed(0)}, ${bandFor(z.risk_score).label}`}
              onClick={() => onSelect(z.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(z.id))}
              onMouseEnter={() => {
                setHovered(z.id)
                onHover?.(z.id)
              }}
              onMouseLeave={() => {
                setHovered(null)
                onHover?.(null)
              }}
              className="cursor-pointer focus:outline-none"
              style={{ transition: 'opacity 200ms' }}
            >
              <rect
                x={g.x}
                y={g.y}
                width={g.w}
                height={g.h}
                rx="1.6"
                fill={color}
                opacity={isActive || isHover ? 0.3 : 0.14}
                style={{ transition: 'opacity 200ms, fill 400ms' }}
              />
              <rect
                x={g.x}
                y={g.y}
                width={g.w}
                height={g.h}
                rx="1.6"
                fill="none"
                stroke={color}
                strokeWidth={isActive ? 0.85 : 0.5}
                strokeDasharray={critical ? '' : '1.4 1'}
                opacity={isActive || isHover ? 1 : 0.75}
              />
              {critical && (
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="1.6" fill="none" stroke={color} strokeWidth="0.4" opacity="0.5">
                  <animate attributeName="opacity" values="0.55;0.08;0.55" dur="2.6s" repeatCount="indefinite" />
                </rect>
              )}
              <text x={g.x + 2} y={g.y + 4.6} fontSize="3" fill="var(--text)" className="font-sans" style={{ fontWeight: 600 }}>
                {z.short_name}
              </text>
              <text x={g.x + 2} y={g.y + 8.2} fontSize="2.1" fill="var(--text-dim)">
                {z.name.split('— ')[1]?.slice(0, 30) ?? z.zone_type.replace(/_/g, ' ').toLowerCase()}
              </text>
              <g transform={`translate(${g.x + 2}, ${g.y + g.h - 6})`}>
                <text fontSize="5.4" fill={color} className="font-mono" style={{ fontWeight: 700 }}>
                  {z.risk_score.toFixed(0)}
                </text>
                <text x="10.5" y="4.6" fontSize="2" fill="var(--text-faint)" style={{ letterSpacing: '0.08em' }}>
                  {bandFor(z.risk_score).label}
                </text>
              </g>
              {/* mini open-finding ticks */}
              {Array.from({ length: Math.min(8, (z as any).open_violations ?? 0) }).map((_, i) => (
                <rect key={i} x={g.x + g.w - 2 - i * 1.15} y={g.y + g.h - 3} width="0.75" height="2" fill={color} opacity="0.85" />
              ))}
            </g>
          )
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {(['low', 'moderate', 'elevated', 'high', 'critical'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1 text-[10px] uppercase tracking-wide2 text-ink-faint">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: `var(--risk-${t})` }} />
            {t}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-ink-faint">schematic · geometry from stored zone plan</span>
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
            <Row label="Open findings" value={String((active as any).open_violations ?? '—')} />
            <Row label="30-day trend" value={signed((active as any).trend ?? 0, 0)} tone={(active as any).trend > 0 ? 'var(--risk-high)' : 'var(--risk-low)'} />
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

function signed(n: number, digits: number) {
  const v = Math.abs(n).toFixed(digits)
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${v}`
}
