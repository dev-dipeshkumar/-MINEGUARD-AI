import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Avatar, Badge, Button, Divider, EmptyState, ErrorState, Icon, Input, Panel, SegmentedControl, Select, Skeleton, Table, cx, useCopy } from '../components/ui'
import { BandStrip } from '../components/charts'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { fmt, fmtDate, humanize, relative } from '../lib/format'

/**
 * Module 11 — administration.
 *
 * Kept deliberately light, and honest about what is configurable: the engine's
 * weights live in code so that a change is a reviewed commit, not a form field
 * someone edits during a demonstration. What this page *can* do — reset the
 * scenario, run the escalation, switch identity — performs real API calls.
 */
export function AdminPage() {
  const { boot, actorId, setActorId, invalidate, pushToast, mutate } = useApp()
  const navigate = useNavigate()
  useDocumentTitle('Administration · MINEGUARD AI')
  const [tab, setTab] = useState<'engine' | 'people' | 'activity' | 'data'>('engine')
  const { data: config, loading, error, reload } = useAsync<any>(endpoints.config, [])
  const { data: users, reload: reloadUsers } = useAsync<{ users: any[] }>(endpoints.users, [])
  const [limit, setLimit] = useState(40)
  const { data: activity, reload: reloadActivity } = useAsync<any>(`${endpoints.activity}?limit=${limit}`, [limit])
  const { data: overrides, reload: reloadOverrides } = useAsync<any>(endpoints.overrides, [])
  const { data: index } = useAsync<any>('/api', [])
  const [copied, copyJson] = useCopy()
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const list = activity?.activity ?? []
    if (!filter.trim()) return list
    return list.filter((a: any) => `${a.kind} ${a.message} ${a.actor}`.toLowerCase().includes(filter.toLowerCase()))
  }, [activity, filter])

  return (
    <>
      <PageHeader
        eyebrow="Module 11 · Administration"
        title="Platform administration"
        subtitle="Engine configuration as deployed, identities for role-aware demonstration, the audit activity log, and the demo dataset controls."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => copyJson(JSON.stringify(config ?? {}, null, 2))}>
              {copied ? 'Config copied' : 'Copy config JSON'}
            </Button>
            <Button size="sm" onClick={() => navigate('/documents')}>
              Document intake
            </Button>
          </>
        }
        tabs={
          <SegmentedControl
            value={tab}
            onChange={(v) => setTab(v as any)}
            options={[
              { value: 'engine', label: 'Engine & policy' },
              { value: 'people', label: 'Users & roles', count: users?.users?.length },
              { value: 'activity', label: 'Activity log' },
              { value: 'data', label: 'Demo data & overrides' },
            ]}
          />
        }
      />

      <PageBody className="space-y-3.5">
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !config && <Skeleton className="h-64 w-full" />}

        {tab === 'engine' && config && (
          <div className="grid gap-3.5 xl:grid-cols-2">
            <Panel title="Risk model as deployed" subtitle="Served by GET /api/config — the same block /api/bootstrap uses, read-only by design" right={<Badge tone="accent">{config.engine?.phase}</Badge>}>
              <Table head={['Factor', 'Cap', 'Coefficient', 'Behaviour']}>
                {config.engine?.factors?.map((f: any) => (
                  <tr key={f.key} className="row-hover border-t border-line/70">
                    <td className="px-2.5 py-1.5 text-[11.5px]">
                      {f.label}
                      <span className="ml-1.5 font-mono text-[10px] text-ink-faint">{f.key}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{fmt(f.weight_cap, 1)}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{f.coefficient === null ? 'step' : f.coefficient}</td>
                    <td className="px-2.5 py-1.5 text-[10.5px] text-ink-faint">
                      {f.key === 'overdue'
                        ? 'per action per day past due'
                        : f.key === 'inspection_delay'
                        ? 'cadence-ratio steps, capped'
                        : f.key === 'unresolved'
                        ? 'severity-weighted ageing'
                        : f.key === 'repeat'
                        ? 'uplift on 2nd/3rd+ occurrence'
                        : 'severity exposure × coefficient'}
                    </td>
                  </tr>
                ))}
              </Table>
              <Divider className="my-2.5" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded border border-line bg-sunken px-2 py-1.5">
                  <div className="label">Repeat ladder</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(config.engine?.repeat_ladder ?? {}).map(([n, w]: [string, any]) => (
                      <span key={n} className="chip">
                        {n}
                        {n === '1' ? 'st' : n === '2' ? 'nd' : 'rd'} occurrence
                        <span className="font-mono text-ink-dim">+{w}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[9.5px] leading-snug text-ink-faint">
                    Only findings from the 2nd occurrence on add to the repeat factor — a first-time finding is not a repeat.
                  </p>
                </div>
                <div className="rounded border border-line bg-sunken px-2 py-1.5">
                  <div className="label">Unresolved ageing</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(config.engine?.ageing_bands ?? {}).map(([d, w]: [string, any]) => (
                      <span key={d} className="chip">
                        {d}d<span className="font-mono text-ink-dim">{w}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[9.5px] leading-snug text-ink-faint">
                    Age of an open finding at today&apos;s date, weighted per band, then capped at 25 points.
                  </p>
                </div>
              </div>
              <Divider className="my-2.5" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(config.severity_levels ?? {}).map(([k, v]: [string, any]) => (
                  <div key={k} className="rounded border border-line bg-sunken px-2 py-1.5">
                    <div className="label">{v.name ?? k}</div>
                    <div className="font-mono text-[13px] font-semibold">+{v.weight ?? v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2.5">
                <div className="label mb-1">Bands</div>
                <BandStrip counts={Object.fromEntries((config.risk_bands ?? []).map((b: any) => [b.label, 0]))} />
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-faint">
                  {(config.risk_bands ?? []).map((b: any) => (
                    <li key={b.label} className="font-mono">
                      {b.label} {b.min}–{b.max}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-2 rounded border border-dashed border-line bg-sunken p-2 text-[10.5px] leading-snug text-ink-faint">
                Changing a weight means editing <span className="font-mono text-ink-dim">api/services/risk_engine.py</span> and re-running the calibration script, then the compliance and alert generators follow automatically. That is intentional: in a
                safety context a scoring model is a controlled artefact, and the repository is the audit trail.
              </p>
            </Panel>

            <div className="space-y-3.5">
              <Panel title="Policy windows" subtitle="SLA and cadence rules the engine and the alerts both read">
                <dl className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-line bg-sunken px-2 py-1.5">
                    <dt className="label">Resolution SLA (days)</dt>
                    <dd className="mt-0.5 flex flex-wrap gap-1.5 font-mono text-[11.5px]">
                      {Object.entries(config.sla?.resolution_days ?? {}).map(([k, v]) => (
                        <span key={k} className="rounded border border-line bg-panel px-1.5 py-0.5">
                          {k} {String(v)}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div className="rounded border border-line bg-sunken px-2 py-1.5">
                    <dt className="label">Verification window</dt>
                    <dd className="mt-0.5 font-mono text-[11.5px]">{String(config.sla?.verification_days)} days after submission</dd>
                  </div>
                </dl>
                <Divider className="my-2.5" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="label mb-1">Violation statuses</div>
                    <div className="flex flex-wrap gap-1">
                      {config.violation_statuses?.map((s: string) => (
                        <span key={s} className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="label mb-1">Action statuses</div>
                    <div className="flex flex-wrap gap-1">
                      {config.action_statuses?.map((s: string) => (
                        <span key={s} className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Violation categories" subtitle="Severity defaults here are what the inspection form pre-selects">
                <div className="grid gap-2 md:grid-cols-3">
                  {Object.entries(config.violation_categories ?? {}).map(([dept, cats]: [string, any]) => (
                    <div key={dept}>
                      <div className="label mb-1">{humanize(dept)}</div>
                      <ul className="space-y-1">
                        {cats.map((c: any) => (
                          <li key={c.name} className="rounded border border-line bg-sunken px-2 py-1">
                            <div className="text-[11px] font-medium">{c.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-ink-faint">
                              <Badge tone={c.default_severity === 'CRITICAL' ? 'critical' : c.default_severity === 'HIGH' ? 'high' : 'moderate'}>{c.default_severity}</Badge>
                              <span className="truncate" title={c.regulation}>
                                {c.regulation}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="API surface" subtitle={`${index?.endpoints?.length ?? 0} documented routes · OpenAPI at /docs`} right={<Badge tone="neutral">{index?.engine?.mode}</Badge>}>
                <ul className="grid gap-0.5 font-mono text-[10.5px] text-ink-dim sm:grid-cols-2">
                  {(index?.endpoints ?? []).map((e: string) => (
                    <li key={e} className="truncate rounded bg-sunken px-1.5 py-1">
                      {e}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-ink-faint">{index?.product} — {index?.tagline}</p>
              </Panel>
            </div>
          </div>
        )}

        {tab === 'people' && (
          <Panel title="Users, roles and current load" subtitle="Switching identity changes what the API will accept — role gating is server-side" right={<Badge tone="neutral">acting as {actorId}</Badge>}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[11.5px]">
                <thead>
                  <tr className="bg-sunken text-[10px] uppercase tracking-wide2 text-ink-faint">
                    <th className="px-2.5 py-1.5 font-medium">Person</th>
                    <th className="px-2.5 py-1.5 font-medium">Role</th>
                    <th className="px-2.5 py-1.5 font-medium">Scope</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Owns findings</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Actions</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Overdue</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Rounds</th>
                    <th className="px-2.5 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {(users?.users ?? []).map((u: any) => (
                    <tr key={u.id} className={cx('row-hover border-t border-line/70', u.id === actorId && 'bg-[color:var(--accent)]/6')}>
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={u.name} className="h-6 w-6 text-[9px]" />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{u.name}</div>
                            <div className="truncate text-[10px] text-ink-faint">{u.designation}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <Badge tone={u.role === 'ADMIN' ? 'critical' : u.role === 'MANAGER' ? 'elevated' : u.role === 'INSPECTOR' ? 'low' : 'moderate'}>{u.role}</Badge>
                      </td>
                      <td className="px-2.5 py-1.5 text-[10.5px] text-ink-dim">{u.mine_id ? (boot?.mines.find((m) => m.id === u.mine_id)?.name ?? u.mine_id) : 'Enterprise'} · {u.department ? humanize(u.department) : '—'}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{u.violations_owned ?? 0}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{u.open_actions ?? 0}</td>
                      <td className={cx('px-2.5 py-1.5 text-right font-mono', u.overdue_actions ? 'text-[color:var(--risk-high)]' : '')}>{u.overdue_actions ?? 0}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{u.inspections ?? 0}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        {u.id === actorId ? (
                          <span className="text-[10px] text-[color:var(--accent)]">active</span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => (setActorId(u.id), reloadUsers())}>
                            act as
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
              Permissions enforced by the API: INSPECTOR records rounds and raises findings; OFFICER owns and submits corrective actions; MANAGER verifies, closes and may override the chain with a justification; ADMIN additionally resets data and
              manages configuration. A button the role cannot use is hidden or disabled, and the same rule is re-checked on the server.
            </p>
          </Panel>
        )}

        {tab === 'activity' && (
          <Panel
            title="Activity log"
            subtitle="Written by the same service calls that mutate the records — no separate instrumentation"
            right={
              <div className="flex items-center gap-1.5">
                <Input className="h-7 w-[170px] text-[11.5px]" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this view" />
                <Select className="h-7 w-[110px] text-[11.5px]" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[20, 40, 80, 160].map((n) => (
                    <option key={n} value={n}>
                      last {n}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" onClick={reloadActivity}>
                  <Icon name="refresh" className="h-3 w-3" />
                </Button>
              </div>
            }
            dense
            bodyClass="p-0"
          >
            {rows.length === 0 ? (
              <EmptyState icon="clock" title={filter ? 'No log lines match' : 'Nothing logged yet in this window'} body="Every mutation appends here: inspections, violations, assignments, submissions, verifications, overrides and resets." className="py-10" />
            ) : (
              <ul className="divide-y divide-[color:var(--line)]">
                {rows.map((a: any, i: number) => (
                  <li key={a.id ?? i} className="flex flex-wrap items-baseline gap-2 px-3 py-1.5">
                    <span className="font-mono text-[10px] text-ink-faint">{fmtDate(a.at ?? a.created_at)}</span>
                    <Badge tone={a.kind === 'OVERRIDE' ? 'high' : a.kind === 'RESET' ? 'critical' : 'neutral'}>{a.kind}</Badge>
                    <span className="text-[11px] font-medium text-ink-dim">{a.actor}</span>
                    <span className="min-w-0 flex-1 text-[11.5px] text-ink">{a.message}</span>
                    {a.entity && (
                      <button className="shrink-0 font-mono text-[10px] text-[color:var(--accent)] hover:underline" onClick={() => navigate(`/violations?search=${a.entity}`)}>
                        {a.entity}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {tab === 'data' && (
          <div className="grid gap-3.5 xl:grid-cols-2">
            <Panel title="Demo dataset" subtitle="Deterministic seed: same every time, so a rehearsal and a live run match">
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(config?.counts ?? {}).map(([k, v]) => (
                  <div key={k} className="rounded border border-line bg-sunken px-2 py-1.5">
                    <div className="label">{humanize(k)}</div>
                    <div className="font-mono text-[15px] font-semibold">{fmt(v as number)}</div>
                  </div>
                ))}
              </div>
              <Divider className="my-2.5" />
              <dl className="space-y-1 text-[11px]">
                <div className="flex gap-2">
                  <dt className="w-[110px] shrink-0 text-ink-faint">Store file</dt>
                  <dd className="min-w-0 flex-1 truncate font-mono text-ink-dim">{config?.data_path}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-[110px] shrink-0 text-ink-faint">As-of date</dt>
                  <dd className="font-mono text-ink-dim">{config?.as_of} · generated {relative(config?.generated_at)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-[110px] shrink-0 text-ink-faint">Persistence</dt>
                  <dd className="text-ink-dim">file-backed JSON behind a repository seam — swap for Postgres without touching the routers</dd>
                </div>
              </dl>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mutate(() => api.post(endpoints.scenario, { name: 'ZONE_B_ESCALATION' }), {
                      success: (r: any) => r.message ?? 'Escalation scenario applied',
                    }).then((r) => r && invalidate())
                  }
                >
                  Run Zone B escalation
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    mutate(() => api.post(endpoints.reset, {}), { success: 'Demo scenario reset to baseline' }).then((r) => {
                      if (r) {
                        invalidate()
                        reload()
                        reloadActivity()
                        reloadOverrides()
                        pushToast({ kind: 'info', title: 'Every page now reflects the baseline', body: 'Recomputed risks, alerts, insights and history.' })
                      }
                    })
                  }
                >
                  Reset demo scenario
                </Button>
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
                Reset re-seeds the store and re-runs the 90-day history replay, so the trend charts return to their scripted shape. The escalation applies the scripted inspection, violation and overdue sequence to Zone B in one call.
              </p>
            </Panel>

            <Panel title="Workflow overrides" subtitle="Every authorised break of the standard chain, with actor and justification" dense bodyClass="p-0">
              {(overrides?.overrides ?? []).length === 0 ? (
                <EmptyState icon="shield" title="No overrides recorded" body="Closing a violation without the verification step requires a manager justification and lands here." className="py-10" />
              ) : (
                <ul className="divide-y divide-[color:var(--line)]">
                  {(overrides?.overrides ?? []).map((o: any) => (
                    <li key={o.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10.5px] text-ink-faint">{o.id}</span>
                        <Badge tone="high">
                          {o.from_status} → {o.to_status}
                        </Badge>
                        <span className="text-[11px] text-ink-dim">
                          {o.actor} ({o.role})
                        </span>
                        <span className="ml-auto text-[10px] text-ink-faint">{fmtDate(o.at ?? o.created_at)}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-ink-dim">{o.reason}</p>
                      {o.violation_id && (
                        <button className="mt-1 font-mono text-[10px] text-[color:var(--accent)] hover:underline" onClick={() => navigate(`/violations?search=${o.violation_id}`)}>
                          {o.violation_id}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </PageBody>
    </>
  )
}
