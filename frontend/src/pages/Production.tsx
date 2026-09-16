import React, { useState } from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Panel, Progress, Select, Skeleton, Table, cx } from '../components/ui'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { fmt, pct, signed } from '../lib/format'
import type { ProductionReport, ProductionSummary } from '../lib/types'

/**
 * Production Reporting — closes PS SIH26024 line item "production reporting".
 *
 * Shows the latest monthly return per mine with variance against target,
 * performers and laggards, plus a 6-month trend table per mine. The
 * numbers come from /api/production, derived server-side from the
 * production_reports collection — no client arithmetic.
 */
export function ProductionPage() {
  useDocumentTitle('Production · MINEGUARD AI')
  const { data, loading, error, reload } = useAsync<{ reports: ProductionReport[]; summary: ProductionSummary }>(endpoints.production, [])
  const { pushToast, mutate } = useApp()
  const [showForm, setShowForm] = useState(false)

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  return (
    <>
      <PageHeader
        eyebrow="Module · Governance"
        title="Production reporting"
        subtitle="Monthly output returns per mine, variance against plan, and the operational signal — derived from production_reports the same way the command center derives risk from violations."
        actions={
          <Button size="sm" variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close form' : 'Record return'}
          </Button>
        }
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-64 w-full" />}

        {showForm && <ProductionForm onDone={() => { setShowForm(false); reload() }} />}

        {data && (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Period" value={data.summary.period_month ?? '—'} tone="var(--accent)" />
              <KpiTile label="Portfolio target" value={`${fmt(data.summary.total_target_kt, 0)} kt`} tone="var(--text-dim)" />
              <KpiTile label="Portfolio actual" value={`${fmt(data.summary.total_actual_kt, 0)} kt`} tone="var(--text)" />
              <KpiTile
                label="Variance"
                value={`${signed(data.summary.variance_pct, 1)}%`}
                tone={data.summary.variance_pct >= 0 ? 'var(--risk-low)' : 'var(--risk-high)'}
              />
            </div>

            <div className="grid gap-3.5 xl:grid-cols-2">
              <Panel title="Performers" subtitle="Top-2 mines by performance vs plan this period">
                <ListRows items={data.summary.performers.map((p) => ({ key: p.mine_id, primary: p.mine_name, value: `${p.performance_pct.toFixed(1)}%`, tone: 'var(--risk-low)' }))} />
              </Panel>
              <Panel title="Laggards" subtitle="Bottom-2 mines — gap to plan in kilotonnes">
                <ListRows items={data.summary.laggards.map((p) => ({ key: p.mine_id, primary: p.mine_name, value: `${p.performance_pct.toFixed(1)}% · ${fmt(p.gap_kt, 0)} kt short`, tone: 'var(--risk-high)' }))} />
              </Panel>
            </div>

            <Panel title="Monthly returns" subtitle="Newest first — last 6 months">
              <Table head={['Mine', 'Period', 'Target', 'Actual', 'Variance', 'Performance', 'Status']}>
                {data.reports.slice().reverse().map((r) => (
                  <tr key={r.id} className="row-hover border-t border-line/70">
                    <td className="px-2.5 py-1.5 text-[11.5px]">{r.mine_name}</td>
                    <td className="px-2.5 py-1.5 text-[11.5px] text-ink-dim">{r.period_label}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{fmt(r.target_kt, 1)}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{fmt(r.actual_kt, 1)}</td>
                    <td className={cx('px-2.5 py-1.5 text-right font-mono text-[11.5px]', r.variance_pct >= 0 ? 'text-[color:var(--risk-low)]' : 'text-[color:var(--risk-high)]')}>
                      {signed(r.variance_pct, 1)}%
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Progress value={r.performance_pct} tone={r.performance_pct >= 90 ? 'var(--risk-low)' : r.performance_pct >= 75 ? 'var(--risk-elevated)' : 'var(--risk-high)'} className="w-[60px]" />
                        <span className="font-mono text-[11px]">{r.performance_pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge tone={r.verified ? 'low' : 'elevated'}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="panel relative flex min-h-[100px] flex-col justify-between overflow-hidden p-3">
      <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: tone }} />
      <span className="label">{label}</span>
      <span className="font-mono text-[22px] font-semibold" style={{ color: tone }}>{value}</span>
    </div>
  )
}

function ListRows({ items }: { items: { key: string; primary: string; value: string; tone?: string }[] }) {
  if (!items.length) return <EmptyState title="No data" />
  return (
    <ul className="divide-y divide-line/60">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-[12px]">{it.primary}</span>
          <span className="font-mono text-[12px]" style={{ color: it.tone }}>{it.value}</span>
        </li>
      ))}
    </ul>
  )
}

function ProductionForm({ onDone }: { onDone: () => void }) {
  const { boot, pushToast } = useApp()
  const [mineId, setMineId] = useState(boot?.mines[0]?.id ?? '')
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [target, setTarget] = useState('155')
  const [actual, setActual] = useState('140')
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    try {
      await api.post(endpoints.production, {
        mine_id: mineId,
        period_month: period,
        target_kt: parseFloat(target),
        actual_kt: parseFloat(actual),
        shifts_worked: 26,
        overburden_m3: 0,
        strip_ratio: 2.8,
        remarks,
      })
      pushToast({ kind: 'success', title: 'Return submitted', body: `${period} · ${actual}/${target} kt` })
      onDone()
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Submission failed', body: String(err.message) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel title="Record a monthly production return" subtitle="Mine managers and above. Fields reconcile against the mine's annual target.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Mine">
          <Select value={mineId} onChange={(e) => setMineId(e.target.value)}>
            {boot?.mines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Period (YYYY-MM)">
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} mono />
        </Field>
        <Field label="Target (kt)">
          <Input type="number" step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} mono />
        </Field>
        <Field label="Actual (kt)">
          <Input type="number" step="0.1" value={actual} onChange={(e) => setActual(e.target.value)} mono />
        </Field>
      </div>
      <Field label="Remarks" className="mt-3">
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional context — downtime, geological variance etc." />
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" loading={submitting} onClick={submit}>Submit return</Button>
      </div>
    </Panel>
  )
}
