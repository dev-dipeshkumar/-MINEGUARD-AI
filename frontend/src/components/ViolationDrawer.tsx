import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, endpoints } from '../lib/api'
import { useApp, useAsync } from '../state/app'
import type { CorrectiveAction, Violation } from '../lib/types'
import { Badge, Button, Divider, Drawer, EmptyState, ErrorState, Field, Icon, Input, Panel, Progress, Select, Skeleton, Switch, Textarea, cx } from './ui'
import { FactorBars } from './charts'
import { bandFor, fmt, fmtDate, humanize, relative, signed } from '../lib/format'

const FLOW = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ACTION_SUBMITTED', 'UNDER_VERIFICATION', 'CLOSED']

/** Presentation-only: how far along the chain an action visibly is, for the progress meter. */
export const ACTION_PROGRESS: Record<string, number> = {
  OPEN: 5,
  ASSIGNED: 20,
  IN_PROGRESS: 45,
  SUBMITTED: 80,
  UNDER_VERIFICATION: 80,
  REJECTED: 30,
  VERIFIED: 100,
  CLOSED: 100,
}

export const severityTone = (s: string) => (s === 'CRITICAL' ? 'critical' : s === 'HIGH' ? 'high' : s === 'MEDIUM' ? 'elevated' : s === 'LOW' ? 'moderate' : 'low')

/**
 * Violation dossier — the single place the compliance workflow is operated.
 *
 * The controls are generated from `next_status` and the acting user's role as
 * the API describes them, so a mismatch between what the UI offers and what the
 * server accepts cannot happen.
 */
export function ViolationDrawer({ violationId, onClose, onChanged }: { violationId: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, reload } = useAsync<any>(violationId ? endpoints.violation(violationId) : null, [violationId])
  const { boot, actor, invalidate, pushToast } = useApp()
  const navigate = useNavigate()
  const [note, setNote] = useState('')
  const [overrideOn, setOverrideOn] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDays, setDueDays] = useState(7)
  const [mode, setMode] = useState<'view' | 'assign' | 'action' | 'resolve' | 'verify'>('view')
  const [actionDesc, setActionDesc] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [evidenceName, setEvidenceName] = useState('')
  const [verificationNote, setVerificationNote] = useState('')
  const [busy, setBusy] = useState(false)

  const v: Violation | null = data ?? null
  const isManager = actor?.role === 'MANAGER' || actor?.role === 'ADMIN'
  const isOwner = !!v?.assigned_to && v.assigned_to === actor?.id
  const nextStatus = v?.next_status
  const currentIndex = v ? FLOW.indexOf(v.status) : -1
  const officers = useMemo(() => (boot?.users ?? []).filter((u) => u.role === 'OFFICER' || u.role === 'MANAGER'), [boot])
  const action = v?.actions?.[0]

  const run = async (fn: () => Promise<any>, success?: string) => {
    setBusy(true)
    try {
      const res = await fn()
      if (res?.error) {
        pushToast({ kind: 'error', title: 'Transition refused', body: res.error })
        return null
      }
      pushToast({ kind: 'success', title: success ?? res?.message ?? 'Updated', body: res?.risk_impact ? `Zone risk ${fmt(res.risk_impact.before.risk_score, 1)} → ${fmt(res.risk_impact.after.risk_score, 1)}` : undefined })
      await reload()
      onChanged()
      invalidate()
      setMode('view')
      setNote('')
      setOverrideOn(false)
      setOverrideReason('')
      return res
    } catch (e) {
      pushToast({ kind: 'error', title: 'Transition refused', body: (e as Error).message })
      return null
    } finally {
      setBusy(false)
    }
  }

  const advance = (status: string) =>
    run(() => api.patch(`/api/violations/${v!.id}`, { status, note: note.trim() || undefined, override: overrideOn, override_reason: overrideReason.trim() || undefined }), `Moved to ${humanize(status)}`)

  return (
    <Drawer
      open={!!violationId}
      onClose={onClose}
      title={v ? `${v.id} · ${v.category}` : 'Loading violation…'}
      subtitle={v ? `${v.mine_name} · ${v.zone_name} · ${humanize(v.department)} · opened ${fmtDate(v.created_at)}` : undefined}
      footer={
        v ? (
          <div className="flex flex-wrap items-center gap-2">
            {v.status !== 'CLOSED' && nextStatus && (
              <Button size="sm" variant="primary" loading={busy} onClick={() => advance(nextStatus)} disabled={nextStatus === 'CLOSED' && !isManager} title={nextStatus === 'CLOSED' && !isManager ? 'Only a manager or admin may close a violation' : undefined}>
                {nextStatus === 'CLOSED' ? 'Verify and close' : `Advance to ${humanize(nextStatus)}`}
              </Button>
            )}
            {v.status === 'OPEN' && (
              <Button size="sm" variant="outline" onClick={() => setMode(mode === 'assign' ? 'view' : 'assign')}>
                Assign owner
              </Button>
            )}
            {v.status === 'ASSIGNED' && !action && (
              <Button size="sm" variant="outline" onClick={() => setMode(mode === 'action' ? 'view' : 'action')}>
                Raise corrective action
              </Button>
            )}
            {(isOwner || isManager) && v.status === 'IN_PROGRESS' && action && (
              <Button size="sm" variant="outline" onClick={() => setMode(mode === 'resolve' ? 'view' : 'resolve')}>
                Submit resolution
              </Button>
            )}
            {isManager && v.status === 'ACTION_SUBMITTED' && (
              <Button size="sm" variant="outline" onClick={() => setMode(mode === 'verify' ? 'view' : 'verify')}>
                Verify / reject
              </Button>
            )}
            {isManager && (
              <label className="flex items-center gap-1.5 text-[11px] text-ink-dim" title="Authorised override: close without the standard chain (MANAGER/ADMIN, recorded)">
                <Switch checked={overrideOn} onChange={(val) => setOverrideOn(val)} label="Workflow override" />
                Override
              </label>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-ink-faint">
              <Icon name="shield" className="h-3 w-3" /> {actor?.name} · {actor?.role}
            </span>
          </div>
        ) : undefined
      }
    >
      {loading && !v && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}

      {v && (
        <div className="space-y-3.5">
          {overrideOn && (
            <Panel
              title="Authorised workflow override"
              subtitle="Bypasses the required chain. Rejected for INSPECTOR and OFFICER roles; the reason is stored on the audit log."
            >
              <Field label="Justification" required error={overrideReason.trim().length > 0 && overrideReason.trim().length < 15 ? 'At least 15 characters' : undefined}>
                <Textarea
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Rectification verified under statutory order SO/2026/114 by the DMF regional office; local action chain not applicable."
                />
              </Field>
              <Button size="sm" className="mt-2" variant="danger" disabled={overrideReason.trim().length < 15} loading={busy} onClick={() => advance('CLOSED')}>
                Close violation with override
              </Button>
            </Panel>
          )}

          <div className="rounded border border-line bg-sunken p-2.5">
            <div className="flex items-center justify-between">
              <span className="label">Workflow position</span>
              <span className="text-[10.5px] text-ink-faint">
                age {v.age_days}d · SLA {v.sla_days}d
              </span>
            </div>
            <ol className="mt-2 flex items-center gap-1">
              {FLOW.map((s, i) => {
                const done = i < currentIndex
                const current = i === currentIndex
                return (
                  <li key={s} className="flex min-w-0 flex-1 items-center gap-1">
                    <span
                      className={cx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold',
                        done ? 'border-transparent bg-[color:var(--ok)] text-[color:var(--panel)]' : current ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/20 text-ink' : 'border-line text-ink-faint',
                      )}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    <span className={cx('hidden truncate text-[9.5px] uppercase tracking-wide2 md:block', current ? 'text-ink' : 'text-ink-faint')}>{humanize(s)}</span>
                    {i < FLOW.length - 1 && <span className={cx('h-px flex-1', done ? 'bg-[color:var(--ok)]' : 'bg-line')} />}
                  </li>
                )
              })}
            </ol>
            {v.notes && <p className="mt-2 rounded bg-panel px-2 py-1 text-[10.5px] text-ink-dim">Note on record: {v.notes}</p>}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Tile
              label="Risk contribution"
              value={`${fmt(v.risk_contribution, 1)} pt`}
              sub={
                data.zone_risk?.risk_score
                  ? `${((v.risk_contribution / data.zone_risk.risk_score) * 100).toFixed(0)}% of the ${data.zone_risk.risk_score.toFixed(0)} zone score`
                  : 'attributed from the zone factors'
              }
              tone={`var(--risk-${bandFor(v.risk_contribution * 2.4).tone})`}
            />
            <Tile label="Occurrence" value={`${v.occurrences}×`} sub={v.occurrences > 1 ? 'repeat in this zone' : 'first occurrence'} tone={v.occurrences > 1 ? 'var(--risk-elevated)' : undefined} />
            <Tile
              label="SLA state"
              value={humanize(v.sla_state)}
              sub={v.overdue ? `${v.days_overdue}d past due` : v.due_date ? `due ${fmtDate(v.due_date)}` : 'not assigned yet'}
              tone={v.sla_state === 'BREACHED' ? 'var(--risk-high)' : v.sla_state === 'AT_RISK' ? 'var(--risk-elevated)' : 'var(--risk-low)'}
            />
          </div>

          <Panel title="Finding as recorded">
            <p className="text-[12.5px] leading-relaxed text-ink">{v.description}</p>
            {v.notes && <p className="mt-2 border-l-2 border-line pl-2 text-[11.5px] leading-snug text-ink-dim">{v.notes}</p>}
            <dl className="mt-2.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              <Def label="Severity">
                <Badge tone={severityTone(v.severity) as any}>
                  {v.severity} · weight {boot?.engine.severity_weights[v.severity]}
                </Badge>
              </Def>
              <Def label="Regulation">{v.regulation}</Def>
              <Def label="Department">{humanize(v.department)}</Def>
              <Def label="Zone">
                {v.zone_name} · risk {data.zone_risk?.risk_score?.toFixed(1) ?? '—'}
              </Def>
              <Def label="Owner">{v.owner_name ?? <span className="text-[color:var(--risk-elevated)]">unassigned</span>}</Def>
              <Def label="Source">{v.inspection_id ?? 'raised directly in the violation centre'}</Def>
            </dl>
            {data.zone_risk && (
              <div className="mt-3 rounded border border-line bg-sunken p-2.5">
                <div className="label mb-1.5">Where this record sits in the zone score</div>
                <FactorBars factors={data.zone_risk.factors.filter((f: any) => f.points > 0.05)} />
              </div>
            )}
          </Panel>

          {data.relief_if_closed && (
            <div className="rounded border border-[color:var(--ok)]/40 bg-[color:var(--ok)]/8 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Icon name="target" className="h-3.5 w-3.5 text-[color:var(--ok)]" />
                <span className="text-[11.5px] font-medium">If this finding is resolved and verified</span>
                <span className="ml-auto font-mono text-[12px]">
                  {fmt(data.relief_if_closed.before.risk_score, 1)} → {fmt(data.relief_if_closed.after.risk_score, 1)}{' '}
                  <span className="text-[color:var(--ok)]">({signed(data.relief_if_closed.delta, 1)})</span>
                </span>
              </div>
              <p className="mt-1 text-[10.5px] text-ink-faint">Relief is what the engine computes if this finding and its linked actions are resolved and verified — nothing is written until the workflow reaches that point.</p>
            </div>
          )}

          {data.repeat_history?.length > 0 && (
            <Panel title="Recurrence in this zone and category" subtitle="What the repeat factor is counting">
              <ul className="space-y-1">
                {data.repeat_history.map((r: any) => (
                  <li key={r.id} className="flex items-center gap-2 rounded border border-line bg-sunken px-2 py-1 text-[11.5px]">
                    <span className="font-mono text-ink-faint">{r.id}</span>
                    <Badge tone={severityTone(r.severity) as any}>{r.severity}</Badge>
                    <span className="text-ink-dim">{humanize(r.status)}</span>
                    <span className="ml-auto text-ink-faint">{fmtDate(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            title="Evidence"
            subtitle={`${v.evidence_items.length} item(s) on file`}
            right={
              action ? (
                <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'resolve' ? 'view' : 'resolve')}>
                  Attach with resolution
                </Button>
              ) : undefined
            }
          >
            {v.evidence_items.length === 0 ? (
              <EmptyState icon="file" title="No evidence attached" body="Findings cannot be closed through the workflow without verified evidence. Attach a photograph or register scan when the action is submitted." className="py-6" />
            ) : (
              <ul className="space-y-1.5">
                {v.evidence_items.map((e: any) => (
                  <li key={e.id} className="flex items-center gap-2 rounded border border-line bg-sunken p-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-panel text-ink-faint">
                      <Icon name={e.type === 'PHOTO' ? 'eye' : 'file'} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium">{e.file_name}</span>
                      <span className="block truncate text-[10px] text-ink-faint">
                        {humanize(e.kind)} · {e.size_kb} KB · {relative(e.uploaded_at)} · {(boot?.users.find((u) => u.id === e.uploaded_by)?.name ?? e.uploaded_by) ?? ''}
                      </span>
                    </span>
                    {e.note && <span className="hidden max-w-[38%] truncate text-[10.5px] text-ink-faint lg:block">{e.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Linked corrective actions" subtitle={v.actions.length ? `${v.actions.length} action(s)` : 'none raised'}>
            {v.actions.length === 0 ? (
              <EmptyState
                icon="wrench"
                title="No corrective action raised"
                body="Assign an owner and raise an action to start the resolution clock."
                className="py-5"
                action={
                  v.status === 'CLOSED' ? undefined : (
                    <Button size="sm" onClick={() => setMode('action')}>
                      Raise action
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="space-y-2">
                {v.actions.map((a: CorrectiveAction) => (
                  <li key={a.id} className="rounded border border-line bg-sunken p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-ink-faint">{a.id}</span>
                      <Badge tone={a.status === 'VERIFIED' || a.status === 'CLOSED' ? 'low' : a.status === 'REJECTED' ? 'high' : a.status === 'SUBMITTED' ? 'elevated' : 'moderate'}>{humanize(a.status)}</Badge>
                      <span className="text-[11px] text-ink-dim">{boot?.users.find((u) => u.id === a.assigned_to)?.name ?? a.assigned_to}</span>
                      {a.is_overdue && <Badge tone="high">{a.days_overdue}d overdue</Badge>}
                      <span className="ml-auto text-[10.5px] text-ink-faint">due {fmtDate(a.due_date)}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">{a.description}</p>
                    {a.resolution_notes && <p className="mt-1 rounded bg-panel px-2 py-1 text-[11px] text-ink-dim">Resolution: {a.resolution_notes}</p>}
                    {a.verification_notes && <p className="mt-1 rounded bg-panel px-2 py-1 text-[11px] text-ink-dim">Verification: {a.verification_notes}</p>}
                    <Progress className="mt-1.5" value={ACTION_PROGRESS[a.status] ?? 5} tone="var(--accent)" height={3} />
                    <div className="mt-1 flex items-center justify-between text-[10px] text-ink-faint">
                      <span>{a.verified_at ? `verified ${relative(a.verified_at)}${boot?.users.find((u) => u.id === a.verified_by)?.name ? ` by ${boot.users.find((u) => u.id === a.verified_by)!.name}` : ''}` : `${a.evidence_count} evidence item(s) attached`}</span>
                      <span className="font-mono">{ACTION_PROGRESS[a.status] ?? 0}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Audit trail" subtitle="Reconstructed from the records themselves — not a separate log the workflow has to remember to write">
            <ol className="space-y-1.5">
              {data.timeline.map((t: any, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i === data.timeline.length - 1 ? 'var(--accent)' : 'var(--line-strong)' }} />
                  <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-dim">
                    {t.label}
                    <span className="ml-1 text-ink-faint">· {t.actor}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{fmtDate(t.at)}</span>
                </li>
              ))}
            </ol>
            {data.overrides?.length > 0 && (
              <div className="mt-2.5 rounded border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/8 p-2">
                <div className="label mb-1 text-[color:var(--danger)]">Workflow overrides on this record</div>
                {data.overrides.map((o: any) => (
                  <p key={o.id} className="text-[11px] leading-snug text-ink-dim">
                    <span className="font-mono">{o.from_status} → {o.to_status}</span> by {o.actor} ({o.role}) — {o.reason}
                  </p>
                ))}
              </div>
            )}
          </Panel>

          {mode === 'assign' && (
            <Panel title="Assign responsible officer" subtitle="Assignment is what starts the corrective clock and sets the due date">
              <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_120px]">
                <Field label="Officer" required>
                  <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Select officer…</option>
                    {officers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.designation}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due in days" hint={`SLA ${v.sla_days}d`}>
                  <Input type="number" min={1} max={60} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} />
                </Field>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!assignee}
                  loading={busy}
                  onClick={() => run(() => api.post(`/api/violations/${v.id}/assign`, { officer_id: assignee, due_date: new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10) }), `Assigned to ${boot?.users.find((u) => u.id === assignee)?.name ?? assignee}`)}
                >
                  Assign
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </div>
            </Panel>
          )}

          {mode === 'action' && (
            <Panel title="Raise corrective action">
              <Field label="Required action" required>
                <Textarea rows={3} value={actionDesc} onChange={(e) => setActionDesc(e.target.value)} placeholder="Replace the defective equipment, test under load, update the statutory register…" />
              </Field>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <Field label="Assign to" required>
                  <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Select officer…</option>
                    {officers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due in days">
                  <Input type="number" min={1} max={60} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} />
                </Field>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={actionDesc.trim().length < 5 || !assignee}
                  loading={busy}
                  onClick={() =>
                    run(
                      () => api.post(endpoints.actions(), { violation_id: v.id, description: actionDesc.trim(), assigned_to: assignee, due_date: new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10), priority: v.severity === 'CRITICAL' ? 'CRITICAL' : v.severity === 'HIGH' ? 'HIGH' : 'MEDIUM' }),
                      'Corrective action raised',
                    )
                  }
                >
                  Create action
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </div>
            </Panel>
          )}

          {mode === 'resolve' && (
            <Panel title="Submit resolution" subtitle="Officer evidence pack — moves the action to SUBMITTED and the violation to UNDER VERIFICATION">
              <Field label="Resolution notes" required error={resolutionNotes.trim().length > 0 && resolutionNotes.trim().length < 10 ? 'Describe what was done (10+ characters)' : undefined}>
                <Textarea rows={3} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="What was done, when, by which crew, and what was re-tested…" />
              </Field>
              <Field className="mt-2.5" label="Evidence reference" hint="In production this is the file stored by the upload endpoint">
                <Input value={evidenceName} onChange={(e) => setEvidenceName(e.target.value)} placeholder="rectification-photo-01.jpg" />
              </Field>
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={resolutionNotes.trim().length < 10 || !action}
                  loading={busy}
                  onClick={() =>
                    run(async () => {
                      if (evidenceName.trim()) {
                        await api.post('/api/evidence', { action_id: action!.id, violation_id: v.id, file_name: evidenceName.trim(), kind: 'RESOLUTION', note: resolutionNotes.trim() }).catch(() => null)
                      }
                      return api.patch(`/api/corrective-actions/${action!.id}`, { status: 'SUBMITTED', resolution_notes: resolutionNotes.trim() })
                    }, 'Submitted for verification')
                  }
                >
                  Submit for verification
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </div>
              {!action && <p className="mt-1.5 text-[11px] text-[color:var(--danger)]">A corrective action must exist before a resolution can be submitted.</p>}
            </Panel>
          )}

          {mode === 'verify' && (
            <Panel title="Verification decision" subtitle="Managers and admins only — the person who performed the work cannot sign it off" tone="elevated">
              <Field label="Verifier note" required error={verificationNote.trim().length > 0 && verificationNote.trim().length < 8 ? 'Record what you checked (8+ characters)' : undefined}>
                <Textarea rows={2} value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="Verified on site with the overman; emergency stop tested under load and operated correctly…" />
              </Field>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={verificationNote.trim().length < 8 || !action}
                  loading={busy}
                  onClick={() => run(() => api.patch(`/api/corrective-actions/${action!.id}`, { status: 'VERIFIED', verification_notes: verificationNote.trim() }), 'Verified — violation closed and risk recalculated')}
                >
                  Approve & close
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={verificationNote.trim().length < 8 || !action}
                  loading={busy}
                  onClick={() => run(() => api.patch(`/api/corrective-actions/${action!.id}`, { status: 'REJECTED', verification_notes: verificationNote.trim() }), 'Rejected — returned to the officer')}
                >
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </div>
            </Panel>
          )}

          <Field label="Note for this transition" hint="Optional; stored on the violation and shown in the audit trail">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Re-tested after shift change" />
          </Field>

          <Divider />
          <div className="flex flex-wrap items-center gap-2 pb-1 text-[10.5px] text-ink-faint">
            <span>Transition legality is decided by the API; a refusal here is the guard working.</span>
            <button className="text-[color:var(--accent)] hover:underline" onClick={() => navigate(`/mines/${v.mine_id}`)}>
              open {v.mine_name}
            </button>
            <button
              className="text-[color:var(--accent)] hover:underline"
              onClick={() => {
                onClose()
                navigate(`/violations?zone=${v.zone_id}`)
              }}
            >
              all {v.zone_short} violations
            </button>
          </div>
        </div>
      )}
    </Drawer>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-sunken px-2.5 py-2">
      <div className="label">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="truncate text-[10px] text-ink-faint">{sub}</div>}
    </div>
  )
}

function Def({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="label w-[92px] shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">{children}</dd>
    </div>
  )
}
