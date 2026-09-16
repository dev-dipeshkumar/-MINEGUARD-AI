import React, { useMemo, useState } from 'react'
import { cx } from './ui'

/**
 * Hand-drawn SVG data views. No chart library: the visual language here is
 * dense and specific (threshold-marked trend lines, factor bars against their
 * caps, ranking ladders) and is smaller and faster than pulling in a package.
 * Every chart is keyboard/hover accessible and falls back to a table-like
 * readout of values.
 */

const pad = (v: number) => (Number.isFinite(v) ? v : 0)

// ---------------------------------------------------------------- sparkline
export function Sparkline({
  values,
  tone = 'var(--accent)',
  height = 28,
  width = 92,
  fill = true,
}: {
  values: number[]
  tone?: string
  height?: number
  width?: number
  fill?: boolean
}) {
  if (values.length < 2) return <div className="text-[10px] text-ink-faint">no series</div>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - ((v - min) / span) * (height - 4) - 2])
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" role="img" aria-label={`trend from ${values[0]} to ${values[values.length - 1]}`}>
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={tone} opacity={0.12} />}
      <path d={d} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.1} fill={tone} />
    </svg>
  )
}

// ---------------------------------------------------------------- area trend
export function TrendChart({
  series,
  height = 176,
  label = 'Risk score',
  bands = true,
  annotations = [],
  secondaryLabel,
}: {
  series: { date: string; risk: number; compliance?: number }[]
  height?: number
  label?: string
  bands?: boolean
  annotations?: { date: string; text: string }[]
  secondaryLabel?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const w = 720
  const h = height
  const padL = 26
  const padB = 18
  const padT = 10
  const xs = (i: number) => padL + (i / Math.max(1, series.length - 1)) * (w - padL - 6)
  const ys = (v: number) => padT + (1 - v / 100) * (h - padT - padB)
  const path = useMemo(() => {
    if (!series.length) return { risk: '', riskArea: '', comp: '' }
    const risk = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(p.risk).toFixed(1)}`).join(' ')
    const comp = series.some((p) => p.compliance !== undefined)
      ? series.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(pad(p.compliance ?? 0)).toFixed(1)}`).join(' ')
      : ''
    return { risk, riskArea: `${risk} L${xs(series.length - 1)},${ys(0)} L${xs(0)},${ys(0)} Z`, comp }
  }, [series, h])

  if (!series.length) return <div className="p-6 text-center text-[12px] text-ink-faint">No history for this scope yet.</div>

  const active = hover !== null ? series[hover] : null
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label={`${label} over ${series.length} days`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const rel = ((e.clientX - rect.left) / rect.width) * w
          const idx = Math.round(((rel - padL) / (w - padL - 6)) * (series.length - 1))
          setHover(Math.max(0, Math.min(series.length - 1, idx)))
        }}
      >
        {bands &&
          [[20, 'var(--risk-low)'], [40, 'var(--risk-moderate)'], [60, 'var(--risk-elevated)'], [80, 'var(--risk-high)'], [100, 'var(--risk-critical)']].map(([v, c], i, arr) => {
            const top = ys(i === 0 ? 0 : Number(arr[i - 1][0]))
            const bottom = ys(Number(v))
            return <rect key={i} x={padL} y={bottom} width={w - padL - 6} height={top - bottom} fill={c as string} opacity={0.055} />
          })}
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={padL} x2={w - 6} y1={ys(v)} y2={ys(v)} stroke="var(--line)" strokeDasharray={v === 0 ? '' : '2 4'} strokeWidth={1} />
            <text x={0} y={ys(v) + 3} className="fill-[var(--text-faint)] font-mono" fontSize={8.5}>
              {v}
            </text>
          </g>
        ))}
        <path d={path.riskArea} fill="var(--accent)" opacity={0.1} />
        <path d={path.risk} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {path.comp && <path d={path.comp} fill="none" stroke="var(--ok)" strokeWidth={1.5} strokeDasharray="4 3" />}
        {annotations.map((a, i) => {
          const idx = series.findIndex((p) => p.date >= a.date)
          if (idx < 0) return null
          return <line key={i} x1={xs(idx)} x2={xs(idx)} y1={padT} y2={h - padB} stroke="var(--warn)" strokeWidth={1} strokeDasharray="3 3" />
        })}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={padT} y2={h - padB} stroke="var(--line-strong)" strokeWidth={1} />}
        {hover !== null && <circle cx={xs(hover)} cy={ys(series[hover].risk)} r={3.4} fill="var(--accent)" stroke="var(--bg-panel)" strokeWidth={1.5} />}
        {active && (
          <g transform={`translate(${Math.min(xs(hover ?? 0) + 8, w - 150)}, ${padT + 4})`}>
            <rect width={142} height={38} rx={4} fill="var(--bg-raised)" stroke="var(--line)" />
            <text x={8} y={15} fontSize={9} className="fill-[var(--text-dim)] font-mono">
              {active.date}
            </text>
            <text x={8} y={30} fontSize={11} className="fill-[var(--text)] font-mono font-semibold">
              {label.split(' ')[0]} {active.risk.toFixed(1)}
              {active.compliance !== undefined ? ` · comp ${active.compliance.toFixed(0)}` : ''}
            </text>
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[10px] text-ink-faint">{series[0]?.date}</span>
        {secondaryLabel && (
          <span className="flex items-center gap-3 text-[10px] text-ink-faint">
            <span className="flex items-center gap-1">
              <span className="h-[2px] w-4" style={{ background: 'var(--accent)' }} /> {label}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-[2px] w-4 border-t border-dashed" style={{ borderColor: 'var(--ok)' }} /> {secondaryLabel}
            </span>
          </span>
        )}
        <span className="text-[10px] text-ink-faint">{series[series.length - 1]?.date}</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- factor bars
export function FactorBars({
  factors,
  showRaw = false,
  onSelect,
}: {
  factors: { key: string; label: string; points: number; cap: number; detail: string; share: number; raw?: number }[]
  showRaw?: boolean
  onSelect?: (key: string) => void
}) {
  return (
    <div className="space-y-2">
      {factors.map((f) => {
        const pctVal = Math.min(100, (f.points / (f.cap || 1)) * 100)
        const strong = f.points >= (f.cap || 1) * 0.75
        return (
          <button
            type="button"
            key={f.key}
            onClick={() => onSelect?.(f.key)}
            className={cx('group block w-full text-left', onSelect && 'cursor-pointer')}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={cx('text-[11.5px] font-medium', strong ? 'text-ink' : 'text-ink-dim')}>{f.label}</span>
              <span className="font-mono text-[11px] text-ink-dim">
                {f.points.toFixed(1)}
                <span className="text-ink-faint">/{f.cap}</span>
                {showRaw && f.raw !== undefined && <span className="ml-1.5 text-ink-faint">raw {f.raw.toFixed(0)}</span>}
              </span>
            </div>
            <div className="mt-1 h-[7px] w-full overflow-hidden rounded-sm bg-sunken">
              <div
                className="h-full rounded-sm transition-[width] duration-700 ease-out"
                style={{
                  width: `${pctVal}%`,
                  background: strong ? 'var(--risk-high)' : 'var(--accent)',
                  opacity: strong ? 1 : 0.82,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-faint group-hover:text-ink-dim">{f.detail}</p>
          </button>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------- bar chart
export function BarRowChart({
  items,
  unit = '',
  tone = 'var(--accent)',
  onSelect,
}: {
  items: { label: string; value: number; sub?: string; tone?: string; id?: string }[]
  unit?: string
  tone?: string
  onSelect?: (id: string) => void
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1)
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div
          key={it.label}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onClick={() => it.id && onSelect?.(it.id)}
          onKeyDown={(e) => e.key === 'Enter' && it.id && onSelect?.(it.id)}
          className={cx('grid grid-cols-[minmax(88px,1.1fr)_2fr_auto] items-center gap-2 rounded px-1 py-0.5', onSelect && 'row-hover cursor-pointer')}
        >
          <span className="truncate text-[11.5px] text-ink-dim" title={it.label}>
            {it.label}
          </span>
          <span className="h-[14px] w-full rounded-sm bg-sunken">
            <span
              className="block h-full rounded-sm transition-[width] duration-500"
              style={{ width: `${(Math.abs(it.value) / max) * 100}%`, background: it.tone ?? tone, opacity: 0.9 }}
            />
          </span>
          <span className="font-mono text-[11.5px] text-ink">
            {it.value.toFixed(0)}
            {unit}
            {it.sub && <span className="ml-1 text-ink-faint">{it.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// -------------------------------------------------------------------- donut
export function Donut({
  segments,
  size = 116,
  thickness = 13,
  center,
}: {
  segments: { label: string; value: number; color: string }[]
  size?: number
  thickness?: number
  center?: React.ReactNode
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={thickness} />
        {segments.map((s) => {
          const len = (s.value / total) * c
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
      </svg>
      {center && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  )
}

// -------------------------------------------------------------- gauge / ring
export function ScoreRing({
  score,
  size = 92,
  tone = 'var(--accent)',
  label = 'RISK',
  suffix = '/100',
  pulse,
}: {
  score: number
  size?: number
  tone?: string
  label?: string
  suffix?: string
  pulse?: boolean
}) {
  const thickness = size > 80 ? 7 : 5
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const len = (Math.max(0, Math.min(100, score)) / 100) * c
  return (
    <div className={cx('relative shrink-0', pulse && 'rounded-full animate-pulse-ring')} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${label} ${score.toFixed(0)} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${len} ${c - len}`}
          style={{ transition: 'stroke-dasharray 600ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-semibold leading-none tracking-tightest" style={{ fontSize: size * 0.3 }}>
          {score.toFixed(0)}
        </span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide2 text-ink-faint">
          {suffix ? label : ''}
        </span>
        {suffix && <span className="text-[9px] text-ink-faint">{suffix}</span>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ band heatmap
export function BandStrip({ counts }: { counts: Record<string, number> }) {
  const entries = [
    ['LOW', 'var(--risk-low)'],
    ['MODERATE', 'var(--risk-moderate)'],
    ['ELEVATED', 'var(--risk-elevated)'],
    ['HIGH', 'var(--risk-high)'],
    ['CRITICAL', 'var(--risk-critical)'],
  ] as const
  const total = entries.reduce((a, [k]) => a + (counts[k] || 0), 0) || 1
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-sunken">
        {entries.map(([k, c]) =>
          counts[k] ? <div key={k} style={{ width: `${((counts[k] || 0) / total) * 100}%`, background: c }} title={`${k}: ${counts[k]}`} /> : null,
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {entries.map(([k, c]) => (
          <span key={k} className="flex items-center gap-1 text-[10px] text-ink-dim">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
            {k} <span className="font-mono text-ink-faint">{counts[k] || 0}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------- status funnel
export function StatusFunnel({ steps, onSelect }: { steps: { status: string; count: number }[]; onSelect?: (status: string) => void }) {
  const max = Math.max(...steps.map((s) => s.count), 1)
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((s, i) => {
        const tone = i >= 4 ? 'var(--risk-low)' : i >= 2 ? 'var(--risk-elevated)' : 'var(--risk-high)'
        return (
          <button
            key={s.status}
            type="button"
            onClick={() => onSelect?.(s.status)}
            className={cx('group rounded border border-line bg-sunken p-2 text-left transition-colors', onSelect && 'hover:border-line-strong')}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-semibold uppercase tracking-wide2 text-ink-faint">{s.status.replace(/_/g, ' ')}</span>
              {i < steps.length - 1 && <IconArrow />}
            </div>
            <div className="mt-1 font-mono text-[19px] font-semibold leading-none">{s.count}</div>
            <div className="mt-1.5 h-[3px] w-full rounded bg-panel">
              <div className="h-full rounded" style={{ width: `${(s.count / max) * 100}%`, background: tone }} />
            </div>
          </button>
        )
      })}
    </div>
  )
}

function IconArrow() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" className="text-ink-faint" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 12h14m0 0-5-5m5 5-5 5" />
    </svg>
  )
}

// ------------------------------------------------------- stacked share bar
export function ShareBar({ parts, className }: { parts: { label: string; value: number; color: string }[]; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className={className}>
      <div className="flex h-2 w-full overflow-hidden rounded-sm">
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`}>
            <span className="sr-only">{`${p.label} ${p.value}`}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1 text-[10.5px] text-ink-dim">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="font-mono text-ink-faint">{Math.round((p.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}
