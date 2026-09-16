import React, { useState } from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Panel, Select, Skeleton, Table, Textarea, cx } from '../components/ui'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { fmtDate, relative } from '../lib/format'
import type { Grievance, GrievanceSummary } from '../lib/types'

/**
 * Grievance Handling — closes PS SIH26024 line item "grievance handling".
 *
 * Each grievance carries severity, an SLA window matched to severity,
 * a channel (WHATSAPP_BOT / WEB_PORTAL / IVR / FIELD) and a language
 * tag — the multilingual requirement is on the inbound channel. SLA
 * breach is derived server-side, same pattern as the risk engine.
 */
const SLA_TONES: Record<string, string> = {
  ON_TRACK: 'var(--risk-low)',
  AT_RISK: 'var(--risk-elevated)',
  BREACHED: 'var(--risk-high)',
  RESOLVED: 'var(--accent)',
}

const SEVERITY_TONES: Record<string, string> = {
  CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'moderate', LOW: 'low',
}

export function GrievancesPage() {
  useDocumentTitle('Grievances · MINEGUARD AI')
  const { data, loading, error, reload } = useAsync<{ grievances: Grievance[]; summary: GrievanceSummary }>(endpoints.grievances, [])
  const { pushToast, actor } = useApp()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [severityFilter, setSeverityFilter] = useState<string>('')

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  const grievances = (data?.grievances ?? []).filter((g) => !statusFilter || g.status === statusFilter).filter((g) => !severityFilter || g.severity === severityFilter)
  const summary = data?.summary

  return (
    <>
      <PageHeader
        eyebrow="Module · Governance"
        title="Grievance handling"
        subtitle="Worker grievances across all mines — multilingual intake (WhatsApp bot / web portal / IVR / field), severity-matched SLAs, escalation when breach occurs."
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-64 w-full" />}
        {summary && (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
            <KpiTile label="Open" value={String(summary.open)} tone="var(--risk-elevated)" />
            <KpiTile label="Critical" value={String(summary.critical_open)} tone="var(--risk-critical)" />
            <KpiTile label="High" value={String(summary.high_open)} tone="var(--risk-high)" />
            <KpiTile label="SLA breached" value={String(summary.breached)} tone="var(--risk-high)" />
            <KpiTile label="Resolution rate" value={`${summary.resolution_rate_pct.toFixed(0)}%`} tone="var(--risk-low)" sub={`${summary.resolved_30d} in last 30d`} />
          </div>
        )}

        {summary && (
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Panel title="By channel" subtitle="Where grievances enter the system">
              <ul className="grid grid-cols-2 gap-1.5">
                {Object.entries(summary.by_channel).map(([ch, n]) => (
                  <li key={ch} className="flex items-center justify-between rounded border border-line bg-sunken px-2 py-1">
                    <span className="text-[11px]">{ch.replace(/_/g, ' ').toLowerCase()}</span>
                    <span className="font-mono text-[12px]">{n}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="By language" subtitle="Multilingual intake (en / hi / others)">
              <ul className="grid grid-cols-3 gap-1.5">
                {Object.entries(summary.by_language).map(([lang, n]) => (
                  <li key={lang} className="flex items-center justify-between rounded border border-line bg-sunken px-2 py-1">
                    <span className="text-[11px] uppercase">{lang}</span>
                    <span className="font-mono text-[12px]">{n}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}

        <Panel
          title="Grievance register"
          subtitle="Sorted by open + severity"
          right={
            <div className="flex items-center gap-1.5">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!h-7 !py-0.5 !text-[11px]">
                <option value="">All status</option>
                <option value="OPEN">Open</option>
                <option value="UNDER_REVIEW">Under review</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="ESCALATED">Escalated</option>
                <option value="RESOLVED">Resolved</option>
              </Select>
              <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="!h-7 !py-0.5 !text-[11px]">
                <option value="">All severity</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
            </div>
          }
        >
          <Table head={['Title', 'Mine', 'Severity', 'Channel', 'Lang', 'Open for', 'SLA', 'Status', 'Action']}>
            {grievances.map((g) => (
              <tr key={g.id} className="row-hover border-t border-line/70">
                <td className="px-2.5 py-1.5 text-[11.5px] max-w-[280px]">
                  <div className="truncate font-medium">{g.title}</div>
                  <div className="text-[10px] text-ink-faint">by {g.raised_by} · {fmtDate(g.created_at)}</div>
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">{g.mine_name}</td>
                <td className="px-2.5 py-1.5">
                  <Badge tone={SEVERITY_TONES[g.severity] as any}>{g.severity}</Badge>
                </td>
                <td className="px-2.5 py-1.5 text-[11px]">{g.channel.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="px-2.5 py-1.5 text-[11px] uppercase">{g.language}</td>
                <td className="px-2.5 py-1.5 font-mono text-[11px]">{g.days_open}d</td>
                <td className="px-2.5 py-1.5">
                  <Badge tone={(SLA_TONES[g.sla_state] ?? '').replace('var(--risk-', '').replace(')', '') as any}>{g.sla_state.replace('_', ' ')}</Badge>
                </td>
                <td className="px-2.5 py-1.5">
                  <Badge tone={g.status === 'RESOLVED' ? 'low' : g.status === 'ESCALATED' ? 'critical' : g.status === 'OPEN' ? 'elevated' : 'moderate'}>
                    {g.status.replace('_', ' ')}
                  </Badge>
                </td>
                <td className="px-2.5 py-1.5">
                  {g.status !== 'RESOLVED' && g.status !== 'ESCALATED' && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const next = g.status === 'OPEN' ? 'UNDER_REVIEW' : g.status === 'UNDER_REVIEW' ? 'ASSIGNED' : 'RESOLVED'
                      try {
                        await api.post(`/api/grievances/${g.id}/advance`, { status: next, resolution_note: next === 'RESOLVED' ? 'Resolved via review.' : undefined })
                        pushToast({ kind: 'success', title: `Grievance → ${next}` })
                        reload()
                      } catch (e: any) { pushToast({ kind: 'error', title: 'Action failed', body: e.message }) }
                    }}>
                      → {g.status === 'OPEN' ? 'Review' : g.status === 'UNDER_REVIEW' ? 'Assign' : 'Resolve'}
                    </Button>
                  )}
                  {g.status === 'ESCALATED' && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      try {
                        await api.post(`/api/grievances/${g.id}/advance`, { status: 'RESOLVED', resolution_note: 'Escalated to management and resolved.' })
                        pushToast({ kind: 'success', title: 'Escalation resolved' })
                        reload()
                      } catch (e: any) { pushToast({ kind: 'error', title: 'Action failed', body: e.message }) }
                    }}>
                      → Resolve
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {grievances.length === 0 && <EmptyState title="No grievances match the filter" />}
        </Panel>
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
