import React from 'react'
import { Badge, Icon, Panel, Progress, cx } from './ui'
import { bandFor, fmt, signed } from '../lib/format'
import type { CompliancePayload, Impact, RiskAssessment, Trend } from '../lib/types'
import { FactorBars, ScoreRing, TrendChart } from './charts'

/**
 * Risk presentation. These components only *render* engine output — they never
 * compute a score. That is the rule that keeps the product honest: the number,
 * its explanation and its recommendations always come from the same call.
 */

export function RiskBadge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const { label, tone } = bandFor(score)
  return (
    <span
      className={cx('chip border', tone === 'critical' || tone === 'high' ? 'tone-soft' : 'tone-soft', size === 'sm' ? 'text-[9px] px-1 py-0' : '')}
      style={{ ['--tone' as any]: `var(--risk-${tone})` }}
      title={`${label} risk: ${score.toFixed(1)}/100`}
    >
      <span className="h-1.5 w-1.5 rounded-full tone-bg" />
      {label}
      {size === 'md' && <span className="font-mono opacity-80">{Math.round(score)}</span>}
    </span>
  )
}

export function ScoreDelta({ impact, compact }: { impact?: Impact | null; compact?: boolean }) {
  if (!impact || impact.before === undefined) return null
  const up = impact.delta > 0
  const flat = Math.abs(impact.delta) < 0.05
  const color = flat ? 'var(--text-dim)' : up ? 'var(--risk-high)' : 'var(--risk-low)'
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-mono', compact ? 'text-[11px]' : 'text-[13px]')} style={{ color }}>
      <span className="text-ink-dim">{fmt(impact.before, 1)}</span>
      <Icon name={flat ? 'arrowRight' : up ? 'arrowUp' : 'arrowDown'} className="h-3 w-3" />
      <span className="font-semibold">{fmt(impact.after, 1)}</span>
      {!flat && <span className="text-[10.5px] opacity-80">({signed(impact.delta, 1)})</span>}
    </span>
  )
}

/** The headline risk readout: score, band, method stamp. */
export function RiskHeader({
  risk,
  size = 92,
  right,
  showPulse,
}: {
  risk: Pick<RiskAssessment, 'risk_score' | 'risk_level' | 'tone' | 'method' | 'metrics'>
  size?: number
  right?: React.ReactNode
  showPulse?: boolean
}) {
  const tone = risk.tone || bandFor(risk.risk_score).tone
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ScoreRing score={risk.risk_score} size={size} tone={`var(--risk-${tone})`} pulse={showPulse ?? tone === 'critical'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone} dot>
            {risk.risk_level} RISK
          </Badge>
          <span className="text-[10.5px] text-ink-faint">
            {risk.metrics.open_violations} open · {risk.metrics.overdue_action_count} overdue · {risk.metrics.repeat_violations} repeat
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <MiniStat label="Severity exposure" value={`${fmt(risk.metrics.severity_exposure)}`} sub={`of ${fmt(risk.metrics.target_exposure)} target`} />
          <MiniStat label="Logged / 30d" value={fmt(risk.metrics.violations_30d)} sub={`prev ${fmt(risk.metrics.violations_prev_30d)}`} />
          <MiniStat label="Last inspection" value={risk.metrics.days_since_inspection === null ? 'none' : `${fmt(risk.metrics.days_since_inspection)}d`} sub={`cadence ${fmt(risk.metrics.inspection_cadence_days)}d`} tone={risk.metrics.inspection_overdue ? 'var(--risk-elevated)' : undefined} />
          <MiniStat label="Unresolved >30d" value={fmt(risk.metrics.unresolved_30_plus)} sub={`worst overdue ${fmt(risk.metrics.max_overdue_days)}d`} tone={risk.metrics.unresolved_30_plus ? 'var(--risk-high)' : undefined} />
        </div>
        {right}
      </div>
    </div>
  )
}

export function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-mono text-[14px] font-semibold leading-tight" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-faint">{sub}</div>}
    </div>
  )
}

/**
 * WHY panel. Mandatory in this product: a score is never rendered on its own
 * without its drivers.
 */
export function ExplanationPanel({
  risk,
  title = 'Why this score',
  showFactors = true,
  showRaw = false,
  onSelectFactor,
}: {
  risk: RiskAssessment
  title?: string
  showFactors?: boolean
  showRaw?: boolean
  onSelectFactor?: (key: string) => void
}) {
  const active = [...risk.factors].sort((a, b) => b.points - a.points)
  const total = active.reduce((a, f) => a + f.points, 0) || 1
  return (
    <Panel
      title={title}
      subtitle={`${risk.risk_score.toFixed(1)}/100 · ${risk.risk_level} · engine: ${risk.method?.split('|')[0]?.trim() ?? 'rule-based'}`}
      right={<Badge tone={bandFor(risk.risk_score).tone} dot>{total.toFixed(1)} pts accounted</Badge>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          {showFactors && <FactorBars factors={active} showRaw={showRaw} onSelect={onSelectFactor} />}
          <div className="mt-3 rounded border border-line bg-sunken p-2.5">
            <div className="label mb-1.5">Contributors to {risk.risk_score.toFixed(0)}</div>
            <div className="flex h-3 w-full overflow-hidden rounded-sm bg-panel">
              {active
                .filter((f) => f.points > 0.05)
                .map((f) => (
                  <div
                    key={f.key}
                    title={`${f.label}: ${f.points.toFixed(1)} pts (${Math.round((f.points / total) * 100)}%)`}
                    style={{
                      width: `${(f.points / total) * 100}%`,
                      background: f.points >= f.cap * 0.75 ? 'var(--risk-high)' : `var(--${f.key === 'severity' ? 'accent' : f.key === 'repeat' ? 'elevated' : f.key === 'unresolved' ? 'info' : f.key === 'overdue' ? 'warn' : 'moderate'})`,
                    }}
                  />
                ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {active
                .filter((f) => f.points > 0.05)
                .map((f) => (
                  <span key={f.key} className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: f.points >= f.cap * 0.75 ? 'var(--risk-high)' : 'var(--accent)' }}
                    />
                    {f.label.replace(' Corrective Actions', ' Actions')}
                    <span className="font-mono text-ink-faint">{Math.round((f.points / total) * 100)}%</span>
                  </span>
                ))}
            </div>
          </div>
        </div>
        <div>
          <div className="label mb-1.5">Detected conditions</div>
          <ul className="space-y-1.5">
            {risk.drivers.length ? (
              risk.drivers.map((d, i) => (
                <li key={i} className="flex gap-2 rounded border border-line bg-sunken px-2 py-1.5 text-[11.5px] leading-snug text-ink-dim">
                  <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i === 0 ? 'var(--risk-high)' : 'var(--accent)' }} />
                  <span>{d}</span>
                </li>
              ))
            ) : (
              <li className="rounded border border-line bg-sunken px-2 py-1.5 text-[11.5px] text-ink-faint">
                No adverse conditions detected in this scope — score reflects the absence of open exposure.
              </li>
            )}
          </ul>
          <div className="mt-3 flex items-start gap-2 rounded border border-dashed border-line-strong bg-panel p-2 text-[11px] leading-snug text-ink-faint">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Factors are capped independently (severity {fmt(risk.factors[0]?.cap ?? 0)} max, repeat {fmt(risk.factors[1]?.cap ?? 0)} etc.), so one driver cannot
              manufacture a critical band on its own.
            </span>
          </div>
        </div>
      </div>
    </Panel>
  )
}

export function RecommendationList({
  items,
  tone = 'accent',
  header,
  footer,
}: {
  items: { priority: string; action: string; owner_hint?: string }[]
  tone?: string
  header?: React.ReactNode
  footer?: React.ReactNode
}) {
  const order: Record<string, number> = { immediate: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...items].sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9))
  return (
    <Panel title={header ?? 'Recommended action'} subtitle={items.length ? 'Ordered by priority; derived from the same factors as the score' : undefined}>
      <ol className="space-y-1.5">
        {sorted.map((r, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded border border-line bg-sunken p-2.5">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10.5px] font-semibold"
              style={{
                background: r.priority === 'immediate' ? 'var(--risk-high)' : 'var(--bg-raised)',
                color: r.priority === 'immediate' ? '#fff' : 'var(--text-dim)',
                border: r.priority === 'immediate' ? 'none' : '1px solid var(--line-strong)',
              }}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] leading-snug text-ink">{r.action}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={r.priority === 'immediate' ? 'high' : r.priority === 'high' ? 'elevated' : 'moderate'}>{r.priority}</Badge>
                {r.owner_hint && <span className="text-[10.5px] text-ink-faint">owner: {r.owner_hint}</span>}
              </div>
            </div>
          </li>
        ))}
        {!sorted.length && <li className="py-4 text-center text-[12px] text-ink-faint">No action required for the current state.</li>}
      </ol>
      {footer}
    </Panel>
  )
}

export function CompliancePanel({ compliance, riskScore }: { compliance: CompliancePayload; riskScore?: number }) {
  const score = compliance.compliance_score
  const tone = score >= 80 ? 'low' : score >= 65 ? 'moderate' : score >= 50 ? 'elevated' : 'high'
  return (
    <Panel
      title="Compliance score"
      subtitle="Process discipline — measured independently of risk"
      right={
        <div className="flex items-center gap-2">
          {riskScore !== undefined && (
            <span className="text-[10.5px] text-ink-faint" title="Divergence is the signal: high compliance with high risk means the paperwork works and the plant does not.">
              risk {riskScore.toFixed(0)} vs compliance {score.toFixed(0)}
            </span>
          )}
          <Badge tone={tone} dot>
            {Math.round(score)}/100
          </Badge>
        </div>
      }
    >
      <div className="space-y-2">
        {compliance.components.map((c) => {
          const penalised = c.penalty > 0.05
          return (
            <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded border border-line bg-sunken px-2.5 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[12px] font-medium text-ink">{c.label}</span>
                  <span className="text-[11px] text-ink-faint">{c.value}</span>
                </div>
                {c.detail && <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">{c.detail}</p>}
                {penalised && <Progress className="mt-1.5" value={Math.min(c.penalty, 30)} max={30} tone="var(--risk-elevated)" height={3} />}
              </div>
              <span className={cx('font-mono text-[12px] font-semibold', c.penalty > 0 ? 'text-[color:var(--risk-elevated)]' : c.penalty < 0 ? 'text-[color:var(--risk-low)]' : 'text-ink-faint')}>
                {c.penalty > 0 ? `−${c.penalty.toFixed(1)}` : c.penalty < 0 ? `+${Math.abs(c.penalty).toFixed(1)}` : '0.0'}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

export function RiskTrendPanel({ trend, zoneName, height = 150 }: { trend: Trend; zoneName?: string; height?: number }) {
  const dir = trend.direction
  return (
    <Panel
      title={`Risk trend${zoneName ? ` — ${zoneName}` : ''}`}
      subtitle="Replayed through the engine day by day, not stored snapshots"
      right={
        <Badge tone={dir === 'rising' ? 'high' : dir === 'falling' ? 'low' : 'moderate'} dot>
          {dir === 'rising' ? '↑' : dir === 'falling' ? '↓' : '→'} {signed(trend.change, 1)} pts / 30d
        </Badge>
      }
    >
      <TrendChart series={trend.series} height={height} label="Risk score" secondaryLabel="Compliance score" />
    </Panel>
  )
}


export function RiskTrendBadge({ trend, days = 30 }: { trend: { change: number; change_pct: number; direction: string }; days?: number }) {
  const tone = trend.direction === 'rising' ? 'high' : trend.direction === 'falling' ? 'low' : 'moderate'
  return (
    <Badge tone={tone as any} dot title={`30-day movement of the engine score`}>
      {trend.direction === 'rising' ? '↑' : trend.direction === 'falling' ? '↓' : '→'} {signed(trend.change_pct, 1)}% · {days}d
    </Badge>
  )
}
