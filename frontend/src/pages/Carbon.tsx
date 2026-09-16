import React from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, EmptyState, ErrorState, Panel, Progress, Skeleton, Table, cx } from '../components/ui'
import { Sparkline } from '../components/charts'
import { useAsync, useDocumentTitle } from '../state/app'
import { endpoints } from '../lib/api'
import { fmt } from '../lib/format'

/**
 * Carbon Footprint page — Ministry of Coal net-zero mandate alignment.
 *
 * Computes Scope 1 (fugitive methane + diesel) + Scope 2 (grid
 * electricity) emissions per mine using IPCC 2019 Refinement factors.
 * Tracks against a 50% reduction target by 2030.
 *
 * Research grounding: Ivanova 2022 (66 citations) "An Overview of
 * Carbon Footprint of Coal Mining to Curtail GHG"; SIH 2024 winning
 * project NC035 (NIT Surathkal) on Indian coal mine carbon footprint.
 */
interface MonthlyFootprint {
  period_month: string
  per_mine: Array<{
    mine_id: string
    mine_name: string
    mine_type: string
    production_kt: number
    overburden_m3: number
    scope1_methane_tco2e: number
    scope1_diesel_tco2e: number
    scope2_electricity_tco2e: number
    scope1_total_tco2e: number
    scope2_total_tco2e: number
    total_tco2e: number
    electricity_mwh: number
  }>
  total_tco2e: number
  total_production_kt: number
  intensity_tco2e_per_kt: number
}

export function CarbonPage() {
  useDocumentTitle('Carbon Footprint · MINEGUARD AI')
  const { data, loading, error, reload } = useAsync<any>(endpoints.carbonFootprint, [])
  const { data: leaderboardData } = useAsync<any>(endpoints.carbonLeaderboard, [])

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  const monthly: MonthlyFootprint[] = data?.monthly ?? []
  const totals = data?.totals
  const efs = data?.emission_factors

  return (
    <>
      <PageHeader
        eyebrow="Module · Sustainability"
        title="Carbon footprint"
        subtitle="Scope 1 (fugitive methane + diesel) + Scope 2 (grid electricity) emissions per mine using IPCC 2019 Refinement factors. Aligned with the Ministry of Coal's net-zero mandate."
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-64 w-full" />}

        {data && (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Baseline (6mo ago)" value={`${fmt(totals.baseline_tco2e, 0)} tCO₂e`} tone="var(--text-dim)" sub="first month of the window" />
              <KpiTile label="Latest month" value={`${fmt(totals.latest_tco2e, 0)} tCO₂e`} tone="var(--accent)" />
              <KpiTile
                label="Change vs baseline"
                value={`${totals.reduction_pct > 0 ? '−' : '+'}${fmt(Math.abs(totals.reduction_pct), 1)}%`}
                tone={totals.reduction_pct > 0 ? 'var(--risk-low)' : 'var(--risk-high)'}
                sub={totals.reduction_pct > 0 ? 'emissions falling' : 'emissions rising'}
              />
              <KpiTile
                label="Net-zero progress"
                value={`${fmt(totals.net_zero_progress_pct, 0)}%`}
                tone="var(--risk-low)"
                sub={`target ${totals.net_zero_target_pct}% reduction by 2030`}
              />
            </div>

            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Panel title="6-month trend" subtitle="Total portfolio emissions per month">
                <Sparkline values={monthly.map((m) => m.total_tco2e)} tone="var(--accent)" width={540} height={140} />
                <div className="mt-1 flex gap-1">
                  {monthly.map((m) => (
                    <div key={m.period_month} className="flex-1 text-center">
                      <div className="font-mono text-[10.5px]">{fmt(m.total_tco2e / 1000, 1)}k</div>
                      <div className="text-[9px] text-ink-faint">{m.period_month.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Carbon intensity leaderboard" subtitle="tCO₂e per kt of coal produced — lower is better">
                {leaderboardData?.leaderboard?.length ? (
                  <ul className="divide-y divide-line/60">
                    {leaderboardData.leaderboard.map((m: any, i: number) => (
                      <li key={m.mine_id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px]">
                            <span className="font-mono text-[10px] text-ink-faint mr-1.5">#{i + 1}</span>
                            {m.mine_name}
                          </span>
                          <span className="block text-[10px] text-ink-faint">{m.mine_type === 'UNDERGROUND' ? 'Underground' : 'Open-cast'} · {fmt(m.total_production_kt_3mo, 0)} kt / 3mo</span>
                        </span>
                        <span className="text-right">
                          <span className="font-mono text-[14px] font-semibold" style={{ color: m.intensity_tco2e_per_kt < 100 ? 'var(--risk-low)' : m.intensity_tco2e_per_kt < 300 ? 'var(--risk-elevated)' : 'var(--risk-high)' }}>
                            {fmt(m.intensity_tco2e_per_kt, 1)}
                          </span>
                          <span className="block text-[10px] text-ink-faint">tCO₂e / kt</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="No leaderboard data" />}
              </Panel>
            </div>

            <Panel title="Emissions by source (latest month)" subtitle="Scope 1 + Scope 2 breakdown">
              {monthly.length > 0 && (() => {
                const latest = monthly[monthly.length - 1]
                const totalsScope = latest.per_mine.reduce((acc: any, m: any) => ({
                  methane: acc.methane + m.scope1_methane_tco2e,
                  diesel: acc.diesel + m.scope1_diesel_tco2e,
                  electricity: acc.electricity + m.scope2_electricity_tco2e,
                }), { methane: 0, diesel: 0, electricity: 0 })
                const grandTotal = totalsScope.methane + totalsScope.diesel + totalsScope.electricity
                return (
                  <div className="space-y-2">
                    <SourceBar label="Scope 1 — Fugitive methane (CH₄ → CO₂e, GWP100=28)" value={totalsScope.methane} total={grandTotal} color="var(--risk-high)" />
                    <SourceBar label="Scope 1 — Diesel (HSD, haul trucks + equipment)" value={totalsScope.diesel} total={grandTotal} color="var(--risk-elevated)" />
                    <SourceBar label="Scope 2 — Grid electricity (India grid, 0.71 tCO₂/MWh)" value={totalsScope.electricity} total={grandTotal} color="var(--accent)" />
                  </div>
                )
              })()}
            </Panel>

            <Panel title="IPCC emission factors used" subtitle="From IPCC 2019 Refinement, Volume 2: Energy">
              {efs && (
                <Table head={['Factor', 'Value', 'Unit']}>
                  <Row label="Fugitive methane (underground)" value={efs.fugitive_methane_underground_tco2e_per_t} unit="tCO₂e / t coal" />
                  <Row label="Fugitive methane (open-cast)" value={efs.fugitive_methane_open_cast_tco2e_per_t} unit="tCO₂e / t coal" />
                  <Row label="Diesel HSD" value={efs.diesel_hsd_tco2e_per_kl} unit="tCO₂e / kL" />
                  <Row label="Grid electricity (India)" value={efs.grid_electricity_tco2e_per_mwh} unit="tCO₂e / MWh" />
                  <Row label="Electricity (underground)" value={efs.grid_electricity_mwh_per_kt_underground} unit="MWh / kt coal" />
                  <Row label="Electricity (open-cast)" value={efs.grid_electricity_mwh_per_kt_open_cast} unit="MWh / kt coal" />
                </Table>
              )}
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}

function KpiTile({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="panel relative flex min-h-[100px] flex-col justify-between overflow-hidden p-3">
      <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: tone }} />
      <span className="label">{label}</span>
      <span className="font-mono text-[22px] font-semibold" style={{ color: tone }}>{value}</span>
      {sub && <span className="text-[10.5px] text-ink-faint">{sub}</span>}
    </div>
  )
}

function SourceBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <span className="text-ink-dim">{label}</span>
        <span className="font-mono text-ink">
          {fmt(value, 0)} tCO₂e <span className="text-ink-faint">({fmt(pct, 1)}%)</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-sm bg-sunken">
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function Row({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <tr className="row-hover border-t border-line/70">
      <td className="px-2.5 py-1.5 text-[11.5px]">{label}</td>
      <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{value}</td>
      <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">{unit}</td>
    </tr>
  )
}
