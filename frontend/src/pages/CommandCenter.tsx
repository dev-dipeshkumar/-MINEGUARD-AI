import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Icon, IconButton, Panel, Progress, Skeleton, cx } from '../components/ui'
import { BandStrip, ScoreRing, Sparkline, TrendChart } from '../components/charts'
import { RiskBadge } from '../components/risk'
import { ZoneDrawer } from '../components/ZoneDrawer'
import { useApp, useAsync } from '../state/app'
import { endpoints } from '../lib/api'
import type { Alert, DashboardPayload, Insight } from '../lib/types'
import { bandFor, fmt, humanize, pct, relative, signed } from '../lib/format'
import { DemoTray } from '../components/DemoTray'

/**
 * Module 1 — Enterprise Command Center.
 *
 * Organised around one question: what needs attention right now? The order of
 * the page is the order of the work: overall position → what is emerging → why
 * it is emerging → what to do → the queue that has to move.
 */
export function CommandCenter() {
  const { data, loading, error, reload } = useAsync<DashboardPayload>(endpoints.dashboard())
  const { boot } = useApp()
  const navigate = useNavigate()
  const [inspectZone, setInspectZone] = useState<string | null>(null)
  const [openAlert, setOpenAlert] = useState<string | null>(null)
  const [scope, setScope] = useState<string>('ENTERPRISE')

  const dash = data
  const kpi = dash?.kpis


  if (error) {
    return (
      <PageBody>
        <ErrorState message={error} onRetry={reload} />
      </PageBody>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 1 · Enterprise Command Center"
        title="What needs attention right now"
        subtitle="A single view of emerging compliance risk across every mine: not a record of what happened, but a ranked, explained and actionable read on what is becoming serious."
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded border border-line bg-sunken p-0.5">
              <ScopeChip active={scope === 'ENTERPRISE'} onClick={() => setScope('ENTERPRISE')}>
                Enterprise
              </ScopeChip>
              {boot?.mines.map((m) => (
                <ScopeChip key={m.id} active={scope === m.code} onClick={() => setScope(m.code)}>
                  {m.code}
                </ScopeChip>
              ))}
            </div>
            <Button size="sm" variant="primary" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => navigate('/inspections?new=1')}>
              Record inspection
            </Button>
          </>
        }
      />

      <PageBody className="space-y-3.5">
        {/* ------------------------------------------------------ hero row */}
        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
          <Panel
            title="Enterprise compliance health"
            subtitle={dash ? `engine output as of ${dash.as_of} · ${dash.generated_at?.slice(11, 16) ?? ''}` : 'loading'}
            right={<Badge tone="neutral">{boot?.engine.mode === 'rule-based' ? 'Phase 1 rules' : 'ML'}</Badge>}
            className={cx(!dash && 'min-h-[240px]')}
          >
            {!dash ? (
              <div className="flex gap-4">
                <Skeleton className="h-[92px] w-[92px] rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-14 w-full" />
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-3">
                    <ScoreRing score={dash.enterprise.compliance_score} size={92} tone={`var(--risk-${bandFor(100 - dash.enterprise.compliance_score).tone})`} label="COMPLIANCE" />
                    <div>
                      <div className="label">overall compliance score</div>
                      <div className="font-mono text-[30px] font-semibold leading-none tracking-tightest">
                        {dash.enterprise.compliance_score.toFixed(0)}
                        <span className="text-[15px] text-ink-faint">/100</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Badge tone={bandFor(100 - dash.enterprise.compliance_score).tone} dot>
                          {dash.enterprise.compliance_label}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="h-14 w-px bg-line" />
                  <div>
                    <div className="label">enterprise risk</div>
                    <div className="font-mono text-[30px] font-semibold leading-none tracking-tightest" style={{ color: `var(--risk-${dash.enterprise.tone})` }}>
                      {dash.enterprise.risk_score.toFixed(0)}
                    </div>
                    <div className="mt-1.5">
                      <RiskBadge score={dash.enterprise.risk_score} />
                    </div>
                  </div>
                  <div className="ml-auto min-w-[132px]">
                    <div className="label mb-1">30-day risk movement</div>
                    <Sparkline values={dash.risk_trend.series.map((s) => s.risk)} tone={`var(--risk-${dash.enterprise.tone})`} width={132} height={40} />
                    <div className={cx('mt-1 font-mono text-[11px]', dash.risk_trend.change > 0 ? 'text-[color:var(--risk-high)]' : 'text-[color:var(--risk-low)]')}>
                      {signed(dash.risk_trend.change, 1)} pts · {pct(dash.risk_trend.change_pct, 0)}
                    </div>
                  </div>
                </div>

                <div className="rounded border border-line bg-sunken p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-ink-dim">
                      Compliance and risk are computed separately. Compliance measures process discipline; risk measures what is likely to
                      become serious. A gap between them is the finding itself.
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                    {[
                      ['Open findings', kpi!.open_violations, ''],
                      ['Critical findings', kpi!.critical_violations, 'var(--risk-critical)'],
                      ['Unassigned', kpi!.unassigned_violations, 'var(--risk-elevated)'],
                      ['Awaiting verification', kpi!.verification_backlog, ''],
                    ].map(([label, value, tone]) => (
                      <div key={label as string}>
                        <div className="label">{label}</div>
                        <div className="font-mono text-[15px] font-semibold" style={{ color: (tone as string) || undefined }}>
                          {fmt(value as number)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="label mb-1.5">Zone band distribution</div>
                  <BandStrip counts={dash.band_distribution} />
                </div>
              </div>
            )}
          </Panel>

          {/* clickable KPI tiles: the four numbers management is asked about */}
          <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            {[
              {
                key: 'critical',
                label: 'Critical risks',
                value: kpi?.critical_alerts,
                sub: 'open early warnings',
                tone: 'var(--risk-critical)',
                to: '/early-warning?severity=CRITICAL',
                icon: 'alert' as const,
              },
              {
                key: 'zones',
                label: 'High-risk zones',
                value: kpi?.high_risk_zones,
                sub: `${kpi?.zones_needing_attention ?? 0} need attention`,
                tone: 'var(--risk-high)',
                to: '/mines?band=HIGH',
                icon: 'map' as const,
              },
              {
                key: 'overdue',
                label: 'Overdue actions',
                value: kpi?.overdue_actions,
                sub: 'past committed date',
                tone: 'var(--risk-elevated)',
                to: '/actions?status=OVERDUE',
                icon: 'wrench' as const,
              },
              {
                key: 'open',
                label: 'Open violations',
                value: kpi?.open_violations,
                sub: `${kpi?.unassigned_violations ?? 0} unassigned`,
                tone: 'var(--risk-moderate)',
                to: '/violations?status=OPEN_ANY',
                icon: 'clipboard' as const,
              },
            ].map((tile) => (
              <button
                key={tile.key}
                onClick={() => navigate(tile.to)}
                className="group panel relative flex min-h-[112px] flex-col justify-between overflow-hidden p-3 text-left transition-all hover:border-line-strong hover:shadow-panel"
              >
                <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: tile.tone }} />
                <div className="flex items-start justify-between">
                  <span className="label">{tile.label}</span>
                  <Icon name={tile.icon} className="h-3.5 w-3.5 text-ink-faint transition-colors group-hover:text-ink" />
                </div>
                <div>
                  <div className="kpi-value animate-count-flash" style={{ color: tile.tone }}>
                    {tile.value === undefined ? '—' : String(tile.value).padStart(2, '0')}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-faint">
                    {tile.sub}
                    <Icon name="arrowRight" className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>
              </button>
            ))}

            <Panel className="col-span-2" title="Mine risk position" subtitle="Exposure-weighted site scores — a critical zone lifts the whole site" right={<Button size="sm" variant="ghost" onClick={() => navigate('/mines')}>All mines</Button>}>
              {!dash ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {dash.mine_cards.map((m) => {
                    const tone = bandFor(m.risk_score).tone
                    return (
                      <button
                        key={m.id}
                        onClick={() => navigate(`/mines/${m.id}`)}
                        className="grid w-full grid-cols-[minmax(0,1.6fr)_minmax(0,2fr)_auto] items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-raised"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium">{m.name}</span>
                          <span className="block truncate text-[10px] text-ink-faint">
                            {m.open_violations} open · {m.overdue_actions} overdue{m.critical_zones ? ` · ${m.critical_zones} critical zone` : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-[7px] flex-1 overflow-hidden rounded-sm bg-sunken">
                            <span className="block h-full rounded-sm transition-[width] duration-700" style={{ width: `${m.risk_score}%`, background: `var(--risk-${tone})` }} />
                          </span>
                          <span className="w-8 text-right font-mono text-[11.5px]" style={{ color: `var(--risk-${tone})` }}>
                            {m.risk_score.toFixed(0)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Sparkline values={(dash.risk_trend && []) as number[]} />
                          <span className={cx('font-mono text-[10.5px]', m.trend > 0 ? 'text-[color:var(--risk-high)]' : 'text-[color:var(--risk-low)]')}>{signed(m.trend, 0)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>

        {/* ------------------------------------------------ main split row */}
        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <Panel
            title="AI priority alerts"
            subtitle="Ranked by severity, trend velocity and unresolved exposure — each one is actionable, not informational"
            right={
              <>
                {dash && <Badge tone="critical">{dash.priority_alerts.length} surfaced</Badge>}
                <Button size="sm" variant="ghost" onClick={() => navigate('/early-warning')}>
                  Full register
                </Button>
              </>
            }
          >
            {!dash ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : dash.priority_alerts.length === 0 ? (
              <EmptyState icon="check" title="No emerging risks detected" body="Every zone is inside tolerance: no trend acceleration, no overdue cluster, no cadence breach. The engine re-evaluates after every record change." />
            ) : (
              <ul className="space-y-2.5">
                {dash.priority_alerts.map((a, idx) => (
                  <AlertCard key={a.id} alert={a} rank={idx + 1} expanded={openAlert === a.id} onToggle={() => setOpenAlert(openAlert === a.id ? null : a.id)} onInvestigate={() => setInspectZone(a.scope_type === 'ZONE' ? a.scope_id : null)} onZoneRisk={() => setInspectZone(a.scope_id)} />
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-3.5">
            <InsightsPanel insights={dash?.insights ?? null} loading={loading} onNavigate={navigate} />

            <Panel
              title="Overdue corrective actions"
              subtitle="The fastest available risk reduction"
              right={
                <Button size="sm" variant="ghost" onClick={() => navigate('/actions?status=OVERDUE')}>
                  Manage
                </Button>
              }
            >
              {!dash ? (
                <Skeleton className="h-32 w-full" />
              ) : dash.overdue_actions.length === 0 ? (
                <EmptyState icon="check" title="Nothing overdue" body="Every committed corrective action is inside its due date." className="py-6" />
              ) : (
                <ul className="space-y-1.5">
                  {dash.overdue_actions.map((a) => (
                    <li key={a.id} className="rounded border border-line bg-sunken p-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10.5px] text-ink-faint">{a.id}</span>
                        <Badge tone="high">{a.days_overdue}d overdue</Badge>
                        <span className="ml-auto text-[10.5px] text-ink-faint">{a.owner}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-dim">{a.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Activity stream" subtitle="Every write to the compliance record, newest first" right={<IconButton label="Refresh" onClick={reload}><Icon name="refresh" className="h-3 w-3" /></IconButton>}>
              {!dash ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ol className="space-y-1.5">
                  {dash.activity.slice(0, 7).map((ev) => (
                    <li key={ev.id} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: eventColor(ev.kind) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-ink-dim">{ev.message}</span>
                        <span className="text-[10px] text-ink-faint">
                          {ev.actor} · {relative(ev.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        </div>

        {/* ------------------------------------------- enterprise heat board */}
        <Panel
          title="Zone risk board"
          subtitle="Ranked by engine score. Click any zone to open its dossier — explanation, queue and trend in one place."
          right={
            <>
              <span className="hidden text-[10.5px] text-ink-faint sm:inline">{dash?.zone_heat.length ?? 0} zones scored</span>
              <Button size="sm" variant="ghost" onClick={() => navigate('/risk')}>
                Risk intelligence
              </Button>
            </>
          }
          dense
        >
          {!dash ? (
            <div className="space-y-1.5 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['Zone', 'Mine', 'Band', 'Risk', '30d', 'Open', 'Overdue', 'Dominant factor', 'Compliance', ''].map((h) => (
                      <th key={h} className="label px-3 py-2 font-semibold first:pl-4">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--line)]">
                  {dash.zone_heat.map((z) => {
                    const tone = z.tone ?? bandFor(z.risk_score).tone
                    return (
                      <tr key={z.id} className="row-hover cursor-pointer" onClick={() => setInspectZone(z.id)}>
                        <td className="px-3 py-2 pl-4">
                          <div className="flex items-center gap-2">
                            <span className="h-6 w-[3px] rounded-sm" style={{ background: `var(--risk-${tone})` }} />
                            <span>
                              <span className="block font-medium leading-tight">{z.short_name}</span>
                              <span className="block text-[10px] text-ink-faint">{z.name.split('— ')[1] ?? z.zone_type.replace(/_/g, ' ')}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-ink-dim">{(boot?.mines.find((m) => m.id === z.mine_id) ?? {}).code}</td>
                        <td className="px-3 py-2">
                          <RiskBadge score={z.risk_score} size="sm" />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-[13px] font-semibold" style={{ color: `var(--risk-${tone})` }}>
                            {z.risk_score.toFixed(0)}
                          </span>
                        </td>
                        <td className={cx('px-3 py-2 font-mono text-[11px]', z.trend > 0 ? 'text-[color:var(--risk-high)]' : z.trend < 0 ? 'text-[color:var(--risk-low)]' : 'text-ink-faint')}>
                          {signed(z.trend, 0)}
                        </td>
                        <td className="px-3 py-2 font-mono">{z.open_violations}</td>
                        <td className={cx('px-3 py-2 font-mono', z.overdue_actions ? 'text-[color:var(--risk-elevated)]' : 'text-ink-faint')}>{z.overdue_actions}</td>
                        <td className="px-3 py-2 text-ink-dim">
                          <span className="text-[11px]">{z.top_factor}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <Progress value={z.compliance_score} max={100} tone={`var(--risk-${bandFor(100 - z.compliance_score).tone})`} className="w-14" height={4} />
                            <span className="font-mono text-[11px] text-ink-dim">{z.compliance_score.toFixed(0)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 pr-4 text-right">
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-[color:var(--accent)]">
                            Investigate <Icon name="arrowRight" className="h-3 w-3" />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="grid gap-3.5 lg:grid-cols-2">
          <Panel title="Department exposure" subtitle="Unresolved severity weight by function, with 30-day velocity">
            {!dash ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-2.5">
                {dash.department_health.map((d) => {
                  const tone = d.trend_pct > 8 ? 'high' : d.trend_pct > 0 ? 'elevated' : 'low'
                  return (
                    <button key={d.department} onClick={() => navigate(`/violations?department=${d.department}&status=OPEN_ANY`)} className="block w-full text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-[12px] font-medium">
                          {humanize(d.department)}
                          <Badge tone={tone}>{d.open} open</Badge>
                        </span>
                        <span className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-ink-faint">{d.high_or_critical} high/crit</span>
                          <span style={{ color: `var(--risk-${tone})` }}>{pct(d.trend_pct, 0)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-[6px] w-full overflow-hidden rounded-sm bg-sunken">
                        <div className="h-full rounded-sm" style={{ width: `${Math.min(100, (d.exposure / Math.max(1, Math.max(...dash.department_health.map((x) => x.exposure)))) * 100)}%`, background: `var(--risk-${tone})` }} />
                      </div>
                    </button>
                  )
                })}
                <p className="pt-1 text-[10.5px] leading-snug text-ink-faint">
                  Exposure is the summed severity weight of open findings (LOW 10 · MEDIUM 25 · HIGH 50 · CRITICAL 80) — the same weights the
                  risk engine uses, so the ranking and the scores cannot disagree.
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Enterprise risk trend" subtitle="Mean of site scores, replayed through the engine">
            {dash?.risk_trend.series?.length ? (
              <TrendChart series={dash.risk_trend.series} height={168} label="Enterprise risk" secondaryLabel="Compliance" />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </Panel>
        </div>
      </PageBody>

      <ZoneDrawer zoneId={inspectZone} onClose={() => setInspectZone(null)} />
      <DemoTray />
    </>
  )
}

function eventColor(kind: string) {
  const map: Record<string, string> = {
    VIOLATION: 'var(--risk-high)',
    INSPECTION: 'var(--accent)',
    ACTION_CREATED: 'var(--risk-elevated)',
    ACTION_UPDATE: 'var(--risk-moderate)',
    WORKFLOW: 'var(--risk-low)',
    EVIDENCE: 'var(--info)',
    OVERRIDE: 'var(--risk-critical)',
    DOCUMENT: 'var(--text-faint)',
    ASSIGN: 'var(--accent)',
  }
  return map[kind] ?? 'var(--line-strong)'
}

function ScopeChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx('rounded px-2 py-1 text-[11px] font-medium transition-colors', active ? 'bg-panel text-ink shadow-panel' : 'text-ink-dim hover:text-ink')}
    >
      {children}
    </button>
  )
}

/**
 * The alert card. This is the product's core interaction: the number, the
 * evidence for it, and the next action in one object, with a button that opens
 * the explanation rather than another chart.
 */
export function AlertCard({
  alert,
  rank,
  expanded,
  onToggle,
  onInvestigate,
  onZoneRisk,
}: {
  alert: Alert
  rank?: number
  expanded: boolean
  onToggle: () => void
  onInvestigate: () => void
  onZoneRisk?: () => void
}) {
  const tone = alert.severity === 'CRITICAL' ? 'critical' : alert.severity === 'HIGH' ? 'high' : alert.severity === 'MEDIUM' ? 'elevated' : 'moderate'
  const up = (alert.delta ?? 0) > 0
  return (
    <li className="group relative overflow-hidden rounded-md border bg-panel transition-colors hover:border-line-strong" style={{ borderColor: `color-mix(in srgb, var(--risk-${tone}) 40%, var(--line))` }}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `var(--risk-${tone})` }} />
      <div className="p-3 pl-4">
        <div className="flex flex-wrap items-center gap-2">
          {rank !== undefined && <span className="font-mono text-[10px] text-ink-faint">#{rank}</span>}
          <Badge tone={tone} dot>
            {alert.severity}
          </Badge>
          <span className="text-[10.5px] font-semibold uppercase tracking-wide2 text-ink-dim">{alert.scope_name}</span>
          <span className="text-[10.5px] text-ink-faint">· {alert.mine_name}</span>
          <span className="ml-auto flex items-center gap-2">
            {alert.previous_score !== undefined && (
              <span className="font-mono text-[11px] text-ink-dim" title="Risk score movement that triggered detection">
                {alert.previous_score.toFixed(0)} → <span style={{ color: `var(--risk-${tone})` }}>{alert.risk_score.toFixed(0)}</span>
                <span className={cx('ml-1', up ? 'text-[color:var(--risk-high)]' : 'text-[color:var(--risk-low)]')}>{signed(alert.delta ?? 0, 0)}</span>
              </span>
            )}
            <span className="font-mono text-[10px] text-ink-faint">{humanize(alert.kind)}</span>
          </span>
        </div>

        <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug">{alert.title}</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">{alert.narrative}</p>

        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {alert.reasons.map((r, i) => (
            <li key={i} className="flex items-center gap-2 rounded border border-line bg-sunken px-2 py-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `var(--risk-${tone})` }} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{r.label}</span>
              <span className="font-mono text-[11px] text-ink">{r.value}</span>
              {r.delta && <span className="font-mono text-[10px] text-[color:var(--risk-high)]">{r.delta}</span>}
            </li>
          ))}
        </ul>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={onInvestigate} icon={<Icon name="search" className="h-3 w-3" />}>
            Investigate
          </Button>
          <Button size="sm" variant="outline" onClick={onToggle}>
            {expanded ? 'Hide analysis' : 'Show why'}
          </Button>
          {alert.projected_impact && (
            <span className="rounded border border-[color:var(--ok)]/40 bg-[color:var(--ok)]/8 px-1.5 py-0.5 text-[10.5px] text-[color:var(--ok)]" title="Re-scored with the live engine against the hypothetical closed state">
              {alert.projected_impact.action} → {alert.projected_impact.after.toFixed(0)} ({signed(alert.projected_impact.delta, 1)})
            </span>
          )}
          <span className="ml-auto text-[10px] text-ink-faint">detected {relative(alert.created_at)}</span>
        </div>

        {expanded && (
          <div className="mt-2.5 animate-fade-up space-y-2.5 border-t border-line pt-2.5">
            <div className="rounded border border-line bg-sunken p-2.5">
              <div className="label mb-1.5">Recommended action</div>
              <p className="flex items-start gap-1.5 text-[12px] leading-snug text-ink">
                <Icon name="target" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
                {alert.recommendation}
              </p>
            </div>
            {alert.entity_ids && alert.entity_ids.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="label">Evidence</span>
                {alert.entity_ids.slice(0, 6).map((id) => (
                  <button key={id} onClick={() => onZoneRisk?.()} className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-dim hover:border-line-strong hover:text-ink">
                    {id}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function InsightsPanel({ insights, loading, onNavigate }: { insights: Insight[] | null; loading: boolean; onNavigate: (to: string) => void }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="brain" className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          MINEGUARD AI insights
        </span>
      }
      subtitle="Generated from the live record set on every recompute — never authored text"
      right={<Badge tone="neutral">{insights?.length ?? 0}</Badge>}
    >
      {loading && !insights ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !insights?.length ? (
        <EmptyState title="No insights available" body="Insights require at least one scored zone with activity in the window." className="py-6" />
      ) : (
        <ul className="space-y-2">
          {insights.slice(0, 5).map((i) => (
            <li key={i.id} className="rounded border border-line bg-sunken p-2.5">
              <div className="flex items-start gap-2">
                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i.priority >= 90 ? 'var(--risk-critical)' : i.priority >= 70 ? 'var(--risk-elevated)' : 'var(--accent)' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold leading-snug">{i.title}</p>
                  <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">{i.body}</p>
                  <button onClick={() => onNavigate(i.action.to)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] hover:underline">
                    {i.action.label}
                    <Icon name="arrowRight" className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
