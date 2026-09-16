import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Icon, Input, Panel, Select, Skeleton, Tooltip, cx } from '../components/ui'
import { Donut } from '../components/charts'
import { ViolationDrawer, severityTone } from '../components/ViolationDrawer'
import { useApp, useAsync } from '../state/app'
import { endpoints } from '../lib/api'
import type { Violation } from '../lib/types'
import { STATUS_TONE, downloadText, fmt, fmtDate, humanize, toCsv } from '../lib/format'

type Row = Violation & { actions?: any[]; evidence_items?: any[] }

/**
 * Module 5 — violation management. The register is a query surface first: the
 * filters that matter operationally (unassigned, evidence missing, overdue,
 * repeat) are one click each, and every row opens the same dossier the workflow
 * is actually operated from.
 */
export function ViolationsPage() {
  const [params, setParams] = useSearchParams()
  const { boot, revision } = useApp()
  const { data, loading, error, reload } = useAsync<any>(endpoints.violations(query(params)), [params.toString(), revision])
  const [open, setOpen] = useState<string | null>(params.get('violation'))

  const rows: Row[] = data?.violations ?? []
  const param = (name: string) => params.get(name) ?? params.get(Object.entries(ALIAS).find(([, api]) => api === name)?.[0] ?? '')
  const counts = data?.status_counts ?? {}

  // keep the URL the single source of truth so filters survive reload + share
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'ALL') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const severityMix = useMemo(() => {
    const acc: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
    rows.forEach((r) => {
      if (r.status !== 'CLOSED') acc[r.severity] = (acc[r.severity] ?? 0) + 1
    })
    return acc
  }, [rows])

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        id: r.id,
        created: r.created_at,
        mine: r.mine_name,
        zone: r.zone_short,
        department: r.department,
        category: r.category,
        severity: r.severity,
        status: r.status,
        owner: r.owner_name ?? '',
        due_date: r.due_date ?? '',
        days_overdue: r.days_overdue,
        risk_contribution: r.risk_contribution,
        occurrences: r.occurrences,
        evidence: r.evidence_count,
        regulation: r.regulation,
        description: r.description,
      })),
    )
    downloadText(`mineguard-violations-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const active = [...params.entries()].filter(([k, v]) => v && k !== 'violation').length

  return (
    <>
      <PageHeader
        eyebrow="Module 5 · Compliance register"
        title="Violations"
        subtitle="Every recorded non-compliance with its severity, owner, SLA state and the exact weight it is adding to its zone score."
        actions={
          <>
            {active > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear {active} filter{active > 1 ? 's' : ''}
              </Button>
            )}
            <Button size="sm" onClick={exportCsv} icon={<Icon name="download" className="h-3.5 w-3.5" />} disabled={!rows.length}>
              Export CSV
            </Button>
          </>
        }
      />

      <PageBody className="space-y-3">
        {/* quick triage strip */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <QuickChip label="Open register" value={counts.OPEN_ANY ?? 0} hint="everything not closed" onClick={() => set('status', 'OPEN_ANY')} active={params.get('status') === 'OPEN_ANY'} tone="elevated" />
          <QuickChip label="Overdue" value={counts.OVERDUE ?? 0} hint="past their committed date" onClick={() => set('status', 'OVERDUE')} active={params.get('status') === 'OVERDUE'} tone="high" />
          <QuickChip label="Unassigned" value={data?.unassigned ?? count(rows, (r) => !r.assigned_to)} hint="no owner on record" onClick={() => set('assigned_to', 'unassigned')} active={params.get('assigned_to') === 'unassigned'} tone="moderate" />
          <QuickChip label="Evidence missing" value={data?.evidence_missing ?? count(rows, (r) => !r.evidence_count)} hint="cannot be verified yet" onClick={() => set('evidence', 'missing')} active={params.get('evidence') === 'missing'} tone="critical" />
        </div>

        <Panel
          title="Filter the register"
          right={
            <div className="flex items-center gap-2">
              <span className="label">sort</span>
              <Select className="h-7 w-[150px] text-[11.5px]" value={params.get('sort') ?? 'risk'} onChange={(e) => set('sort', e.target.value)}>
                <option value="risk">Risk contribution</option>
                <option value="severity">Severity</option>
                <option value="age">Age of finding</option>
                <option value="due">Due date</option>
                <option value="created">Newest first</option>
              </Select>
            </div>
          }
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
            <div className="xl:col-span-2">
              <Input value={param('search') ?? ''} onChange={(e) => set('search', e.target.value)} placeholder="Search description, category or id…" mono={false} />
            </div>
            <Select value={param('mine_id') ?? ''} onChange={(e) => set('mine_id', e.target.value)}>
              <option value="">All mines</option>
              {boot?.mines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Select value={param('zone_id') ?? ''} onChange={(e) => set('zone_id', e.target.value)}>
              <option value="">All zones</option>
              {(boot?.zones ?? []).filter((z) => !param('mine_id') || z.mine_id === param('mine_id')).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.mine_name.split(' ')[0]} · {z.short_name}
                </option>
              ))}
            </Select>
            <Select value={param('department') ?? ''} onChange={(e) => set('department', e.target.value)}>
              <option value="">All departments</option>
              {boot?.config.departments.map((d) => (
                <option key={d} value={d}>
                  {humanize(d)}
                </option>
              ))}
            </Select>
            <Select value={param('severity') ?? ''} onChange={(e) => set('severity', e.target.value)}>
              <option value="">All severities</option>
              {(boot?.config.severity_levels ?? []).map((sv) => (
                <option key={sv.name} value={sv.name}>
                  {sv.name} · weight {sv.weight}
                </option>
              ))}
            </Select>
            <Select value={param('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
              <option value="">All statuses</option>
              <option value="OPEN_ANY">Any open stage</option>
              <option value="OVERDUE">Overdue</option>
              {boot?.config.violation_statuses.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-faint">
            <span className="label">evidence</span>
            {['missing', 'present'].map((v) => (
              <button
                key={v}
                onClick={() => set('evidence', params.get('evidence') === v ? null : v)}
                className={cx('rounded border px-1.5 py-0.5 transition-colors', params.get('evidence') === v ? 'border-[color:var(--accent)] text-ink' : 'border-line text-ink-dim hover:text-ink')}
              >
                {v}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-line" />
            <span className="label">assignee</span>
            {['unassigned', ...((boot?.users ?? []).filter((u) => u.role === 'OFFICER').map((u) => u.id) as string[])].map((v) => (
              <button
                key={v}
                onClick={() => set('assigned_to', params.get('assigned_to') === v ? null : v)}
                className={cx('rounded border px-1.5 py-0.5 transition-colors', params.get('assigned_to') === v ? 'border-[color:var(--accent)] text-ink' : 'border-line text-ink-dim hover:text-ink')}
              >
                {v === 'unassigned' ? 'unassigned' : boot?.users.find((u) => u.id === v)?.name.split(' ')[0] ?? v}
              </button>
            ))}
          </div>
        </Panel>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_240px]">
          <Panel dense bodyClass="p-0" title="Register" subtitle={`${fmt(data?.total ?? 0)} record(s) match${loading ? ' · updating' : ''}`} right={<span className="font-mono text-[10.5px] text-ink-faint">{rows.length} shown</span>}>
            {error && (
              <div className="p-3">
                <ErrorState message={error} onRetry={reload} />
              </div>
            )}
            {loading && !data && (
              <div className="space-y-1.5 p-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            )}
            {!loading && rows.length === 0 && !error && (
              <EmptyState
                icon="check"
                title="Nothing matches this register view"
                body="Either the filters are too narrow or the compliance position is genuinely clear here. Clear the filters to see the full register."
                action={
                  <Button size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    Clear filters
                  </Button>
                }
                className="py-10"
              />
            )}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-sunken text-[10px] uppercase tracking-wide2 text-ink-faint">
                      <th className="px-3 py-1.5 font-medium">Severity / id</th>
                      <th className="px-3 py-1.5 font-medium">Finding</th>
                      <th className="px-3 py-1.5 font-medium">Zone</th>
                      <th className="px-3 py-1.5 font-medium">Owner</th>
                      <th className="px-3 py-1.5 font-medium">Status</th>
                      <th className="px-3 py-1.5 text-right font-medium">Risk</th>
                      <th className="px-3 py-1.5 text-right font-medium">Age / due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="row-hover cursor-pointer border-b border-line/70" onClick={() => setOpen(r.id)}>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-1.5">
                            <span className="h-4 w-[3px] rounded-sm" style={{ background: `var(--risk-${severityTone(r.severity)})` }} />
                            <span className="font-mono text-[10.5px] text-ink-faint">{r.id}</span>
                          </div>
                          {r.occurrences > 1 && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[9.5px] text-[color:var(--risk-elevated)]">
                              <Icon name="refresh" className="h-2.5 w-2.5" /> {r.occurrences}× repeat
                            </span>
                          )}
                        </td>
                        <td className="max-w-[420px] px-3 py-2 align-top">
                          <div className="truncate text-[12px] font-medium">{r.category}</div>
                          <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-ink-faint">{r.description}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-ink-dim">
                          <div className="truncate">{r.zone_short}</div>
                          <div className="truncate text-[10px] text-ink-faint">{r.mine_name}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-[11px]">
                          {r.owner_name ? (
                            <span className="text-ink-dim">{r.owner_name}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[color:var(--risk-elevated)]">
                              <Icon name="user" className="h-3 w-3" /> unassigned
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge tone={(STATUS_TONE[r.status] ?? 'neutral') as any}>{humanize(r.status)}</Badge>
                          {r.evidence_count === 0 && <div className="mt-1 text-[9.5px] text-[color:var(--danger)]">no evidence</div>}
                        </td>
                        <td className="px-3 py-2 text-right align-top">
                          <Tooltip tip={`Attributed share of ${(boot?.zones.find((z) => z.id === r.zone_id)?.risk_score ?? 0).toFixed(1)} in ${r.zone_short} — severity, ageing, repeat depth and overdue actions, apportioned by the engine.`}>
                            <span className="font-mono text-[12.5px] font-semibold" style={{ color: r.risk_contribution > 8 ? 'var(--risk-high)' : 'var(--ink)' }}>
                              {fmt(r.risk_contribution, 1)}
                            </span>
                          </Tooltip>
                          <div className="text-[9.5px] text-ink-faint">pts</div>
                        </td>
                        <td className="px-3 py-2 text-right align-top">
                          <span className={cx('font-mono text-[11.5px]', r.overdue ? 'text-[color:var(--risk-high)]' : 'text-ink-dim')}>{r.age_days}d</span>
                          <div className="text-[9.5px] text-ink-faint">{r.due_date ? `${r.overdue ? `${r.days_overdue}d late` : `due ${fmtDate(r.due_date)}`}` : 'no due date'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="space-y-3">
            <Panel title="Severity mix (open)" subtitle="Weighted by the engine's severity scale, not just counts">
              <Donut
                segments={Object.entries(severityMix).map(([k, v]) => ({ label: k, value: v as number, color: `var(--risk-${severityTone(k)})` }))}
                center={`${Object.values(severityMix).reduce((a, b) => a + (b as number), 0)}`}
              />
              <ul className="mt-2 space-y-1">
                {Object.entries(severityMix).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2 text-[11px]">
                    <span className="h-2 w-2 rounded-sm" style={{ background: `var(--risk-${severityTone(k)})` }} />
                    <span className="text-ink-dim">{k}</span>
                    <span className="ml-auto font-mono text-ink">{v}</span>
                    <span className="w-8 text-right font-mono text-[10px] text-ink-faint">+{boot?.engine.severity_weights[k]}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Status funnel" subtitle="Where the register is stuck">
              <ul className="space-y-1.5">
                {(boot?.config.violation_statuses ?? []).map((s) => {
                  const n = counts[s] ?? 0
                  const total = Math.max(1, data?.total ?? 1)
                  return (
                    <li key={s} className="flex items-center gap-2">
                      <span className="w-[104px] shrink-0 text-[10.5px] text-ink-dim">{humanize(s)}</span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-sm bg-sunken">
                        <button className="block h-full transition-all" style={{ width: `${(n / total) * 100}%`, background: `var(--risk-${STATUS_TONE[s] ?? 'neutral'})` }} onClick={() => set('status', s)} title={`${n} record(s) — click to filter`} />
                      </span>
                      <span className="w-6 text-right font-mono text-[11px]">{n}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-[10px] leading-snug text-ink-faint">
                Closed {fmt(counts.CLOSED ?? 0)} of {fmt(data?.total ?? 0)}. A record cannot leave {humanize('ACTION_SUBMITTED')} without a manager verification — that is the guard, not a backlog.
              </p>
            </Panel>

            <Panel title="Oldest still open" subtitle="Age is a risk factor in its own right">
              <ul className="space-y-1">
                {[...rows]
                  .filter((r) => r.status !== 'CLOSED')
                  .sort((a, b) => b.age_days - a.age_days)
                  .slice(0, 5)
                  .map((r) => (
                    <li key={r.id}>
                      <button onClick={() => setOpen(r.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-sunken">
                        <span className="font-mono text-[10.5px] text-ink-faint">{r.age_days}d</span>
                        <span className="min-w-0 flex-1 truncate text-[11px]">{r.category}</span>
                        <span className="text-[10px] text-ink-faint">{r.zone_short}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </Panel>
          </div>
        </div>
      </PageBody>

      <ViolationDrawer
        violationId={open}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />
    </>
  )
}

function count(rows: Row[], pred: (r: Row) => boolean) {
  return rows.filter((r) => r.status !== 'CLOSED' && pred(r)).length
}

/** Short aliases are accepted alongside the API names so links from other pages
 *  (`/violations?zone=Z-ALPHA-B`) land on the same filtered register. */
const ALIAS: Record<string, string> = { zone: 'zone_id', mine: 'mine_id', dept: 'department', sev: 'severity' }

function query(params: URLSearchParams) {
  const q = new URLSearchParams()
  for (const k of ['mine_id', 'zone_id', 'department', 'severity', 'status', 'assigned_to', 'evidence', 'search', 'sort']) {
    const v = params.get(k) ?? params.get(Object.keys(ALIAS).find((a) => ALIAS[a] === k) ?? '')
    if (v) q.set(k, v)
  }
  q.set('limit', '400')
  return q.toString()
}

function QuickChip({ label, value, hint, onClick, active, tone }: { label: string; value: number; hint: string; onClick: () => void; active: boolean; tone: string }) {
  return (
    <button
      onClick={onClick}
      className={cx('group flex items-center gap-3 rounded border p-2.5 text-left transition-colors', active ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/8' : 'border-line bg-panel hover:border-line-strong')}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded font-mono text-[15px] font-semibold" style={{ background: `var(--risk-${tone})22`, color: `var(--risk-${tone})` }}>
        {value}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium">{label}</span>
        <span className="block truncate text-[10.5px] text-ink-faint">{hint}</span>
      </span>
      <Icon name={active ? 'check' : 'arrowRight'} className={cx('ml-auto h-3.5 w-3.5 shrink-0', active ? 'text-[color:var(--accent)]' : 'text-ink-faint group-hover:text-ink-dim')} />
    </button>
  )
}
