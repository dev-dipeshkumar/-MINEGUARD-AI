import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Field, Icon, Input, Panel, Progress, SegmentedControl, Select, Skeleton, Switch, Textarea, cx } from '../components/ui'
import { TrendChart } from '../components/charts'
import { ZoneDrawer } from '../components/ZoneDrawer'
import { ScoreDelta } from '../components/risk'
import { useApp, useAsync } from '../state/app'
import { api, endpoints } from '../lib/api'
import type { Impact, SimulationResult } from '../lib/types'
import { fmt, fmtDate, humanize, relative, signed } from '../lib/format'

/**
 * Module 4 — inspection management, built for the tablet in the pit first.
 *
 * The form differs from a generic admin form in one important way: it projects
 * the risk consequence *before* submission by calling the same engine with a
 * hypothetical finding, so the inspector can see what a severity choice does and
 * the manager reviewing it sees the same number the API will store.
 */
export function InspectionsPage() {
  const [params, setParams] = useSearchParams()
  const { boot } = useApp()
  const { data, loading, error, reload } = useAsync<any>(endpoints.inspections('days=120'), [])
  const open = params.get('new') === '1'
  const [tab, setTab] = useState<'log' | 'history'>(open ? 'log' : 'history')
  const [drawer, setDrawer] = useState<string | null>(null)

  useEffect(() => {
    if (open) setTab('log')
  }, [open])

  const total = data?.total ?? 0

  return (
    <>
      <PageHeader
        eyebrow="Module 4 · Field workflow"
        title="Inspection management"
        subtitle="Record the round, attach what you saw, and the platform carries it into violations, corrective actions and risk in the same transaction."
        actions={
          <>
            {!open && (
              <Button size="sm" variant="primary" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => paramsSet(params, setParams, { new: '1' })}>
                New inspection
              </Button>
            )}
            {open && (
              <Button size="sm" variant="ghost" onClick={() => paramsSet(params, setParams, { new: null })}>
                Close form
              </Button>
            )}
          </>
        }
        tabs={
          <SegmentedControl
            value={tab}
            onChange={(v) => setTab(v as any)}
            options={[
              { value: 'history', label: 'Round log', count: total },
              { value: 'log', label: open ? 'Inspection form' : 'Record a round' },
            ]}
          />
        }
      />

      <PageBody className="space-y-3.5">
        {(tab === 'log' || open) && <InspectionForm onClose={() => paramsSet(params, setParams, { new: null })} defaultMine={params.get('mine') ?? undefined} defaultZone={params.get('zone') ?? undefined} />}

        {!(tab === 'log' || open) && (
          <>
            {data?.due_zones?.length ? (
              <Panel title="Zones due a round" subtitle="Ordered by cadence breach then risk — this is the list an inspection schedule should be built from" right={<Badge tone="elevated">{data.due_zones.length} due</Badge>}>
                <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
                  {data.due_zones.map((z: any) => (
                    <div key={z.zone_id} className="flex items-center gap-2 rounded border border-line bg-sunken p-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{z.zone}</span>
                        <span className="block truncate text-[10.5px] text-ink-faint">
                          {z.mine} · {z.department} · {z.open_violations} open
                        </span>
                      </span>
                      <span className="text-right">
                        <span className={cx('block font-mono text-[11px]', z.overdue ? 'text-[color:var(--risk-high)]' : 'text-ink-dim')}>
                          {z.days_since === null ? 'never' : `${z.days_since}d`} / {z.cadence}d
                        </span>
                        <span className="block font-mono text-[10px] text-ink-faint">risk {z.risk_score.toFixed(0)}</span>
                      </span>
                      <Button size="sm" variant="outline" onClick={() => paramsSet(params, setParams, { new: '1', zone: z.zone_id, mine: z.mine })}>
                        Inspect
                      </Button>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}

            {error && <ErrorState message={error} onRetry={reload} />}
            <Panel title="Recorded rounds" subtitle="Newest first" dense>
              {loading && !data ? (
                <div className="space-y-1.5 p-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !data?.inspections?.length ? (
                <EmptyState icon="clipboard" title="No rounds recorded yet" body="Start an inspection to create the first record; findings raised here flow straight into the risk engine." />
              ) : (
                <ul className="divide-y divide-[color:var(--line)]">
                  {data.inspections.map((i: any) => (
                    <li key={i.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-faint">{i.id}</span>
                        <span className="text-[12.5px] font-medium">{i.zone_short}</span>
                        <span className="text-[11px] text-ink-faint">{i.mine_name}</span>
                        <Badge tone={i.overall_rating === 'COMPLIANT' ? 'low' : i.overall_rating === 'NON_COMPLIANT' ? 'high' : 'elevated'}>{humanize(i.overall_rating)}</Badge>
                        <span className="ml-auto flex items-center gap-2 text-[10.5px] text-ink-faint">
                          {i.department} · {i.inspector} · {relative(i.inspection_date)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-dim">{i.observations}</p>
                      {i.violations?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="label">findings</span>
                          {i.violations.map((v: any) => (
                            <button
                              key={v.id}
                              onClick={() => setDrawer(v.zone_id)}
                              className="rounded border border-line bg-sunken px-1.5 py-0.5 text-[10.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                            >
                              <span className="font-mono">{v.id}</span> · <span style={{ color: `var(--risk-${v.severity === 'CRITICAL' ? 'critical' : v.severity === 'HIGH' ? 'high' : v.severity === 'MEDIUM' ? 'elevated' : 'moderate'})` }}>{v.severity}</span> {v.category}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {data?.inspector_load?.length > 0 && (
              <Panel title="Inspector load" subtitle="Rounds recorded and findings raised, trailing 120 days">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {data.inspector_load.map((l: any) => (
                    <div key={l.user.id} className="flex items-center gap-2.5 rounded border border-line bg-sunken p-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-panel font-mono text-[11px] font-semibold text-ink-dim">{l.user.initials}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium">{l.user.name}</div>
                        <div className="text-[10.5px] text-ink-faint">{l.user.designation}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[13px] font-semibold">{l.count}</div>
                        <div className="text-[10px] text-ink-faint">{l.findings} findings</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </PageBody>
      <ZoneDrawer zoneId={drawer} onClose={() => setDrawer(null)} />
    </>
  )
}

type ParamsSetter = (p: URLSearchParams, opts?: { replace?: boolean }) => void

function paramsSet(params: URLSearchParams, setParams: ParamsSetter, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params)
  Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)))
  setParams(next, { replace: true })
}

// ------------------------------------------------------------------- the form
type Finding = {
  key: number
  category: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  notes: string
  assigned_to: string
  due_in_days: number
  create_action: boolean
}

const EMPTY_FINDING = (key: number, severity: 'MEDIUM' = 'MEDIUM'): Finding => ({
  key,
  category: '',
  severity,
  description: '',
  notes: '',
  assigned_to: '',
  due_in_days: 7,
  create_action: true,
})

function InspectionForm({ onClose, defaultMine, defaultZone }: { onClose: () => void; defaultMine?: string; defaultZone?: string }) {
  const { boot, mutate, invalidate, actor } = useApp()
  const navigate = useNavigate()
  const [mineId, setMineId] = useState(defaultMine ?? actor?.mine_id ?? boot?.mines[0]?.id ?? '')
  const [zoneId, setZoneId] = useState(defaultZone ?? '')
  const [department, setDepartment] = useState('SAFETY')
  const [inspectorId, setInspectorId] = useState(actor?.role === 'INSPECTOR' ? actor.id : boot?.users.find((u) => u.role === 'INSPECTOR')?.id ?? '')
  const [date, setDateValue] = useState(new Date().toISOString().slice(0, 10))
  const [observations, setObservations] = useState('')
  const [rating, setRating] = useState<'COMPLIANT' | 'NON_COMPLIANT' | 'NEEDS_ATTENTION'>('NON_COMPLIANT')
  const [evidenceName, setEvidenceName] = useState('')
  const [findings, setFindings] = useState<Finding[]>([{ ...EMPTY_FINDING(1), category: 'Safety Equipment' }])
  const [touched, setTouched] = useState(false)
  const [projection, setProjection] = useState<SimulationResult | null>(null)
  const [submitted, setSubmitted] = useState<{ impact: Impact; violationIds: string[]; inspectionId: string; newAlerts: any[] } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const zone = boot?.zones.find((z) => z.id === zoneId)
  const zones = useMemo(() => (boot?.zones ?? []).filter((z) => z.mine_id === mineId), [boot, mineId])
  const categories = boot?.config.violation_categories[department] ?? []
  const debounce = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!zoneId) {
      setProjection(null)
      return
    }
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(async () => {
      const f = findings[0]
      if (!f?.category) {
        try {
          const res = await api.get<any>(endpoints.zoneRisk(zoneId))
          setProjection(null)
        } catch {
          setProjection(null)
        }
        return
      }
      await api
        .post<SimulationResult>(endpoints.simulate, {
          zone_id: zoneId,
          add_violation: { category: f.category, severity: f.severity, department, description: f.description || 'projected finding' },
        })
        .then(setProjection)
        .catch(() => setProjection(null))
    }, 320)
    return () => window.clearTimeout(debounce.current)
  }, [zoneId, findings, department])

  // A round always belongs to a zone: keep the selection valid when the mine changes,
  // and default to the mine's first zone so the form is never silently incomplete.
  useEffect(() => {
    if (!zones.length) return
    if (!zoneId || !zones.some((z) => z.id === zoneId)) setZoneId(zones[0].id)
  }, [mineId, zones, zoneId])

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!mineId) e.mine = 'Select a mine'
    if (!zoneId) e.zone = 'Select a zone'
    if (!inspectorId) e.inspector = 'Select the inspector on the round'
    if (observations.trim().length < 10) e.observations = 'Describe what was observed (at least 10 characters) — this text is quoted on the record'
    if (!date) e.date = 'Inspection date is required'
    else if (new Date(date) > new Date()) e.date = 'An inspection cannot be dated in the future'
    if (rating === 'COMPLIANT' && findings.length > 0) e.findings = 'A compliant round cannot carry findings. Remove them or change the rating.'
    findings.forEach((f, i) => {
      if (!f.category) e[`f${i}-category`] = 'Category required'
      if (f.description.trim().length < 10) e[`f${i}-description`] = 'Describe the deviation (10+ characters)'
      if (f.assigned_to && f.create_action && !f.due_in_days) e[`f${i}-due`] = 'Set a deadline'
    })
    return e
  }, [mineId, zoneId, inspectorId, observations, date, rating, findings])

  const valid = Object.keys(errors).length === 0

  const submit = async () => {
    setTouched(true)
    if (!valid) {
      document.getElementById('inspection-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setSubmitting(true)
    const payload = {
      mine_id: mineId,
      zone_id: zoneId,
      department,
      inspector_id: inspectorId,
      inspection_date: date,
      observations: observations.trim(),
      overall_rating: rating,
      evidence_file: evidenceName || undefined,
      findings:
        rating === 'COMPLIANT'
          ? []
          : findings.map((f) => ({
              category: f.category,
              severity: f.severity,
              description: f.description.trim(),
              notes: f.notes.trim(),
              evidence_file: evidenceName || undefined,
              assigned_to: f.assigned_to || null,
              due_date: f.assigned_to ? new Date(Date.now() + f.due_in_days * 86400000).toISOString().slice(0, 10) : null,
              create_action: !!f.assigned_to && f.create_action,
            })),
    }
    const res = await mutate<any>(() => api.post(endpoints.inspections(), payload), { success: '' })
    setSubmitting(false)
    if (!res) return
    setSubmitted({
      impact: res.risk_impact,
      violationIds: (res.violations ?? []).map((v: any) => v.id),
      inspectionId: res.inspection.id,
      newAlerts: res.new_alerts ?? [],
    })
    if (res.rejected_findings?.length) {
      mutate(() => Promise.reject(new Error(res.rejected_findings.join(' · '))), { success: '' })
    }
    invalidate()
    setObservations('')
    setFindings([EMPTY_FINDING(Date.now())])
    setEvidenceName('')
  }

  if (submitted) {
    return (
      <Panel
        title="Round recorded — engine response"
        subtitle="This is the submission result straight from the risk engine"
        right={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Back to history
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-sunken p-3">
            <div>
              <div className="label">zone risk after submission</div>
              <div className="mt-1">
                <ScoreDelta impact={submitted.impact} />
              </div>
            </div>
            <div className="min-w-[200px] flex-1">
              <p className="text-[11.5px] leading-snug text-ink-dim">{submitted.impact.explanation}</p>
            </div>
          </div>

          {submitted.impact.factor_delta && submitted.impact.factor_delta.length > 0 && (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {submitted.impact.factor_delta.map((f) => (
                <div key={f.key} className="rounded border border-line bg-sunken p-2">
                  <div className="label">{f.label}</div>
                  <div className="mt-0.5 font-mono text-[12px]">
                    {f.before.toFixed(1)} → <span style={{ color: f.delta > 0 ? 'var(--risk-high)' : 'var(--risk-low)' }}>{f.after.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {submitted.newAlerts.length > 0 && (
            <div className="rounded border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/8 p-2.5">
              <div className="flex items-center gap-2">
                <Icon name="spark" className="h-3.5 w-3.5 text-[color:var(--danger)]" />
                <span className="text-[11px] font-semibold uppercase tracking-wide2 text-ink">Early warnings raised by this round</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {submitted.newAlerts.map((a: any) => (
                  <li key={a.id} className="text-[11.5px] text-ink-dim">
                    <span className="font-mono text-ink-faint">{a.id}</span> — {a.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => navigate(`/violations?search=${submitted.violationIds[0] ?? ''}`)} disabled={!submitted.violationIds.length}>
              {submitted.violationIds.length ? `Open ${submitted.violationIds.length} new violation(s)` : 'No violations raised'}
            </Button>
            <Button size="sm" onClick={() => navigate(`/mines/${mineId}`)}>
              View mine
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSubmitted(null)}>
              Record another round
            </Button>
          </div>
        </div>
      </Panel>
    )
  }

  return (
    <form
      id="inspection-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="grid gap-3.5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]"
    >
      <div className="space-y-3.5">
        <Panel
          title="Inspection record"
          subtitle={`${zone ? `${zone.name} · ${zone.mine_name}` : 'Select the zone walked on this round'}`}
          right={
            <Button size="sm" variant="ghost" onClick={onClose} className="lg:hidden">
              Cancel
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mine" required error={touched ? errors.mine : undefined}>
              <Select name="mine" value={mineId} onChange={(e) => setMineId(e.target.value)} invalid={touched && !!errors.mine}>
                {boot?.mines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.location.split(',')[0]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Zone" required error={touched ? errors.zone : undefined}>
              <Select name="zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} invalid={touched && !!errors.zone}>
                <option value="">Select zone…</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} (risk {z.risk_score.toFixed(0)})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" required hint="Drives which violation categories are offered">
              <SegmentedControl
                value={department}
                onChange={setDepartment}
                options={(boot?.config.departments ?? []).map((d) => ({ value: d, label: humanize(d) }))}
                size="sm"
              />
            </Field>
            <Field label="Inspector" required error={touched ? errors.inspector : undefined}>
              <Select value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} invalid={touched && !!errors.inspector}>
                {boot?.users
                  .filter((u) => u.role === 'INSPECTOR' || u.role === 'OFFICER')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.designation}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Inspection date" required error={touched ? errors.date : undefined}>
              <Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDateValue(e.target.value)} invalid={touched && !!errors.date} />
            </Field>
            <Field label="Overall rating" required>
              <SegmentedControl
                value={rating}
                onChange={(v) => setRating(v as any)}
                size="sm"
                options={[
                  { value: 'COMPLIANT', label: 'Compliant' },
                  { value: 'NEEDS_ATTENTION', label: 'Needs attention' },
                  { value: 'NON_COMPLIANT', label: 'Non-compliant' },
                ]}
              />
            </Field>
          </div>

          <Field className="mt-3" label="Observations" required error={touched ? errors.observations : undefined} hint="Written for the record: what was seen, where, and what was checked.">
            <Textarea
              name="observations"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              invalid={touched && !!errors.observations}
              rows={4}
              placeholder="e.g. Walked CV-1 to CV-3 drives and lamp charging bay. Emergency stop on CV-2 tested twice and did not operate. Register 22-B not updated since…"
            />
          </Field>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Evidence reference" hint="Photo, register scan or document uploaded from the tablet">
              <div className="flex gap-1.5">
                <Input value={evidenceName} onChange={(e) => setEvidenceName(e.target.value)} placeholder="site-photo-01.jpg" />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setEvidenceName(`field-capture-${new Date().toISOString().slice(11, 16).replace(':', '')}.jpg`)}
                  title="Attach a capture reference (files are stored by the API upload endpoint in production)"
                >
                  <Icon name="upload" className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Field>
            <div className="flex items-end">
              <p className="text-[10.5px] leading-snug text-ink-faint">
                Submitting creates the inspection, one violation per finding below, and re-scores the zone, mine and enterprise before the response returns.
              </p>
            </div>
          </div>
        </Panel>

        {rating !== 'COMPLIANT' && (
          <Panel
            title="Findings"
            subtitle="Each finding becomes a violation record with its own severity, owner and deadline"
            right={
              <Button size="sm" variant="outline" type="button" onClick={() => setFindings([...findings, EMPTY_FINDING(findings.length + 1)])} icon={<Icon name="plus" className="h-3 w-3" />}>
                Add finding
              </Button>
            }
          >
            <div className="space-y-2.5">
              {findings.map((f, i) => (
                <div key={f.key} className="rounded border border-line bg-sunken p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="label">Finding {i + 1}</span>
                    {findings.length > 1 && (
                      <button type="button" onClick={() => setFindings(findings.filter((x) => x.key !== f.key))} className="ml-auto text-ink-faint hover:text-[color:var(--danger)]" aria-label={`Remove finding ${i + 1}`}>
                        <Icon name="close" className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                    <Field label="Violation category" required error={touched ? errors[`f${i}-category`] : undefined}>
                      <Select
                        name="finding-category"
                        value={f.category}
                        onChange={(e) => {
                          const cat = e.target.value
                          const def = categories.find((c) => c.name === cat)
                          setFindings(findings.map((x) => (x.key === f.key ? { ...x, category: cat, severity: (def?.default_severity as any) ?? x.severity } : x)))
                        }}
                        invalid={touched && !!errors[`f${i}-category`]}
                      >
                        <option value="">Select category…</option>
                        {categories.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Severity" required hint={f.category ? `regulation: ${categories.find((c) => c.name === f.category)?.regulation ?? '—'}` : 'default severity is suggested by the category'}>
                      <div className="flex flex-wrap gap-1">
                        {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((sv) => {
                          const tone = sv === 'CRITICAL' ? 'critical' : sv === 'HIGH' ? 'high' : sv === 'MEDIUM' ? 'elevated' : 'moderate'
                          const active = f.severity === sv
                          return (
                            <button
                              key={sv}
                              type="button"
                              onClick={() => setFindings(findings.map((x) => (x.key === f.key ? { ...x, severity: sv } : x)))}
                              className={cx('rounded border px-2 py-1 text-[11px] font-semibold uppercase transition-colors', active ? 'tone-soft border' : 'border-line bg-panel text-ink-faint hover:text-ink')}
                              style={active ? ({ ['--tone' as any]: `var(--risk-${tone})` } as any) : undefined}
                            >
                              {sv} <span className="font-mono opacity-70">+{boot?.engine.severity_weights[sv]}</span>
                            </button>
                          )
                        })}
                      </div>
                    </Field>
                  </div>
                  <Field className="mt-2.5" label="What is non-compliant" required error={touched ? errors[`f${i}-description`] : undefined}>
                    <Textarea
                      rows={2}
                      name="finding-description"
                      value={f.description}
                      onChange={(e) => setFindings(findings.map((x) => (x.key === f.key ? { ...x, description: e.target.value } : x)))}
                      invalid={touched && !!errors[`f${i}-description`]}
                      placeholder="Describe the deviation, its location and the measured condition…"
                    />
                  </Field>
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                    <Field label="Additional notes">
                      <Input value={f.notes} onChange={(e) => setFindings(findings.map((x) => (x.key === f.key ? { ...x, notes: e.target.value } : x)))} placeholder="Optional context for the officer" />
                    </Field>
                    <Field label="Assign to officer" hint="Optional now — the queue can triage later">
                      <Select value={f.assigned_to} onChange={(e) => setFindings(findings.map((x) => (x.key === f.key ? { ...x, assigned_to: e.target.value } : x)))}>
                        <option value="">Unassigned</option>
                        {boot?.users
                          .filter((u) => u.role === 'OFFICER')
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="Deadline (days)" error={touched ? errors[`f${i}-due`] : undefined}>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={90}
                          className="w-20"
                          value={f.due_in_days}
                          disabled={!f.assigned_to}
                          onChange={(e) => setFindings(findings.map((x) => (x.key === f.key ? { ...x, due_in_days: Number(e.target.value) } : x)))}
                        />
                        <span className="text-[10.5px] text-ink-faint">
                          {f.assigned_to ? `due ${fmtDate(new Date(Date.now() + f.due_in_days * 86400000).toISOString())}` : 'assign an owner to set a date'}
                        </span>
                      </div>
                    </Field>
                  </div>
                  {f.assigned_to && (
                    <label className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-dim">
                      <Switch checked={f.create_action} onChange={(v) => setFindings(findings.map((x) => (x.key === f.key ? { ...x, create_action: v } : x)))} label="Create corrective action" />
                      Raise a corrective action at the same time
                    </label>
                  )}
                </div>
              ))}
              {touched && errors.findings && <p className="text-[11.5px] text-[color:var(--danger)]">{errors.findings}</p>}
            </div>
          </Panel>
        )}
      </div>

      {/* ------------------------------------------------- live side rail */}
      <div className="space-y-3.5">
        <Panel title="Projected risk impact" subtitle="Live counterfactual: the engine re-scored with your draft finding">
          {!zone ? (
            <EmptyState icon="target" title="Select a zone to see the projection" body="The score shown here is produced by the same engine call that will run on submit." className="py-6" />
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="label">current zone risk</div>
                  <div className="font-mono text-[22px] font-semibold leading-tight" style={{ color: `var(--risk-${zone.risk_tone})` }}>
                    {zone.risk_score.toFixed(1)}
                  </div>
                </div>
                {projection ? (
                  <div className="text-right">
                    <div className="label">after this round</div>
                    <div className="font-mono text-[22px] font-semibold leading-tight" style={{ color: `var(--risk-${projection.after.risk_score > zone.risk_score ? 'high' : 'low'})` }}>
                      {projection.after.risk_score.toFixed(1)}
                      <span className="ml-1 text-[12px]">({signed(projection.delta, 1)})</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-right text-[10.5px] text-ink-faint">
                    add a category
                    <br />
                    to project
                  </div>
                )}
              </div>
              <Progress value={projection?.after.risk_score ?? zone.risk_score} tone={`var(--risk-${projection && projection.delta > 0 ? 'high' : zone.risk_tone})`} height={6} />
              {projection && projection.factor_delta.length > 0 && (
                <div className="space-y-1">
                  {projection.factor_delta.map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-ink-faint">{f.label}</span>
                      <span className="font-mono">
                        {f.before.toFixed(1)} → {f.after.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="rounded border border-dashed border-line bg-sunken p-2 text-[10.5px] leading-snug text-ink-faint">{projection?.note ?? 'Projection uses the seeded state plus your draft; nothing is written until you submit.'}</p>
            </div>
          )}
        </Panel>

        {zone && (
          <Panel title="Zone context" subtitle={`${zone.zone_type.replace(/_/g, ' ')} · cadence ${zone.inspection_cadence_days} days`}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Risk" value={zone.risk_score.toFixed(0)} tone={`var(--risk-${zone.risk_tone})`} />
              <Stat label="Compliance" value={zone.compliance_score.toFixed(0)} />
              <Stat label="Cadence status" value={projection ? '—' : 'as recorded'} sub={`last visit ${zone.id ? 'see dossier' : ''}`} />
              <Stat label="Open findings" value="see dossier" />
            </div>
            <Button size="sm" className="mt-2.5 w-full" variant="outline" type="button" onClick={() => setDrawerZone(zone.id)}>
              Open current zone dossier
            </Button>
          </Panel>
        )}

        <div className="sticky bottom-3 space-y-2">
          {touched && !valid && (
            <div className="rounded border border-[color:var(--danger)]/45 bg-[color:var(--danger)]/8 p-2 text-[11px] leading-snug text-ink-dim">
              <span className="font-semibold text-[color:var(--danger)]">{Object.keys(errors).length} field(s) need attention.</span> The record must be complete before it enters the compliance workflow.
            </div>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="primary" className="flex-1" loading={submitting} onClick={submit} size="lg">
              {submitting ? 'Recording…' : 'Submit inspection'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} size="lg">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </form>
  )

  function setDrawerZone(id: string) {
    // the dossier lives on the parent page; navigate instead of duplicating it
    navigate(`/mines/${mineId}?zone=${id}`)
  }
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-sunken px-2 py-1.5">
      <div className="label">{label}</div>
      <div className="font-mono text-[14px] font-semibold" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-faint">{sub}</div>}
    </div>
  )
}
