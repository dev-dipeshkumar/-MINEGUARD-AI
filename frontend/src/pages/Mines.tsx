import React, { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Icon, Panel, Progress, SegmentedControl, Skeleton, Tabs, cx } from '../components/ui'
import { ScoreRing, Sparkline, TrendChart } from '../components/charts'
import { MineMap } from '../components/MineMap'
import { ZoneDrawer } from '../components/ZoneDrawer'
import { RiskBadge, RiskTrendBadge } from '../components/risk'
import { useApp, useAsync } from '../state/app'
import { endpoints } from '../lib/api'
import type { Mine, Trend, Zone } from '../lib/types'
import { bandFor, fmt, signed } from '../lib/format'

type MineZone = Zone & { open_violations: number; trend: number }

type MineRow = Omit<Mine, 'zones'> & {
  zones: MineZone[]
  trend: Trend
  summary: { total: number; open: number; critical: number; high: number; aged_30: number; unassigned: number }
  overdue_actions: number
}

const criticalCount = (m: MineRow) => (m.zones ?? []).filter((z) => ['HIGH', 'CRITICAL'].includes(z.risk_level)).length

/**
 * Module 2 — mine and zone intelligence. The list answers "which site should I
 * open first"; the detail view answers "which zone inside it, and why".
 */
export function MinesPage() {
  const { data, loading, error, reload } = useAsync<MineRow[]>(endpoints.mines)
  const [params, setParams] = useSearchParams()
  const [band, setBand] = useState<'ALL' | 'ATTENTION' | 'HIGH'>((params.get('band') === 'HIGH' ? 'HIGH' : 'ALL') as any)
  const [drawer, setDrawer] = useState<string | null>(null)
  const navigate = useNavigate()

  const rows = useMemo(() => {
    const list = data ?? []
    const filtered =
      band === 'HIGH'
        ? list.filter((m) => ['HIGH', 'CRITICAL'].includes(m.risk_level))
        : band === 'ATTENTION'
        ? list.filter((m) => criticalCount(m) > 0 || m.overdue_actions > 0)
        : list
    return [...filtered].sort((a, b) => b.risk_score - a.risk_score)
  }, [data, band])

  const setBandAndUrl = (v: string) => {
    setBand(v as any)
    const next = new URLSearchParams(params)
    if (v === 'HIGH') next.set('band', 'HIGH')
    else next.delete('band')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 2 · Operations"
        title="Mines & zones"
        subtitle="Every site with its engine score, band and 30-day movement. Site scores are exposure weighted, so a critical zone drags its mine — that is intentional, not an averaging artefact."
        actions={
          <>
            <SegmentedControl
              size="sm"
              value={band}
              onChange={setBandAndUrl}
              options={[
                { value: 'ALL', label: 'All mines' },
                { value: 'ATTENTION', label: 'Needs attention' },
                { value: 'HIGH', label: 'High / critical' },
              ]}
            />
            <Button size="sm" variant="primary" onClick={() => navigate('/inspections?new=1')} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>
              New inspection
            </Button>
          </>
        }
      />
      <PageBody className="space-y-3">
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !data && (
          <div className="grid gap-3 xl:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        )}
        {!loading && rows.length === 0 && !error && <EmptyState icon="map" title="No mines match this filter" body="Switch back to “All mines” to see the full portfolio." />}
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((m) => {
            const tone = bandFor(m.risk_score).tone
            return (
              <article key={m.id} className="panel overflow-hidden">
                <div className="flex items-start gap-3 border-b border-line p-3">
                  <ScoreRing score={m.risk_score} size={64} tone={`var(--risk-${tone})`} pulse={tone === 'critical'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="text-[14px] font-semibold hover:underline" onClick={() => navigate(`/mines/${m.id}`)}>
                        {m.name}
                      </button>
                      <Badge tone={tone as any} dot>
                        {m.risk_level}
                      </Badge>
                      {criticalCount(m) > 0 && <Badge tone="critical">{criticalCount(m)} zone(s) ≥ HIGH</Badge>}
                      <span className="ml-auto font-mono text-[10.5px] text-ink-faint">{m.code}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">{m.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
                      <span className="flex items-center gap-1">
                        <Icon name="pin" className="h-3 w-3" /> {m.location}
                      </span>
                      <span>{m.mine_type.replace(/_/g, ' ').toLowerCase()}</span>
                      <span>{fmt(m.workforce)} workforce</span>
                      <span>{fmt(m.annual_output_kt)} kt/yr</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                  <Metric label="Compliance" value={fmt(m.compliance_score, 0)} sub="of 100, process-based" tone={`var(--risk-${bandFor(100 - m.compliance_score).tone})`} />
                  <Metric label="Open findings" value={fmt(m.summary.open)} sub={`${m.summary.critical} critical · ${m.summary.high} high`} />
                  <Metric label="Overdue actions" value={fmt(m.overdue_actions)} sub={m.overdue_actions ? 'escalation pending' : 'nothing pending'} tone={m.overdue_actions ? 'var(--risk-elevated)' : undefined} />
                  <Metric label="30-day movement" value={signed(m.trend.change, 1)} sub={`${m.trend.direction} · ${fmt(m.risk_score - m.trend.change, 0)} was`} tone={m.trend.change > 0 ? 'var(--risk-high)' : 'var(--risk-low)'} />
                </div>

                <div className="px-3 pb-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="label">Zones — click to open the dossier</span>
                    <span className="font-mono text-[10px] text-ink-faint">risk · 30d</span>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {(m.zones ?? []).map((z) => {
                      const zt = z.risk_tone
                      return (
                        <button key={z.id} onClick={() => setDrawer(z.id)} className="flex items-center gap-2 rounded border border-line bg-sunken px-2 py-1.5 text-left transition-colors hover:border-line-strong">
                          <span className="h-6 w-[3px] shrink-0 rounded-sm" style={{ background: `var(--risk-${zt})` }} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11.5px] font-medium">{z.name}</span>
                            <span className="block truncate text-[10px] text-ink-faint">
                              {z.open_violations} open · {z.zone_type.toLowerCase()} · {z.inspection_cadence_days}d cadence
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Sparkline values={[Math.max(0, z.risk_score - z.trend), z.risk_score]} tone={`var(--risk-${zt})`} width={34} height={16} fill={false} />
                            <span className="w-7 text-right font-mono text-[12px] font-semibold" style={{ color: `var(--risk-${zt})` }}>
                              {z.risk_score.toFixed(0)}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-line bg-sunken px-3 py-1.5">
                  <span className="text-[10.5px] text-ink-faint">{m.regulatory_body} · licence {m.licence}</span>
                  <div className="flex items-center gap-2">
                    {!m.reporting_current && <Badge tone="elevated">statutory return outstanding</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/mines/${m.id}`)} icon={<Icon name="arrowRight" className="h-3 w-3" />}>
                      Open site
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </PageBody>
      <ZoneDrawer zoneId={drawer} onClose={() => setDrawer(null)} />
    </>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-sunken px-2 py-1.5">
      <div className="label">{label}</div>
      <div className="font-mono text-[16px] font-semibold leading-tight" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="truncate text-[10px] text-ink-faint">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------- detail
export function MineDetailPage() {
  const { mineId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // The detail payload is a superset of the list row; typed loosely on purpose so zone-level
  // engine objects (risk, compliance, trends) stay readable without duplicating the schema here.
  const { data, loading, error, reload } = useAsync<any>(mineId ? endpoints.mine(mineId) : null, [mineId])
  const [drawer, setDrawer] = useState<string | null>(params.get('zone'))
  const [tab, setTab] = useState<'map' | 'zones' | 'alerts' | 'actions'>('map')
  useApp()

  if (error)
    return (
      <PageBody>
        <ErrorState message={error} onRetry={reload} />
      </PageBody>
    )
  if (loading && !data)
    return (
      <PageBody className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </PageBody>
    )
  if (!data)
    return (
      <PageBody>
        <EmptyState icon="map" title="Mine not found" body="The site id in the address bar is not in this dataset." action={<Button size="sm" onClick={() => navigate('/mines')}>Back to mines</Button>} />
      </PageBody>
    )

  const mine: any = data
  const tone = bandFor(mine.risk_score).tone

  const closeDrawer = () => {
    setDrawer(null)
    const next = new URLSearchParams(params)
    next.delete('zone')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <button onClick={() => navigate('/mines')} className="inline-flex items-center gap-1 hover:text-ink">
            <Icon name="chevronLeft" className="h-3 w-3" /> Mines & zones
          </button>
        }
        title={mine.name}
        subtitle={`${mine.location} · ${mine.operator} · licence ${mine.licence}`}
        actions={
          <>
            <Button size="sm" variant="primary" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => navigate(`/inspections?mine=${mine.id}&new=1`)}>
              Record inspection
            </Button>
            <Button size="sm" onClick={() => navigate(`/reports?mine=${mine.id}`)}>
              Risk report
            </Button>
          </>
        }
        tabs={
          <Tabs
            value={tab}
            onChange={(v) => setTab(v as any)}
            items={[
              { value: 'map', label: 'Operations map' },
              { value: 'zones', label: 'Zone board', count: mine.zones.length },
              { value: 'alerts', label: 'Early warnings', count: mine.alerts.length },
              { value: 'actions', label: 'Overdue queue', count: mine.overdue_actions.length },
            ]}
          />
        }
      />

      <PageBody className="space-y-3.5">
        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <Panel title="Site position" right={<Badge tone={tone as any} dot>{mine.risk_level}</Badge>}>
            <div className="flex flex-wrap items-center gap-4">
              <ScoreRing score={mine.risk_score} size={88} tone={`var(--risk-${tone})`} pulse={tone === 'critical'} />
              <div className="grid min-w-[220px] flex-1 grid-cols-2 gap-2">
                <Metric label="Risk score" value={fmt(mine.risk_score, 1)} sub="engine, 0–100" tone={`var(--risk-${tone})`} />
                <Metric label="Compliance" value={fmt(mine.computed.compliance_score, 0)} sub="process, 0–100" tone={`var(--risk-${bandFor(100 - mine.computed.compliance_score).tone})`} />
                <Metric label="Open findings" value={fmt(mine.summary.open)} sub={`${mine.summary.critical} critical, ${mine.summary.aged_30} over 30d`} />
                <Metric label="Overdue actions" value={fmt(mine.overdue_actions.length)} sub={mine.overdue_actions.length ? 'escalation pending' : 'clean'} tone={mine.overdue_actions.length ? 'var(--risk-elevated)' : undefined} />
              </div>
            </div>
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="label">30-day risk trend</span>
                <RiskTrendBadge trend={mine.trend} />
              </div>
              <TrendChart series={mine.trend.series} height={116} label={`${mine.name} risk`} />
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">{mine.description}</p>
          </Panel>

          <Panel
            title={tab === 'map' ? 'Mine compliance map' : tab === 'zones' ? 'Zone board' : tab === 'alerts' ? 'Active early warnings' : 'Overdue corrective actions'}
            subtitle={
              tab === 'map'
                ? 'Rectangles are the stored zone geometry, painted by engine score. Click a zone for its dossier.'
                : tab === 'zones'
                ? 'Ranked by engine score, with the dominant driver and last round'
                : tab === 'alerts'
                ? 'Raised by the early-warning generator for this site'
                : 'Sorted by days past the committed date'
            }
            right={tab === 'map' ? <Badge tone="neutral">{mine.zones.length} zones</Badge> : undefined}
          >
            {tab === 'map' && (
              <MineMap
                zones={mine.zones.map((z: any) => ({ ...z, open_violations: z.risk?.metrics?.open_violations ?? 0, trend: z.trend?.change ?? 0 }) as any)}
                selected={drawer}
                onSelect={(id) => {
                  setDrawer(id)
                  const next = new URLSearchParams(params)
                  next.set('zone', id)
                  setParams(next, { replace: true })
                }}
              />
            )}

            {tab === 'zones' && (
              <div className="space-y-1.5">
                {[...mine.zones]
                  .sort((a: any, b: any) => b.risk_score - a.risk_score)
                  .map((z: any) => {
                    const zt = z.risk_tone
                    const top = [...(z.risk?.factors ?? [])].sort((a: any, b: any) => b.points - a.points)[0]
                    return (
                      <button key={z.id} onClick={() => setDrawer(z.id)} className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1.7fr)_auto] items-center gap-3 rounded border border-line bg-sunken p-2 text-left transition-colors hover:border-line-strong">
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium">{z.name}</span>
                          <span className="block truncate text-[10.5px] text-ink-faint">
                            {z.risk?.metrics?.open_violations ?? 0} open · cadence {z.inspection_cadence_days}d · last round {z.risk?.metrics?.days_since_inspection ?? '—'}d ago{z.risk?.metrics?.inspection_overdue ? ' (overdue)' : ''}
                          </span>
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-panel">
                            <span className="block h-full" style={{ width: `${z.risk_score}%`, background: `var(--risk-${zt})` }} />
                          </span>
                          <span className="w-[74px] shrink-0">
                            <Sparkline values={(z.trend?.series ?? []).map((s: any) => s.risk)} tone={`var(--risk-${zt})`} width={74} height={20} />
                          </span>
                          <span className="hidden w-[112px] shrink-0 truncate text-[10px] text-ink-faint xl:block">{top ? `lead: ${top.label}` : ''}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-[14px] font-semibold" style={{ color: `var(--risk-${zt})` }}>
                            {z.risk_score.toFixed(0)}
                          </span>
                          <RiskBadge score={z.risk_score} />
                        </span>
                      </button>
                    )
                  })}
              </div>
            )}

            {tab === 'alerts' && (
              <div className="space-y-2">
                {mine.alerts.length === 0 ? (
                  <EmptyState icon="check" title="No active warnings for this site" body="Nothing is trending, repeating or lapsing beyond tolerance." className="py-8" />
                ) : (
                  mine.alerts.map((a: any) => (
                    <div key={a.id} className="rounded border border-line bg-sunken p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={a.severity === 'CRITICAL' ? 'critical' : a.severity === 'HIGH' ? 'high' : 'elevated'} dot>
                          {a.severity}
                        </Badge>
                        <span className="text-[12.5px] font-medium">{a.title}</span>
                        <span className="ml-auto text-[10.5px] text-ink-faint">{a.scope_name}</span>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">{a.narrative}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {a.reasons.map((r: any, i: number) => (
                          <span key={i} className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-ink-dim">
                            {r.label}: <span className="font-mono text-ink">{r.value}</span>
                            {r.delta && <span className="ml-1 text-ink-faint">{r.delta}</span>}
                          </span>
                        ))}
                      </div>
                      <div className="mt-1.5 flex gap-2">
                        {a.scope_type === 'ZONE' && (
                          <Button size="sm" variant="ghost" onClick={() => setDrawer(a.scope_id)}>
                            Investigate {a.scope_name}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/early-warning?severity=${a.severity}`)}>
                          Open early-warning centre
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'actions' && (
              <div className="space-y-1.5">
                {mine.overdue_actions.length === 0 ? (
                  <EmptyState icon="check" title="Nothing overdue" body="Every corrective action on this site is inside its committed date." className="py-8" />
                ) : (
                  mine.overdue_actions.map((a: any) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 rounded border border-[color:var(--danger)]/35 p-2">
                      <span className="font-mono text-[11px] text-ink-dim">{a.id}</span>
                      <Badge tone="high">{a.days_overdue}d overdue</Badge>
                      <Badge tone={a.priority === 'CRITICAL' ? 'critical' : a.priority === 'HIGH' ? 'high' : 'moderate'}>{a.priority}</Badge>
                      <span className="min-w-0 flex-1 truncate text-[12px]">{a.description}</span>
                      <span className="text-[10.5px] text-ink-faint">{a.owner_name ?? a.assigned_to}</span>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/actions?focus=${a.id}`)}>
                        Handle
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Why this site scores what it does" subtitle="Zone-level factor decomposition; the dominant factor of each zone is quoted from the engine explanation">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {mine.zones.map((z: any) => {
              const top = [...(z.risk?.factors ?? [])].sort((a: any, b: any) => b.points - a.points)[0]
              return (
                <button key={z.id} onClick={() => setDrawer(z.id)} className="rounded border border-line bg-sunken p-2.5 text-left transition-colors hover:border-line-strong">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium">{z.short_name}</span>
                    <RiskBadge score={z.risk_score} />
                    <span className="ml-auto font-mono text-[10px] text-ink-faint">{signed(z.trend?.change ?? 0, 1)} /30d</span>
                  </div>
                  {top ? (
                    <>
                      <p className="mt-1.5 text-[11px] leading-snug text-ink-dim">
                        <span className="text-ink-faint">dominant:</span> {top.label} ({fmt(top.points, 1)}/{fmt(top.cap, 0)})
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">{top.detail}</p>
                      <Progress className="mt-1.5" value={top.points} max={top.cap} tone={`var(--risk-${z.risk_tone})`} height={3} />
                    </>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-ink-faint">No factor is contributing — zone is clean.</p>
                  )}
                </button>
              )
            })}
          </div>
        </Panel>
      </PageBody>

      <ZoneDrawer zoneId={drawer} onClose={closeDrawer} />
    </>
  )
}
