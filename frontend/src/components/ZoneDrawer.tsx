import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, endpoints } from '../lib/api'
import { useAsync, useApp } from '../state/app'
import type { ZoneDossier } from '../lib/types'
import { Badge, Button, Drawer, EmptyState, ErrorState, Icon, Panel, Progress, Skeleton, Table, cx } from './ui'
import { BarRowChart, Sparkline } from './charts'
import { CompliancePanel, ExplanationPanel, MiniStat, RecommendationList, RiskHeader, RiskTrendBadge } from './risk'
import { bandFor, fmt, fmtDate, humanize, relative, signed } from '../lib/format'

/**
 * Zone dossier — the "investigate" surface.
 *
 * One drawer used by the command centre, the map, alerts and the violations
 * table, so the explanation of a risk score looks identical wherever it is
 * opened from.
 */
export function ZoneDrawer({ zoneId, onClose }: { zoneId: string | null; onClose: () => void }) {
  // The dossier endpoint returns the zone flattened at the top level, with `mine`
  // and `risk` nested — so `zone` is derived here rather than assumed from a shape
  // the server never sends.
  const { data: raw, loading, error, reload } = useAsync<any>(zoneId ? endpoints.zone(zoneId) : null, [zoneId])
  const data = useMemo<ZoneDossier | null>(() => (raw ? ({ ...raw, zone: { ...raw } } as unknown) as ZoneDossier : null), [raw])
  const navigate = useNavigate()
  const { pushToast, invalidate, actor } = useApp()
  const [resolving, setResolving] = useState(false)
  const [tab, setTab] = useState<'risk' | 'violations' | 'actions' | 'inspections'>('risk')

  const close = () => {
    onClose()
    setTab('risk')
  }

  const resolveAllOverdue = async () => {
    if (!data) return
    const ids = data.overdue_actions.map((a) => a.id)
    setResolving(true)
    try {
      for (const id of ids) {
        await api.patch(`/api/corrective-actions/${id}`, {
          status: 'SUBMITTED',
          resolution_notes: 'Batch rectification verified on the plant during the escalated round; register updated.',
        })
      }
      pushToast({ kind: 'success', title: `${ids.length} overdue action(s) submitted for verification` })
      invalidate()
      reload()
    } catch (e) {
      pushToast({ kind: 'error', title: 'Could not submit', body: (e as Error).message })
    } finally {
      setResolving(false)
    }
  }

  return (
    <Drawer
      open={!!zoneId}
      onClose={close}
      title={data ? `${data.zone.name}` : 'Loading zone…'}
      subtitle={data ? `${data.mine.name} · ${data.zone.zone_type.replace(/_/g, ' ')} · cadence ${data.zone.inspection_cadence_days}d` : undefined}
      footer={
        data && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Icon name="clipboard" className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/inspections?zone=${data.zone.id}&new=1`)}
            >
              Record inspection
            </Button>
            <Button size="sm" onClick={() => navigate(`/violations?zone=${data.zone.id}&status=OPEN_ANY`)}>
              Open in violation centre
            </Button>
            {data.overdue_actions.length > 0 && (
              <Button size="sm" variant="subtle" loading={resolving} onClick={resolveAllOverdue} title="Demonstrates the resolution loop: submits each overdue action for verification and re-scores the zone">
                Submit {data.overdue_actions.length} overdue action(s)
              </Button>
            )}
            <span className="ml-auto text-[10.5px] text-ink-faint">
              {data.risk.method}
            </span>
          </div>
        )
      }
    >
      {loading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="space-y-3.5">
          <div className="rounded-md border p-3" style={{ borderColor: `color-mix(in srgb, var(--risk-${data.risk.tone}) 45%, var(--line))`, background: `color-mix(in srgb, var(--risk-${data.risk.tone}) 7%, var(--bg-panel))` }}>
            <RiskHeader risk={data.risk} size={84} />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
              <RiskTrendBadge trend={data.trend} />
              <span className="text-[11px] text-ink-faint">
                compliance <span className="font-mono text-ink-dim">{data.compliance.compliance_score.toFixed(0)}</span>/100
              </span>
              {data.closure_relief && (
                <Badge tone="low" title="Counterfactual re-score with the overdue actions closed">
                  clearing {data.overdue_actions.length} overdue → {data.closure_relief.after.risk_score.toFixed(0)} ({signed(data.closure_relief.delta, 1)})
                </Badge>
              )}
            </div>
          </div>

          <div className="flex gap-0.5 rounded border border-line bg-sunken p-0.5">
            {(
              [
                ['risk', 'Explanation', data.risk.drivers.length],
                ['violations', 'Violations', data.violations.length],
                ['actions', 'Actions', data.actions.length],
                ['inspections', 'Rounds', data.inspections.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key as any)}
                className={cx('flex-1 rounded px-2 py-1 text-[11.5px] font-medium transition-colors', tab === key ? 'bg-panel text-ink shadow-panel' : 'text-ink-dim hover:text-ink')}
              >
                {label} <span className="font-mono text-[10px] text-ink-faint">{count}</span>
              </button>
            ))}
          </div>

          {tab === 'risk' && (
            <div className="space-y-3.5">
              {data.alerts.length > 0 && (
                <Panel title="Active early warnings" subtitle="Detected from trend, recurrence and delay — not from the current score alone">
                  <div className="space-y-2">
                    {data.alerts.map((a) => (
                      <div key={a.id} className="rounded border border-line bg-sunken p-2.5">
                        <div className="flex items-center gap-2">
                          <Badge tone={a.severity === 'CRITICAL' ? 'critical' : a.severity === 'HIGH' ? 'high' : 'elevated'} dot>
                            {a.severity}
                          </Badge>
                          <span className="text-[12px] font-semibold">{a.title}</span>
                          <span className="ml-auto font-mono text-[10px] text-ink-faint">{humanize(a.kind)}</span>
                        </div>
                        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-dim">{a.narrative}</p>
                        <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                          {a.reasons.map((r, i) => (
                            <li key={i} className="flex items-baseline justify-between gap-2 rounded bg-panel px-1.5 py-1 text-[11px]">
                              <span className="text-ink-faint">{r.label}</span>
                              <span className="font-mono text-ink">{r.value}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-[color:var(--accent)]">
                          <Icon name="arrowRight" className="mt-0.5 h-3 w-3 shrink-0" /> {a.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
              <ExplanationPanel risk={data.risk} title="Engine explanation" />
              <RecommendationList
                items={data.risk.recommended_actions}
                header="What management should do"
                footer={
                  <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
                    Recommendations are generated from the factors that produced the score — when the factors change, this list changes.
                  </p>
                }
              />
              <CompliancePanel compliance={data.compliance} riskScore={data.risk.risk_score} />
              <Panel title="Risk trend" subtitle="90 days replayed through the engine">
                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="kpi-value">{data.risk.risk_score.toFixed(1)}</div>
                      <div className="label">current zone score · 30-day change {signed(data.trend.change, 1)}</div>
                    </div>
                    <Sparkline values={data.trend.series.map((s) => s.risk)} tone={`var(--risk-${bandFor(data.risk.risk_score).tone})`} width={180} height={44} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniStat label="Peak 30d" value={fmt(Math.max(...data.trend.series.map((s) => s.risk), 0), 0)} />
                    <MiniStat label="Low 30d" value={fmt(Math.min(...data.trend.series.map((s) => s.risk), 0), 0)} />
                    <MiniStat label="Open findings" value={fmt(data.risk.metrics.open_violations)} />
                    <MiniStat label="Aged >30d" value={fmt(data.risk.metrics.unresolved_30_plus)} tone={data.risk.metrics.unresolved_30_plus ? 'var(--risk-high)' : undefined} />
                  </div>
                </div>
              </Panel>
              {data.zone.notes && (
                <div className="rounded border border-line bg-sunken p-2.5 text-[11.5px] leading-snug text-ink-dim">
                  <span className="label mr-2">Zone context</span>
                  {data.zone.notes}
                </div>
              )}
            </div>
          )}

          {tab === 'violations' && (
            <Panel title="Violations in this zone" subtitle="All records, newest first; recurrence depth is derived from this list" dense>
              {data.violations.length === 0 ? (
                <EmptyState title="No violations recorded" body="Nothing is open and no history exists for this zone in the current window." className="py-8" />
              ) : (
                <div className="divide-y divide-[color:var(--line)]">
                  {data.violations.map((v) => {
                    const tone = bandFor(v.risk_contribution * 2).tone
                    return (
                      <button
                        key={v.id}
                        onClick={() => navigate(`/violations?search=${v.id}`)}
                        className="block w-full px-4 py-2 text-left transition-colors hover:bg-raised"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-ink-faint">{v.id}</span>
                          <Badge tone={v.severity === 'CRITICAL' ? 'critical' : v.severity === 'HIGH' ? 'high' : v.severity === 'MEDIUM' ? 'elevated' : 'low'}>{v.severity}</Badge>
                          <span className="text-[12px] font-medium">{v.category}</span>
                          {v.occurrences > 1 && (
                            <Badge tone="elevated" title={`Occurrence ${v.occurrences} of this category in this zone`}>
                              {v.occurrences}× repeat
                            </Badge>
                          )}
                          <span className="ml-auto font-mono text-[11px]" style={{ color: v.status === 'CLOSED' ? 'var(--risk-low)' : `var(--risk-${tone})` }}>
                            {v.risk_contribution.toFixed(1)} pt
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-dim">{v.description}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
                          <span>{humanize(v.status)}</span>
                          <span>opened {relative(v.created_at)}</span>
                          <span>{v.department}</span>
                          {v.owner_name && <span>owner {v.owner_name}</span>}
                          {v.overdue && <span className="text-[color:var(--danger)]">overdue {v.days_overdue}d</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </Panel>
          )}

          {tab === 'actions' && (
            <Panel title="Corrective actions" subtitle="Owner, deadline and overdue exposure for this zone" dense>
              {data.actions.length === 0 ? (
                <EmptyState title="No corrective actions yet" body="Assign an owner to an open violation to open the first action." className="py-8" />
              ) : (
                <div className="divide-y divide-[color:var(--line)]">
                  {data.actions.map((a) => (
                    <div key={a.id} className={cx('px-4 py-2', a.overdue && 'bg-[color:var(--danger)]/5')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-faint">{a.id}</span>
                        <Badge tone={a.status === 'CLOSED' || a.status === 'VERIFIED' ? 'low' : a.overdue ? 'high' : 'moderate'}>{humanize(a.status)}</Badge>
                        <span className="text-[12px]">{a.description}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10.5px] text-ink-faint">
                          {a.owner_name ?? '—'} · due {fmtDate(a.due_date)}
                        </span>
                        {a.overdue && <Badge tone="high">overdue</Badge>}
                        <Progress className="ml-auto max-w-[120px]" value={a.status === 'CLOSED' ? 100 : a.status === 'SUBMITTED' ? 80 : a.status === 'IN_PROGRESS' ? 45 : 15} tone={a.overdue ? 'var(--risk-high)' : 'var(--accent)'} height={4} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {tab === 'inspections' && (
            <Panel title="Recent inspection rounds" subtitle={`Cadence ${data.zone.inspection_cadence_days} days · last visit ${data.risk.metrics.days_since_inspection ?? '—'} days ago`} dense>
              {data.inspections.length === 0 ? (
                <EmptyState title="No inspections on record" body="This is itself a risk factor — the engine penalises unverified zones." className="py-8" />
              ) : (
                <div className="divide-y divide-[color:var(--line)]">
                  {data.inspections.map((i) => (
                    <div key={i.id} className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-faint">{i.id}</span>
                        <span className="text-[12px]">{fmtDate(i.inspection_date)}</span>
                        <Badge tone={i.overall_rating === 'COMPLIANT' ? 'low' : i.overall_rating === 'NON_COMPLIANT' ? 'high' : 'elevated'}>{humanize(i.overall_rating)}</Badge>
                        <span className="text-[11px] text-ink-faint">{i.inspector}</span>
                        <span className="ml-auto text-[11px] text-ink-dim">
                          {i.issues_found} finding{i.issues_found === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-dim">{i.observations}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>
      )}
    </Drawer>
  )
}
