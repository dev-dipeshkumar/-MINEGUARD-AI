import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Avatar, Badge, Button, EmptyState, ErrorState, Field, Icon, Input, Panel, Progress, SegmentedControl, Select, Skeleton, Textarea, Tooltip, cx } from '../components/ui'
import { BarRowChart } from '../components/charts'
import { ViolationDrawer, ACTION_PROGRESS, severityTone } from '../components/ViolationDrawer'
import { useApp, useAsync } from '../state/app'
import { api, endpoints } from '../lib/api'
import { downloadText, fmt, fmtDate, humanize, relative, toCsv } from '../lib/format'

type ActionRow = {
  id: string
  violation_id: string
  violation_severity: string
  violation_status: string
  violation_category: string
  mine_id: string
  mine_name: string
  zone_id: string
  zone_name: string
  zone_short: string
  description: string
  status: string
  assigned_to: string
  owner_name?: string
  owner_initials?: string
  created_at: string
  due_date: string | null
  started_at: string | null
  completed_at: string | null
  closed_at: string | null
  resolution_notes?: string | null
  verification_notes?: string | null
  verified_by?: string | null
  verified_at?: string | null
  evidence_count: number
  priority: string
  days_overdue: number
  age_days: number
  is_overdue: boolean
  can_verify: boolean
}

const ACTION_FLOW = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'CLOSED']

/**
 * Module 6 — corrective action management: the queue that decides whether
 * findings actually stop being a risk. Owner-centric, with the verification
 * step separated because the person who did the work cannot sign it off.
 */
export function ActionsPage() {
  const [params, setParams] = useSearchParams()
  const { boot, actor, revision, mutate, pushToast } = useApp()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'ACTIVE'
  const owner = params.get('owner') ?? ''
  const mineId = params.get('mine_id') ?? ''
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [expanded, setExpanded] = useState<string | null>(params.get('focus'))
  const [violationOpen, setViolationOpen] = useState<string | null>(null)
  const query = useMemo(() => {
    const q = new URLSearchParams()
    if (status !== 'ALL') q.set('status', status)
    if (owner) q.set('assigned_to', owner)
    if (mineId) q.set('mine_id', mineId)
    return q.toString()
  }, [status, owner, mineId])

  const { data, loading, error, reload } = useAsync<any>(endpoints.actions(query), [query, revision])
  const rows: ActionRow[] = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return data?.actions ?? []
    return (data?.actions ?? []).filter((a: ActionRow) => `${a.id} ${a.description} ${a.violation_category} ${a.zone_name} ${a.owner_name ?? ''}`.toLowerCase().includes(term))
  }, [data, search])
  const summary = data?.summary
  const byOwner: { owner: string; count: number; overdue: number }[] = data?.by_owner ?? []

  const setQ = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'ALL') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const patch = (id: string, body: Record<string, unknown>, success: string) =>
    mutate(() => api.patch(`/api/corrective-actions/${id}`, body), { success, onError: (e) => (e as Error).message })

  const batchSubmit = async () => {
    const targets = rows.filter((a) => (a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && a.assigned_to === actor?.id)
    if (!targets.length) {
      pushToast({ kind: 'info', title: 'Nothing to batch', body: 'Batch advance applies to your own ASSIGNED or IN_PROGRESS actions on this filtered view.' })
      return
    }
    for (const t of targets) await patch(t.id, { status: 'IN_PROGRESS', resolution_notes: undefined }, '')
    pushToast({ kind: 'success', title: `${targets.length} action(s) moved to IN_PROGRESS`, body: 'Each transition was validated by the workflow service.' })
    reload()
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 6 · Corrective action"
        title="Corrective actions"
        subtitle="The resolution queue: assignment, work, evidence, verification, closure. Risk only falls at the last step, which is why this page is where the pressure sits."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={batchSubmit} disabled={loading}>
              Advance my active work
            </Button>
            <Button
              size="sm"
              onClick={() =>
                downloadText(
                  `mineguard-actions-${new Date().toISOString().slice(0, 10)}.csv`,
                  toCsv(
                    rows.map((a) => ({
                      id: a.id,
                      violation: a.violation_id,
                      severity: a.violation_severity,
                      category: a.violation_category,
                      zone: a.zone_short,
                      mine: a.mine_name,
                      owner: a.owner_name ?? a.assigned_to,
                      status: a.status,
                      due: a.due_date ?? '',
                      days_overdue: a.days_overdue,
                      description: a.description,
                      resolution_notes: a.resolution_notes ?? '',
                      verification_notes: a.verification_notes ?? '',
                    })),
                  ),
                )
              }
              icon={<Icon name="download" className="h-3.5 w-3.5" />}
              disabled={!rows.length}
            >
              Export CSV
            </Button>
          </>
        }
        tabs={
          <SegmentedControl
            value={status}
            onChange={(v) => setQ('status', v)}
            options={[
              { value: 'ACTIVE', label: 'Active', count: summary?.open },
              { value: 'OVERDUE', label: 'Overdue', count: summary?.overdue },
              { value: 'PENDING_VERIFICATION', label: 'Awaiting verification', count: summary?.awaiting_verification },
              { value: 'ALL', label: 'All' },
            ]}
          />
        }
      />

      <PageBody className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Open actions" value={fmt(summary?.open)} hint="not yet verified or closed" tone="var(--risk-elevated)" />
          <Stat label="Overdue" value={fmt(summary?.overdue)} hint="past committed date" tone="var(--risk-high)" />
          <Stat label="Due within 7 days" value={fmt(summary?.due_soon)} hint="plan the week around these" tone="var(--risk-moderate)" />
          <Stat label="Closed last 30 days" value={fmt(summary?.closed_30d)} hint="verified closures" tone="var(--risk-low)" />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_268px]">
          <Panel
            dense
            bodyClass="p-0"
            title="Queue"
            subtitle={`${fmt(rows.length)} action(s)${status === 'OVERDUE' ? ' past their committed date' : status === 'PENDING_VERIFICATION' ? ' awaiting a manager decision' : ''}`}
            right={
              <div className="flex items-center gap-1.5">
                <Input className="h-7 w-[170px] text-[11.5px]" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this view…" />
                <Select className="h-7 w-[140px] text-[11.5px]" value={mineId} onChange={(e) => setQ('mine_id', e.target.value)}>
                  <option value="">All mines</option>
                  {boot?.mines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name.split(' ')[0]}
                    </option>
                  ))}
                </Select>
                <Select className="h-7 w-[150px] text-[11.5px]" value={owner} onChange={(e) => setQ('owner', e.target.value)}>
                  <option value="">All owners</option>
                  {byOwner.map((o) => (
                    <option key={o.owner} value={boot?.users.find((u) => u.name === o.owner)?.id ?? ''}>
                      {o.owner} ({o.count})
                    </option>
                  ))}
                </Select>
              </div>
            }
          >
            {error && (
              <div className="p-3">
                <ErrorState message={error} onRetry={reload} />
              </div>
            )}
            {loading && !data && (
              <div className="space-y-1.5 p-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}
            {!loading && rows.length === 0 && !error && (
              <EmptyState
                icon="check"
                title={status === 'OVERDUE' ? 'Nothing overdue in this view' : 'No actions match'}
                body={status === 'OVERDUE' ? 'The committed dates on this filtered set are all still in the future.' : 'Change the stage filter or clear the search to see the rest of the queue.'}
                action={
                  <Button size="sm" onClick={() => setQ('status', 'ALL')}>
                    Show all actions
                  </Button>
                }
                className="py-10"
              />
            )}
            <ul className="divide-y divide-[color:var(--line)]">
              {rows.map((a) => {
                const mine = a.assigned_to === actor?.id
                const canVerify = a.status === 'SUBMITTED' && (actor?.role === 'MANAGER' || actor?.role === 'ADMIN')
                const isOpen = expanded === a.id
                const progress = ACTION_PROGRESS[a.status] ?? 0
                return (
                  <li key={a.id} className={cx('px-3 py-2.5 transition-colors', a.is_overdue ? 'bg-[color:var(--danger)]/5' : 'hover:bg-sunken')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10.5px] text-ink-faint">{a.id}</span>
                      <Badge tone={severityTone(a.violation_severity) as any}>{a.violation_severity}</Badge>
                      <Badge tone={(a.is_overdue ? 'high' : a.status === 'SUBMITTED' ? 'elevated' : a.status === 'VERIFIED' || a.status === 'CLOSED' ? 'low' : 'moderate') as any}>
                        {a.is_overdue ? `${a.days_overdue}d overdue` : humanize(a.status)}
                      </Badge>
                      {mine && <span className="rounded border border-[color:var(--accent)]/40 px-1 text-[9.5px] text-[color:var(--accent)]">yours</span>}
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{a.description}</span>
                      <span className="hidden shrink-0 text-[10.5px] text-ink-faint md:block">{a.zone_short} · {a.mine_name}</span>
                      <Tooltip tip={`Due ${fmtDate(a.due_date)} · raised ${relative(a.created_at)}`}>
                        <span className={cx('shrink-0 font-mono text-[10.5px]', a.is_overdue ? 'text-[color:var(--danger)]' : 'text-ink-faint')}>{a.due_date ? fmtDate(a.due_date) : 'no date'}</span>
                      </Tooltip>
                      <button onClick={() => setExpanded(isOpen ? null : a.id)} className="shrink-0 text-ink-faint hover:text-ink" aria-label={isOpen ? 'Collapse action' : 'Expand action'}>
                        <Icon name="chevron" className={cx('h-3.5 w-3.5 transition-transform', isOpen ? 'rotate-180' : '')} />
                      </button>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="flex items-center gap-1.5">
                        <Avatar name={a.owner_name ?? a.assigned_to} className="h-5 w-5 text-[9px]" />
                        <span className="text-[10.5px] text-ink-dim">{a.owner_name ?? a.assigned_to}</span>
                      </span>
                      <span className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-sm bg-sunken">
                        <span className="block h-full transition-all" style={{ width: `${progress}%`, background: a.is_overdue ? 'var(--risk-high)' : 'var(--accent)' }} />
                      </span>
                      <span className="font-mono text-[10px] text-ink-faint">{progress}%</span>
                      <div className="ml-auto flex flex-wrap items-center gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setViolationOpen(a.violation_id)}>
                          Violation {a.violation_id}
                        </Button>
                        {(mine || actor?.role === 'ADMIN') && a.status === 'ASSIGNED' && (
                          <Button size="sm" variant="outline" onClick={() => patch(a.id, { status: 'IN_PROGRESS' }, `${a.id} started`)}>
                            Start work
                          </Button>
                        )}
                        {(mine || actor?.role === 'ADMIN') && a.status === 'IN_PROGRESS' && (
                          <Button size="sm" variant="outline" onClick={() => setExpanded(a.id)} disabled={!a.resolution_notes} title={a.resolution_notes ? '' : 'Add resolution notes and evidence first'}>
                            Submit for verification
                          </Button>
                        )}
                        {canVerify && <Button size="sm" variant="primary" onClick={() => setExpanded(a.id)}>Verify now</Button>}
                      </div>
                    </div>

                    {isOpen && (
                      <ActionEditor
                        action={a}
                        canVerify={canVerify}
                        isOwner={mine || actor?.role === 'ADMIN'}
                        onClose={() => setExpanded(null)}
                        onPatch={async (body, success) => {
                          const res = await patch(a.id, body, success)
                          if (res) reload()
                        }}
                        onOpenViolation={() => setViolationOpen(a.violation_id)}
                        onGoViolations={() => navigate(`/violations?zone=${a.zone_id}`)}
                        pushToast={pushToast}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </Panel>

          <div className="space-y-3">
            <Panel title="Owner load" subtitle="Open items by officer — overdue in red">
              {byOwner.length === 0 ? (
                <EmptyState icon="user" title="Nobody is carrying actions in this view" className="py-6" />
              ) : (
                <BarRowChart
                  items={byOwner.map((o) => ({ label: o.owner, value: o.count, tone: o.overdue ? 'var(--risk-high)' : 'var(--accent)', sub: o.overdue ? `${o.overdue} overdue` : 'on schedule' }))}
                  unit=""
                />
              )}
            </Panel>

            <Panel title="How the chain closes" subtitle="Enforced by the API, shown here so the queue makes sense">
              <ol className="space-y-1.5">
                {ACTION_FLOW.map((s, i) => (
                  <li key={s} className="flex items-center gap-2 text-[11.5px]">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line font-mono text-[8px] text-ink-faint">{i + 1}</span>
                    <span className="text-ink-dim">{humanize(s)}</span>
                    <span className="ml-auto text-[10px] text-ink-faint">
                      {s === 'ASSIGNED' ? 'officer' : s === 'IN_PROGRESS' ? 'officer' : s === 'SUBMITTED' ? 'officer + evidence' : s === 'VERIFIED' ? 'manager only' : 'auto on verification'}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 rounded border border-dashed border-line bg-sunken p-2 text-[10.5px] leading-snug text-ink-faint">
                Verification is what removes the unresolved and overdue weight from the zone score. Until then the finding keeps accruing age — that is the engine's own behaviour, not a UI device.
              </div>
              <Button size="sm" className="mt-2 w-full" variant="outline" onClick={() => navigate('/violations?status=OVERDUE')}>
                See overdue violations instead
              </Button>
            </Panel>

            <Panel title="Your queue" subtitle={actor ? `${actor.name} · ${actor.designation ?? humanize(actor.role)}` : undefined}>
              {actor ? (
                <ul className="space-y-1">
                  {(data?.actions ?? []).filter((a: ActionRow) => a.assigned_to === actor.id).slice(0, 6).map((a: ActionRow) => (
                    <li key={a.id}>
                      <button onClick={() => setExpanded(a.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-sunken">
                        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', a.is_overdue ? 'bg-[color:var(--danger)]' : 'bg-[color:var(--accent)]')} />
                        <span className="min-w-0 flex-1 truncate text-[11px]">{a.violation_category}</span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-faint">{a.zone_short}</span>
                      </button>
                    </li>
                  ))}
                  {(data?.actions ?? []).filter((a: ActionRow) => a.assigned_to === actor.id).length === 0 && (
                    <li className="px-1 py-2 text-[11px] text-ink-faint">Nothing is currently assigned to {actor.name} in this view.</li>
                  )}
                </ul>
              ) : (
                <EmptyState icon="user" title="Select an identity" body="The queue is owner-aware; pick a user in the top bar to see their load." className="py-6" />
              )}
            </Panel>
          </div>
        </div>
      </PageBody>

      <ViolationDrawer violationId={violationOpen} onClose={() => setViolationOpen(null)} onChanged={reload} />
    </>
  )
}

function ActionEditor({
  action,
  canVerify,
  isOwner,
  onClose,
  onPatch,
  onOpenViolation,
  onGoViolations,
  pushToast,
}: {
  action: ActionRow
  canVerify: boolean
  isOwner: boolean
  onClose: () => void
  onPatch: (body: Record<string, unknown>, success: string) => Promise<any>
  onOpenViolation: () => void
  onGoViolations: () => void
  pushToast: (t: { kind: 'success' | 'error' | 'info'; title: string; body?: string }) => void
}) {
  const [resolution, setResolution] = useState(action.resolution_notes ?? '')
  const [evidence, setEvidence] = useState('')
  const [verdict, setVerdict] = useState(action.verification_notes ?? '')
  const [due, setDue] = useState(action.due_date ?? '')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2.5 grid gap-3 rounded border border-line bg-sunken p-2.5 lg:grid-cols-2">
      <div>
        <div className="label mb-1">Finding this action exists to clear</div>
        <p className="text-[11.5px] leading-snug text-ink-dim">{action.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={onOpenViolation}>
            Open {action.violation_id}
          </Button>
          <Button size="sm" variant="ghost" onClick={onGoViolations}>
            All {action.zone_short} violations
          </Button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
          <Row label="Category" value={action.violation_category} />
          <Row label="Violation status" value={humanize(action.violation_status)} />
          <Row label="Raised" value={`${relative(action.created_at)}`} />
          <Row label="Started" value={action.started_at ? relative(action.started_at) : 'not started'} />
          <Row label="Evidence items" value={`${action.evidence_count}`} />
          <Row label="Priority" value={action.priority} />
        </dl>
        {isOwner && (
          <Field className="mt-2" label="Re-commit the due date" hint="Used when a re-plan is agreed; recorded on the action">
            <div className="flex gap-1.5">
              <Input type="date" className="h-7 w-[150px] text-[11.5px]" value={due} onChange={(e) => setDue(e.target.value)} />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !due}
                onClick={() => run(() => onPatch({ due_date: due }, 'Due date updated'))}
              >
                Save date
              </Button>
            </div>
          </Field>
        )}
      </div>

      <div className="space-y-2.5">
        <div>
          <div className="label mb-1">Officer submission</div>
          <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done, when, by which crew, what was re-tested…" disabled={action.status === 'VERIFIED' || action.status === 'CLOSED'} />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Input className="h-7 flex-1 text-[11.5px]" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="evidence file reference (e.g. photo-01.jpg)" />
            <Button
              size="sm"
              variant="outline"
              disabled={!evidence.trim() || action.status === 'VERIFIED' || action.status === 'CLOSED'}
              onClick={() =>
                run(() =>
                  api.post('/api/evidence', {
                    action_id: action.id,
                    violation_id: action.violation_id,
                    file_name: evidence.trim(),
                    kind: 'RESOLUTION',
                    note: resolution || 'Evidence attached from the field',
                  }),
                )
                  .then(() => pushToast({ kind: 'success', title: 'Evidence attached', body: `${evidence.trim()} is on ${action.violation_id}.` }))
                  .catch(() => undefined)
              }
              icon={<Icon name="upload" className="h-3 w-3" />}
            >
              Attach
            </Button>
          </div>
          {isOwner && action.status !== 'SUBMITTED' && action.status !== 'VERIFIED' && action.status !== 'CLOSED' && (
            <Button
              size="sm"
              variant="primary"
              className="mt-1.5"
              disabled={resolution.trim().length < 10 || busy}
              loading={busy}
              onClick={() =>
                run(async () => {
                  if (evidence.trim()) await api.post('/api/evidence', { action_id: action.id, violation_id: action.violation_id, file_name: evidence.trim(), kind: 'RESOLUTION', note: resolution }).catch(() => null)
                  await onPatch({ status: 'SUBMITTED', resolution_notes: resolution.trim() }, `${action.id} submitted for verification`)
                })
              }
            >
              Submit for verification
            </Button>
          )}
          {isOwner && action.status === 'ASSIGNED' && (
            <Button size="sm" className="mt-1.5" variant="outline" disabled={busy} onClick={() => run(() => onPatch({ status: 'IN_PROGRESS' }, `${action.id} started`))}>
              Mark work started
            </Button>
          )}
        </div>

        {canVerify ? (
          <div className="rounded border border-[color:var(--accent)]/35 bg-[color:var(--accent)]/6 p-2">
            <div className="label mb-1">Manager verification</div>
            <Textarea rows={2} value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="What you checked and how — becomes the audit note" />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={verdict.trim().length < 8} loading={busy} onClick={() => run(() => onPatch({ status: 'VERIFIED', verification_notes: verdict.trim() }, `${action.id} verified — violation closed`))}>
                Approve & close
              </Button>
              <Button size="sm" variant="danger" disabled={verdict.trim().length < 8} loading={busy} onClick={() => run(() => onPatch({ status: 'REJECTED', verification_notes: verdict.trim() }, `${action.id} rejected — back to the officer`))}>
                Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-line bg-panel p-2 text-[10.5px] leading-snug text-ink-faint">
            {action.status === 'SUBMITTED' ? 'Awaiting a manager or admin decision — you cannot verify an action you submitted.' : action.resolution_notes ? `Last submitted ${relative(action.completed_at ?? action.created_at)}: “${action.resolution_notes}”` : 'No submission yet.'}
            {action.verified_at && ` Verified ${fmtDate(action.verified_at)}.`}
            {action.can_verify === false && ' Verification rights belong to MANAGER / ADMIN.'}
          </div>
        )}
        {action.verification_notes && (
          <div className="rounded border border-line bg-panel p-2 text-[10.5px] text-ink-dim">
            <span className="label">Verifier note</span> {action.verification_notes}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="truncate text-ink-faint">{label}</dt>
      <dd className="truncate text-right text-ink-dim">{value}</dd>
    </>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="panel p-3">
      <div className="label">{label}</div>
      <div className="kpi-value" style={{ color: tone }}>
        {value}
      </div>
      <div className="text-[10.5px] text-ink-faint">{hint}</div>
    </div>
  )
}
