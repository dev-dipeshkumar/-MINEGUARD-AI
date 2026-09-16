import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, Divider, EmptyState, ErrorState, Field, Icon, Input, Panel, Progress, SegmentedControl, Select, Skeleton, Switch, Tooltip, cx } from '../components/ui'
import { BarRowChart, Donut, FactorBars, ScoreRing, TrendChart } from '../components/charts'
import { ExplanationPanel, MiniStat, RecommendationList, RiskBadge } from '../components/risk'
import { ZoneDrawer } from '../components/ZoneDrawer'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import type { SimulationResult } from '../lib/types'
import { bandFor, fmt, fmtDate, humanize, relative, signed } from '../lib/format'

/**
 * Modules 3 + 8 — the risk engine surface and compliance intelligence.
 *
 * Two rules are enforced in this file beyond the others: nothing here computes a
 * score (every number is fetched), and every number carries the reasoning that
 * produced it. The what-if lab calls the same engine endpoint the write API uses,
 * so a projection is a real re-score against a hypothetical state, not a guess.
 */
export function RiskIntelligencePage() {
  const { boot, revision } = useApp()
  const navigate = useNavigate()
  useDocumentTitle('Risk intelligence · MINEGUARD AI')
  const [zoneId, setZoneId] = useState<string>(boot?.zones[0]?.id ?? '')
  const [drawer, setDrawer] = useState<string | null>(null)
  const [days, setDays] = useState<'30' | '60' | '90'>('30')
  const zones = boot?.zones ?? []
  const zone = zones.find((z) => z.id === zoneId)
  const { data: risk, loading } = useAsync<any>(zoneId ? endpoints.zoneRisk(zoneId) : null, [zoneId, revision])
  const { data: analytics, error: analyticsError, reload: reloadAnalytics, loading: analyticsLoading } = useAsync<any>(`${endpoints.analytics(`days=${days}&zone_id=${zoneId}`)}`, [days, revision])
  const { data: insights } = useAsync<{ insights: any[]; note: string }>(endpoints.insights, [revision])
  const enterprise = boot?.enterprise

  const engine = boot?.engine

  useEffect(() => {
    if (!zoneId && zones.length) setZoneId(zones[0].id)
  }, [zones, zoneId])

  return (
    <>
      <PageHeader
        eyebrow="Module 3 & 8 · Risk engine"
        title="Risk intelligence"
        subtitle="How the 0–100 score is produced, what is driving any given zone right now, and what the score would become under a different set of facts."
        actions={
          <>
            <Badge tone="neutral" title={engine?.phase}>
              <span className="flex items-center gap-1.5">
                <Icon name="brain" className="h-3 w-3" /> {engine?.mode === 'rule-based' ? 'Rule-based engine' : 'Model engine'}
              </span>
            </Badge>
            <Button size="sm" onClick={() => navigate('/early-warning')}>
              Early warnings
            </Button>
          </>
        }
      />

      <PageBody className="space-y-3.5">
        {/* ------------------------------------------------ enterprise frame */}
        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <Panel title="Model in force" subtitle="Read directly from the running service — not a screenshot of documentation">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <Badge tone="neutral">{engine?.label}</Badge>
              <Badge tone="accent">{engine?.phase}</Badge>
              <Tooltip tip="A linear model over five evidence-derived factors, each capped so no single dimension can dominate, clamped to 0–100. Deterministic: same records, same score, every time.">
                <span className="flex items-center gap-1 text-ink-faint">
                  <Icon name="info" className="h-3 w-3" /> method
                </span>
              </Tooltip>
            </div>
            <ul className="divide-y divide-[color:var(--line)]">
              {(engine?.factors ?? []).map((f) => (
                <li key={f.key} className="flex items-center gap-3 py-1.5">
                  <span className="w-[188px] shrink-0">
                    <span className="block text-[12px] font-medium">{f.label}</span>
                    <span className="block font-mono text-[10px] text-ink-faint">
                      {f.coefficient === null ? 'step function on cadence' : `raw × ${f.coefficient}`}
                    </span>
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-sunken">
                    <span className="block h-full bg-[color:var(--accent)]" style={{ width: `${(f.weight_cap / 45) * 100}%` }} />
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-[11px] text-ink-dim">cap {fmt(f.weight_cap, 0)}</span>
                </li>
              ))}
            </ul>
            <Divider className="my-2.5" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(engine?.severity_weights ?? {}).map(([k, v]) => (
                <div key={k} className="rounded border border-line bg-sunken px-2 py-1.5">
                  <div className="label">{k}</div>
                  <div className="font-mono text-[13px] font-semibold" style={{ color: `var(--risk-${bandFor((v as number) * 1.2).tone})` }}>
                    +{v}
                  </div>
                  <div className="text-[9.5px] text-ink-faint">exposure per record</div>
                </div>
              ))}
              <div className="rounded border border-line bg-sunken px-2 py-1.5">
                <div className="label">Repeat uplift</div>
                <div className="font-mono text-[13px] font-semibold">+10 / +20 / +35</div>
                <div className="text-[9.5px] text-ink-faint">1st · 2nd · 3rd occurrence</div>
              </div>
            </div>
            <div className="mt-2.5">
              <div className="label mb-1">Bands — and where the two enterprise figures sit</div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
                {(engine?.bands ?? []).map((b, i) => {
                  const min = i === 0 ? 0 : (engine?.bands ?? [])[i - 1].max + 1
                  const has = (v: number | undefined) => v !== undefined && v >= min && v <= b.max
                  return (
                    <div key={b.label} className="rounded border px-1.5 py-1 text-center" style={{ borderColor: has(enterprise?.risk_score) || has(enterprise?.compliance_score) ? `var(--risk-${b.tone})` : 'var(--line)' }}>
                      <div className="text-[9.5px] font-semibold uppercase tracking-wide2" style={{ color: `var(--risk-${b.tone})` }}>
                        {b.label}
                      </div>
                      <div className="font-mono text-[9.5px] text-ink-faint">
                        {min}–{b.max}
                      </div>
                      <div className="mt-0.5 flex items-center justify-center gap-1">
                        {has(enterprise?.risk_score) && <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" title="enterprise risk score lands in this band" />}
                        {has(enterprise?.compliance_score) && <span className="h-1.5 w-1.5 rounded-full border border-[color:var(--accent)]" title="enterprise compliance score lands in this band" />}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[9.5px] text-ink-faint">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" /> risk {fmt(enterprise?.risk_score, 1)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full border border-[color:var(--accent)]" /> compliance {fmt(enterprise?.compliance_score, 1)}
                </span>
                <span>— two different questions, deliberately not one number mirrored.</span>
              </p>
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
              Ageing windows: 0–7d, 8–15d, 16–30d, 30d+ for unresolved findings; overdue actions accrue per day past the committed date; inspection delay starts at the statutory cadence for that zone
              {slaTarget(boot) && <>; SLA to resolve is {slaTarget(boot)!.CRITICAL}d for CRITICAL, {slaTarget(boot)!.HIGH}d for HIGH</>}.
            </p>
          </Panel>

          <Panel
            title="Enterprise position"
            subtitle="The same engine, run over every zone and exposure-weighted — never an average of averages"
            right={<RiskBadge score={enterprise?.risk_score ?? 0} />}
          >
            <div className="flex flex-wrap items-center gap-4">
              <ScoreRing score={enterprise?.risk_score ?? 0} size={96} tone={`var(--risk-${enterprise?.tone ?? 'elevated'})`} label="RISK" pulse={enterprise?.tone === 'critical'} />
              <div className="min-w-[210px] flex-1">
                <MiniStat label="Compliance score" value={`${fmt(enterprise?.compliance_score, 1)} / 100`} sub="process discipline — closure, evidence, cadence. Deliberately not the inverse of risk." tone={`var(--risk-${bandFor(100 - (enterprise?.compliance_score ?? 0)).tone})`} />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniStat label="Zones at HIGH+" value={fmt((zones ?? []).filter((z) => ['HIGH', 'CRITICAL'].includes(z.risk_level)).length)} sub={`of ${zones.length} monitored`} tone="var(--risk-high)" />
                  <MiniStat label="Open findings" value={fmt(analytics?.totals?.open)} sub={`${analytics?.totals?.critical ?? 0} critical, ${analytics?.totals?.aged_30 ?? 0} over 30d`} />
                  <MiniStat label="Overdue actions" value={fmt(analytics?.overdue?.total)} sub="blocking closure" tone="var(--risk-elevated)" />
                  <MiniStat label="Repeat clusters" value={fmt((analytics?.recurring_issues ?? []).length)} sub="same category, same zone" />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <TrendChart series={enterpriseTrend(boot)} height={92} label="Highest-risk site" bands={false} />
              <p className="mt-1 text-[10px] text-ink-faint">
                Series shown is the portfolio's worst site, re-scored daily from the stored records; {fmt(enterpriseTrendDays(boot))} days available.
              </p>
            </div>
          </Panel>
        </div>

        {/* ------------------------------------------------------ zone explorer */}
        <Panel
          title="Zone decomposition"
          subtitle="Pick any zone: its score, the contribution of each factor, and the evidence rows behind them"
          right={
            <div className="flex items-center gap-1.5">
              <Select className="h-7 w-[150px] text-[11.5px]" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.mine_name.split(' ')[0]} · {z.short_name} ({z.risk_score.toFixed(0)})
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={() => setDrawer(zoneId)}>
                Full dossier
              </Button>
            </div>
          }
        >
          {loading && !risk ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : !risk ? (
            <EmptyState icon="brain" title="No assessment available" body="Select a zone to see its factor decomposition." />
          ) : (
            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <div className="flex items-start gap-3">
                  <ScoreRing score={risk.risk_score} size={78} tone={`var(--risk-${risk.tone})`} pulse={risk.tone === 'critical'} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{risk.zone?.name ?? zone?.name}</div>
                    <div className="text-[11px] text-ink-faint">
                      {risk.zone?.mine_name ?? zone?.mine_name} · {humanize(risk.zone?.zone_type ?? '')} · as of {fmtDate(risk.as_of)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone={risk.tone as any} dot>
                        {risk.risk_level}
                      </Badge>
                      <Badge tone={risk.trend?.direction === 'rising' ? 'high' : 'low'}>
                        {signed(risk.trend?.change ?? 0, 1)} / 30d
                      </Badge>
                      <Badge tone="neutral">compliance {fmt(risk.compliance?.compliance_score, 1)}</Badge>
                      <Badge tone={risk.metrics?.inspection_overdue ? 'elevated' : 'neutral'}>
                        {risk.metrics?.days_since_inspection === null ? 'no inspection on record' : `inspected ${risk.metrics?.days_since_inspection}d ago`}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="label mb-1.5">Factor contribution</div>
                  <FactorBars factors={risk.factors} showRaw />
                </div>
                <div className="mt-3">
                  <div className="label mb-1">90-day history of this zone</div>
                  <TrendChart series={historySeries(risk.history)} height={104} label="Zone risk" bands={false} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="Open" value={fmt(risk.metrics?.open_violations)} sub={`${risk.metrics?.critical_violations ?? 0} critical`} />
                  <MiniStat label="Repeat" value={fmt(risk.metrics?.repeat_violations)} sub="violations" />
                  <MiniStat label="Overdue" value={fmt(risk.metrics?.overdue_action_count)} sub={`max ${fmt(risk.metrics?.max_overdue_days)}d`} tone={risk.metrics?.overdue_action_count ? 'var(--risk-high)' : undefined} />
                  <MiniStat label="Severity exposure" value={fmt(risk.metrics?.severity_exposure)} sub={`target ${fmt(risk.metrics?.target_exposure)}`} />
                </div>
              </div>
              <div className="space-y-3">
                <ExplanationPanel risk={risk} title="Why this score" />
                <RecommendationList items={risk.recommended_actions} header="Recommended actions" footer={<ZoneActionsFooter zoneId={zoneId} />} />
              </div>
            </div>
          )}
        </Panel>

        {/* --------------------------------------------------------- what-if */}
        <WhatIfLab zoneId={zoneId} risk={risk} />

        {/* -------------------------------------------------------- analytics */}
        <div className="grid gap-3.5 xl:grid-cols-3">
          <Panel
            title="Severity mix"
            subtitle={`${fmt(analytics?.totals?.total)} records in view · weighted by engine exposure`}
            right={
              <SegmentedControl
                size="sm"
                value={days}
                onChange={(v) => setDays(v as any)}
                options={[
                  { value: '30', label: '30d' },
                  { value: '60', label: '60d' },
                  { value: '90', label: '90d' },
                ]}
              />
            }
          >
            {analyticsLoading && !analytics ? (
              <Skeleton className="h-40 w-full" />
            ) : analyticsError ? (
              <ErrorState message={analyticsError} onRetry={reloadAnalytics} />
            ) : (
              <>
                <Donut
                  size={128}
                  segments={(analytics?.severity_mix ?? []).map((s: any) => ({ label: s.severity, value: s.count, color: `var(--risk-${bandFor(s.weight).tone === 'low' ? 'moderate' : s.severity === 'CRITICAL' ? 'critical' : s.severity === 'HIGH' ? 'high' : 'elevated'})` }))}
                  center={`${fmt(analytics?.totals?.open)} open`}
                />
                <ul className="mt-2 space-y-1 text-[11px]">
                  {(analytics?.status_funnel ?? []).map((f: any) => (
                    <li key={f.status} className="flex items-center gap-2">
                      <span className="w-[112px] shrink-0 text-ink-dim">{humanize(f.status)}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-sm bg-sunken">
                        <span className="block h-full bg-[color:var(--accent)]" style={{ width: `${(f.count / Math.max(1, analytics?.totals?.total ?? 1)) * 100}%` }} />
                      </span>
                      <span className="w-6 text-right font-mono">{f.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2 sm:grid-cols-3">
                  <MiniStat label="30d+ open" value={fmt(analytics?.totals?.aged_30)} sub="ageing weight" />
                  <MiniStat label="Unassigned" value={fmt(analytics?.totals?.unassigned)} sub="no owner" tone={analytics?.totals?.unassigned ? 'var(--risk-elevated)' : undefined} />
                  <MiniStat label="Critical" value={fmt(analytics?.totals?.critical)} sub="records" tone="var(--risk-critical)" />
                </div>
              </>
            )}
          </Panel>

          <Panel title="Recurring issues" subtitle="Same category, same zone — the pattern the repeat factor is paid for">
            {(analytics?.recurring_issues ?? []).length === 0 ? (
              <EmptyState icon="refresh" title="No repeat clusters in this window" body="Repeat risk appears when the same category is found again in the same zone." className="py-8" />
            ) : (
              <ul className="space-y-1.5">
                {(analytics?.recurring_issues ?? []).slice(0, 6).map((r: any) => (
                  <li key={`${r.zone_id}-${r.category}`} className="rounded border border-line bg-sunken p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] font-medium">{r.category}</span>
                      <Badge tone={r.trend === 'INCREASING' ? 'high' : 'moderate'}>{r.trend ? humanize(r.trend) : `${r.occurrences}×`}</Badge>
                      <span className="ml-auto text-[10px] text-ink-faint">
                        {r.zone} · {r.mine}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-snug text-ink-dim">
                      {r.occurrences} occurrences{r.prior_occurrences ? ` (+${r.prior_occurrences} before this window)` : ''}, {fmtDate(r.first)} → {fmtDate(r.last)} · severities {r.severities?.join(', ')}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(r.ids ?? []).slice(0, 4).map((id: string) => (
                        <span key={id} className="rounded border border-line bg-panel px-1 font-mono text-[9.5px] text-ink-faint">
                          {id}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Category concentration" subtitle="Where the findings actually are">
            <BarRowChart
              items={(analytics?.category_mix ?? []).slice(0, 8).map((c: any) => ({ label: c.category, value: c.count, tone: 'var(--accent)', sub: `${c.share}% of register` }))}
              unit=""
            />
            <Divider className="my-2" />
            <div className="label mb-1">Department velocity</div>
            <ul className="space-y-1.5">
              {(analytics?.departments ?? []).map((d: any) => (
                <li key={d.department} className="flex items-center gap-2 text-[11px]">
                  <span className="w-[86px] shrink-0 text-ink-dim">{humanize(d.department)}</span>
                  <span className="font-mono text-ink-faint">
                    {d.velocity?.previous ?? 0} → {d.velocity?.current ?? 0}
                  </span>
                  <span className={cx('font-mono', d.trend_pct > 0 ? 'text-[color:var(--risk-high)]' : 'text-[color:var(--risk-low)]')}>{signed(d.trend_pct, 0)}%</span>
                  <span className="ml-auto text-ink-faint">
                    {d.open} open · {d.high_or_critical} high+
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Panel title="Closure performance" subtitle="How fast findings are actually being resolved — the discipline the compliance score measures">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="Closed in 90d" value={fmt(analytics?.closure?.closed_90d)} sub="verified" />
              <MiniStat label="Median days" value={fmt(analytics?.closure?.median_days)} sub={`best ${fmt(analytics?.closure?.best_days)}, worst ${fmt(analytics?.closure?.worst_days)}`} tone="var(--risk-elevated)" />
              <MiniStat label="On-time rate" value={`${Math.round((analytics?.closure?.on_time_rate ?? 0) * 100)}%`} sub="inside SLA" tone={(analytics?.closure?.on_time_rate ?? 0) < 0.5 ? 'var(--risk-high)' : 'var(--risk-low)'} />
              <MiniStat label="Verification backlog" value={fmt((analytics?.overdue?.by_owner ?? []).reduce((a: number, o: any) => a + (o.awaiting ?? 0), 0))} sub="submitted, undecided" />
            </div>
            <Divider className="my-2.5" />
            <div className="label mb-1.5">Overdue load by owner</div>
            {(analytics?.overdue?.by_owner ?? []).length === 0 ? (
              <EmptyState icon="check" title="No overdue corrective actions" className="py-6" />
            ) : (
              <ul className="space-y-1.5">
                {(analytics?.overdue?.by_owner ?? []).map((o: any) => (
                  <li key={o.owner} className="flex items-center gap-2">
                    <span className="w-[104px] shrink-0 truncate text-[11px] text-ink-dim">{o.owner}</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-sunken">
                      <span className="block h-full bg-[color:var(--risk-high)]" style={{ width: `${Math.min(100, (o.count / Math.max(1, analytics?.overdue?.total ?? 1)) * 100)}%` }} />
                    </span>
                    <span className="shrink-0 font-mono text-[11px]">{o.count}</span>
                    <span className="w-[70px] shrink-0 text-right text-[10px] text-ink-faint">max {o.max_days}d</span>
                    <button className="shrink-0 text-[10px] text-[color:var(--accent)] hover:underline" onClick={() => navigate(`/actions?owner=${encodeURIComponent(o.id ?? '')}&status=OVERDUE`)}>
                      queue
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Cadence gaps" subtitle="Zones past their statutory inspection interval — this is what the delay factor is charging">
            {(analytics?.cadence ?? []).length === 0 ? (
              <EmptyState icon="check" title="Every zone is inside its cadence" className="py-6" />
            ) : (
              <ul className="space-y-1">
                {(analytics?.cadence ?? []).map((z: any) => (
                  <li key={z.zone_id} className="flex items-center gap-2 rounded border border-line bg-sunken px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11.5px]">
                      {z.zone} <span className="text-ink-faint">· {z.mine}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">
                      {z.days_since}/{z.cadence_days}d
                    </span>
                    <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--risk-elevated)' }}>
                      +{fmt(z.points, 1)}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-faint">{z.open_violations} open</span>
                    <button className="shrink-0 text-[10px] text-[color:var(--accent)] hover:underline" onClick={() => setZoneId(z.zone_id)}>
                      inspect
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Divider className="my-2.5" />
            <div className="label mb-1.5">Generated insights</div>
            {(insights?.insights ?? []).length === 0 ? (
              <EmptyState icon="brain" title="No insights generated" body="Insights are derived from the register on every recompute." className="py-4" />
            ) : (
              <ul className="space-y-1.5">
                {(insights?.insights ?? []).slice(0, 4).map((i: any) => (
                  <li key={i.id} className="rounded border border-line bg-sunken p-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{i.kind.replace(/_/g, ' ')}</Badge>
                      <span className="ml-auto font-mono text-[9.5px] text-ink-faint">{i.id}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] font-medium leading-snug">{i.title}</p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-ink-dim">{i.body}</p>
                    <button className="mt-1 text-[10.5px] text-[color:var(--accent)] hover:underline" onClick={() => navigate(i.action.to)}>
                      {i.action.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-ink-faint">{insights?.note}</p>
          </Panel>
        </div>
      </PageBody>

      <ZoneDrawer zoneId={drawer} onClose={() => setDrawer(null)} />
    </>
  )
}

function ZoneActionsFooter({ zoneId }: { zoneId: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" onClick={() => navigate(`/inspections?new=1&zone=${zoneId}`)}>
        Record inspection
      </Button>
      <Button size="sm" variant="ghost" onClick={() => navigate(`/violations?zone_id=${zoneId}`)}>
        Open register for zone
      </Button>
    </div>
  )
}

function slaTarget(boot: any): Record<string, number> | null {
  const sla = boot?.config?.sla?.resolution_days
  return sla && typeof sla === 'object' ? sla : null
}

function enterpriseTrend(boot: any) {
  // The portfolio trend line is the worst site's series — chosen by the data, not by us.
  const worst = [...(boot?.mines ?? [])].sort((a: any, b: any) => b.risk_score - a.risk_score)[0]
  return worst?.trend?.series ?? []
}

function enterpriseTrendDays(boot: any) {
  const worst = [...(boot?.mines ?? [])].sort((a: any, b: any) => b.risk_score - a.risk_score)[0]
  return worst?.trend?.series?.length ?? 0
}

function historySeries(history: any[]) {
  return (history ?? []).slice(-90).map((h) => ({ date: h.date, risk: h.risk_score, compliance: h.compliance_score }))
}

// ------------------------------------------------------------------ what-if
function WhatIfLab({ zoneId, risk }: { zoneId: string; risk: any }) {
  const navigate = useNavigate()
  const { boot, revision } = useApp()
  // The scenario options must come from the register itself, so the lab can only
  // propose things that are actually open in this zone right now.
  const { data: zoneViolations } = useAsync<any>(zoneId ? endpoints.violations(`zone_id=${zoneId}&status=OPEN_ANY&limit=20`) : null, [zoneId, revision])
  const { data: zoneActions } = useAsync<any>(zoneId ? endpoints.actions(`zone_id=${zoneId}&status=OVERDUE`) : null, [zoneId, revision])
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH')
  const [category, setCategory] = useState('Safety Equipment')
  const [inspectNow, setInspectNow] = useState(false)
  const [closeIds, setCloseIds] = useState<string[]>([])
  const [resolveIds, setResolveIds] = useState<string[]>([])
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const debounce = useRef<number | undefined>(undefined)
  const openViolations: any[] = zoneViolations?.violations ?? []
  const overdueActions: any[] = zoneActions?.actions ?? []

  const run = async () => {
    if (!zoneId) return
    setPending(true)
    setError(null)
    try {
      const payload: any = { zone_id: zoneId, inspect_now: inspectNow, close_violation_ids: closeIds, resolve_action_ids: resolveIds }
      if (category) payload.add_violation = { category, severity, description: `Hypothetical ${severity} finding for projection`, department: 'SAFETY' }
      const res = await api.post<SimulationResult>(endpoints.simulate, payload)
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
      setResult(null)
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    setCloseIds([])
    setResolveIds([])
    setResult(null)
  }, [zoneId])

  useEffect(() => {
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(run, 260)
    return () => window.clearTimeout(debounce.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, category, inspectNow, closeIds.join(','), resolveIds.join(','), zoneId])

  const delta = result?.delta ?? 0
  const afterBand = bandFor(result?.after.risk_score ?? risk?.risk_score ?? 0)
  const beforeBand = bandFor(risk?.risk_score ?? 0)

  return (
    <Panel
      title="Counterfactual lab"
      subtitle="Adds a hypothetical finding, closes selected violations, resolves selected actions or runs an inspection — then re-scores with the live engine. Nothing is written."
      right={
        <div className="flex items-center gap-2">
          {pending && <span className="text-[10.5px] text-ink-faint">re-scoring…</span>}
          <Button size="sm" variant="primary" onClick={run} loading={pending}>
            Run projection
          </Button>
        </div>
      }
    >
      {!risk ? (
        <EmptyState icon="brain" title="Select a zone to run a projection" className="py-6" />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-sunken p-2">
              <span className="label">scenario applied to</span>
              <span className="text-[11.5px] font-medium">{risk.zone?.name ?? zoneId}</span>
              <span className="ml-auto font-mono text-[11px] text-ink-faint">{risk.risk_score.toFixed(1)} today</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Add a finding — category" hint="Leave the severity at your best judgement">
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">No new finding</option>
                  {(boot?.config.departments ?? []).flatMap((d) => (boot?.config.violation_categories[d] ?? []).map((c) => ({ ...c, department: d }))).map((c) => (
                    <option key={`${c.department}-${c.name}`} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Severity of that finding">
                <SegmentedControl
                  size="sm"
                  value={severity}
                  onChange={(v) => setSeverity(v as any)}
                  options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ value: s, label: s }))}
                />
              </Field>
            </div>

            <div className="rounded border border-line bg-sunken p-2">
              <label className="flex items-center gap-2 text-[11.5px] text-ink-dim">
                <Switch checked={inspectNow} onChange={setInspectNow} label="Assume an inspection is completed today" />
                Assume an inspection is completed today
              </label>
              <p className="mt-1 text-[10px] text-ink-faint">
                Clears the inspection-delay factor for this zone. {risk.metrics?.days_since_inspection !== null && `Current delay: ${risk.metrics?.days_since_inspection}d against a ${risk.metrics?.inspection_cadence_days}d cadence.`}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Checklist
                title={`Open findings (${openViolations.length})`}
                items={openViolations.slice(0, 8).map((v) => ({ id: v.id, label: `${v.id} · ${v.severity} · ${v.category}`, tone: bandFor(v.risk_contribution * 2.4).tone }))}
                selected={closeIds}
                onToggle={(id) => setCloseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                onAll={() => setCloseIds(closeIds.length === openViolations.length ? [] : openViolations.slice(0, 8).map((v) => v.id))}
                empty="Nothing open in this zone."
              />
              <Checklist
                title={`Overdue actions (${overdueActions.length})`}
                items={overdueActions.slice(0, 8).map((a) => ({ id: a.id, label: `${a.id} · ${a.days_overdue}d late`, tone: 'high' }))}
                selected={resolveIds}
                onToggle={(id) => setResolveIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                onAll={() => setResolveIds(resolveIds.length === overdueActions.length ? [] : overdueActions.slice(0, 8).map((a) => a.id))}
                empty="No overdue actions here."
              />
            </div>
          </div>

          <div>
            {error ? (
              <ErrorState message={error} onRetry={run} />
            ) : !result ? (
              <EmptyState icon="brain" title="No projection yet" body="Change an input and the engine will re-score the hypothetical state." className="py-10" />
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-sunken p-3">
                  <div>
                    <div className="label">today</div>
                    <div className="font-mono text-[22px] font-semibold" style={{ color: `var(--risk-${beforeBand.tone})` }}>
                      {fmt(result.before.risk_score, 1)}
                    </div>
                    <div className="text-[10px] text-ink-faint">{result.before.risk_level}</div>
                  </div>
                  <Icon name="arrowRight" className="h-4 w-4 text-ink-faint" />
                  <div>
                    <div className="label">in this scenario</div>
                    <div className="font-mono text-[26px] font-semibold leading-none" style={{ color: `var(--risk-${afterBand.tone})` }}>
                      {fmt(result.after.risk_score, 1)}
                    </div>
                    <div className="text-[10px] text-ink-faint">{result.after.risk_level}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="label">movement</div>
                    <div className="font-mono text-[18px] font-semibold" style={{ color: delta > 0 ? 'var(--risk-high)' : 'var(--risk-low)' }}>
                      {signed(delta, 1)}
                    </div>
                    {beforeBand.label !== afterBand.label && (
                      <Badge tone={afterBand.tone as any} dot>
                        band change
                      </Badge>
                    )}
                  </div>
                </div>

                {result.factor_delta.length === 0 ? (
                  <p className="rounded border border-dashed border-line bg-sunken p-2 text-[11px] leading-snug text-ink-faint">
                    No factor moved enough to register. That usually means the scenario is already reflected in today's score.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {result.factor_delta.map((f) => (
                      <li key={f.key} className="flex items-center gap-2 rounded border border-line bg-sunken px-2 py-1.5 text-[11px]">
                        <span className="w-[176px] shrink-0 text-ink-dim">{f.label}</span>
                        <span className="font-mono">
                          {fmt(f.before, 1)} → {fmt(f.after, 1)}
                        </span>
                        <span className={cx('ml-auto font-mono', f.after - f.before > 0 ? 'text-[color:var(--risk-high)]' : 'text-[color:var(--risk-low)]')}>{signed(f.after - f.before, 1)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div>
                  <div className="label mb-1">Resulting drivers in the scenario</div>
                  <ul className="space-y-1">
                    {(result.after_drivers ?? []).map((d, i) => (
                      <li key={i} className="flex gap-1.5 text-[10.5px] leading-snug text-ink-dim">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[color:var(--accent)]" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/violations?zone_id=${zoneId}`)}>
                    Work the real register
                  </Button>
                  {closeIds.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/actions?status=PENDING_VERIFICATION`)}>
                      Verification queue
                    </Button>
                  )}
                  <span className="text-[10px] text-ink-faint">{result.note}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

function Checklist({
  title,
  items,
  selected,
  onToggle,
  onAll,
  empty,
}: {
  title: string
  items: { id: string; label: string; tone: string }[]
  selected: string[]
  onToggle: (id: string) => void
  onAll: () => void
  empty: string
}) {
  return (
    <div className="rounded border border-line bg-sunken p-2">
      <div className="flex items-center gap-2">
        <span className="label">{title}</span>
        {items.length > 0 && (
          <button className="ml-auto text-[10px] text-[color:var(--accent)] hover:underline" onClick={onAll}>
            {selected.length === items.length ? 'none' : 'all'}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-[10.5px] text-ink-faint">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {items.map((i) => {
            const on = selected.includes(i.id)
            return (
              <li key={i.id}>
                <button onClick={() => onToggle(i.id)} className={cx('flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10.5px] transition-colors', on ? 'bg-[color:var(--accent)]/10 text-ink' : 'text-ink-dim hover:bg-panel')}>
                  <span className={cx('flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border', on ? 'border-transparent bg-[color:var(--accent)] text-[color:var(--panel)]' : 'border-line-strong')}>{on ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  <span className="h-3 w-[3px] shrink-0 rounded-sm" style={{ background: `var(--risk-${i.tone})` }} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
