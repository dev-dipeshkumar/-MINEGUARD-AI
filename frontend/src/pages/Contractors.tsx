import React, { useState } from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Panel, Progress, Select, Skeleton, Table, cx } from '../components/ui'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { DashboardTabs } from '../components/DashboardTabs'
import { api, endpoints } from '../lib/api'
import { fmt } from '../lib/format'
import type { Contractor, ContractorSummary } from '../lib/types'

/**
 * Contractor Management — closes PS SIH26024 line item "contract management".
 *
 * Each contractor carries commercial terms, statutory identifiers (PAN/GST),
 * performance score, audit status and compliance flags. The page surfaces
 * portfolio value, compliance gaps and contracts nearing expiry so
 * procurement and governance can be read together.
 */
export function ContractorsPage() {
  useDocumentTitle('Contractors · MINEGUARD AI')
  const { data, loading, error, reload } = useAsync<{ contractors: Contractor[]; summary: ContractorSummary }>(endpoints.contractors, [])
  const [statusFilter, setStatusFilter] = useState<string>('')

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  const contractors = data?.contractors.filter((c) => !statusFilter || c.status === statusFilter) ?? []

  return (
    <>
      <PageHeader
        eyebrow="Module · Governance"
        title="Contractor management"
        subtitle="Active labour and services contracts crossed with compliance scores"
        tabs={<DashboardTabs />}
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-64 w-full" />}
        {data && (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Portfolio value" value={`₹${fmt(data.summary.total_value_inr_lakh, 0)}L`} tone="var(--accent)" sub={`${data.summary.active_count} active contracts`} />
              <KpiTile label="Active value" value={`₹${fmt(data.summary.active_value_inr_lakh, 0)}L`} tone="var(--risk-low)" />
              <KpiTile label="Non-compliant" value={String(data.summary.non_compliant_count)} tone="var(--risk-high)" sub="statutory gaps" />
              <KpiTile label="Expiring <60d" value={String(data.summary.expiring_soon.length)} tone="var(--risk-elevated)" sub="renewal window" />
            </div>

            {data.summary.low_performers.length > 0 && (
              <Panel title="Low performers" subtitle="Active or at-risk contracts performing below 70% of milestones">
                <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {data.summary.low_performers.map((c) => (
                    <li key={c.id} className="flex items-center justify-between rounded border border-line bg-sunken p-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[11.5px] font-medium">{c.name}</span>
                        <span className="block text-[10px] text-ink-faint">{c.mine_name}</span>
                      </span>
                      <span className="font-mono text-[11.5px] text-[color:var(--risk-high)]">{c.performance_pct.toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel
              title="Contract register"
              subtitle="All contractors — commercial, statutory and compliance status"
              right={
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!h-7 !py-0.5 !text-[11px]">
                  <option value="">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="AT_RISK">At risk</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="TERMINATED">Terminated</option>
                </Select>
              }
            >
              <Table head={['Name', 'Mine', 'Service', 'Value (₹L)', 'PAN', 'Perf.', 'Audit', 'Expiry', 'Status']}>
                {contractors.map((c) => (
                  <tr key={c.id} className="row-hover border-t border-line/70">
                    <td className="px-2.5 py-1.5 text-[11.5px] max-w-[260px] truncate">{c.name}</td>
                    <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">{(c as any).mine_name ?? c.mine_id}</td>
                    <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">{c.service.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{fmt(c.value_inr_lakh, 0)}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-ink-dim">{c.pan}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Progress value={c.performance_pct} tone={c.performance_pct >= 80 ? 'var(--risk-low)' : c.performance_pct >= 60 ? 'var(--risk-elevated)' : 'var(--risk-high)'} className="w-[50px]" />
                        <span className="font-mono text-[10.5px]">{c.performance_pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge tone={c.audit_status === 'CLEAN' ? 'low' : c.audit_status === 'OBSERVATIONS' ? 'elevated' : 'critical'}>
                        {c.audit_status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[10.5px] text-ink-dim">{c.days_to_expiry}d</td>
                    <td className="px-2.5 py-1.5">
                      <Badge tone={c.status === 'ACTIVE' ? 'low' : c.status === 'AT_RISK' ? 'elevated' : c.status === 'EXPIRED' ? 'high' : 'critical'}>
                        {c.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </Table>
              {contractors.length === 0 && <EmptyState title="No contractors match the filter" />}
            </Panel>

            {data.contractors.some((c) => c.flags.length > 0) && (
              <Panel title="Compliance flags" subtitle="Each flag derived from the contractor's records, not asserted">
                <ul className="space-y-1">
                  {data.contractors.filter((c) => c.flags.length).flatMap((c) => c.flags.map((f, i) => (
                    <li key={`${c.id}-${i}`} className="flex items-baseline gap-2 rounded border border-line bg-sunken px-2.5 py-1.5">
                      <Badge tone="high">flag</Badge>
                      <span className="text-[11px] font-medium">{c.name}</span>
                      <span className="text-[11px] text-ink-dim">— {f}</span>
                    </li>
                  )))}
                </ul>
              </Panel>
            )}
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
      <span className="font-mono text-[20px] font-semibold" style={{ color: tone }}>{value}</span>
      {sub && <span className="text-[10.5px] text-ink-faint">{sub}</span>}
    </div>
  )
}
