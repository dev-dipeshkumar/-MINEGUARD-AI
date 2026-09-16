import React, { useState } from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Panel, Progress, Select, Skeleton, Table, cx } from '../components/ui'
import { Sparkline } from '../components/charts'
import { DashboardTabs } from '../components/DashboardTabs'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { fmt, pct } from '../lib/format'
import type { AttendanceRecord, AttendanceSummary } from '../lib/types'

/**
 * Worker Attendance — closes PS SIH26024 line item "worker attendance".
 *
 * Each daily snapshot is geo-tagged at the muster point (BIOGRID face
 * terminal), so the field report is auditable in space, not just time.
 * The page surfaces: portfolio presence today, 14-day trend, weak mines,
 * and the underlying register. New records come in from the form below.
 */
export function AttendancePage() {
  useDocumentTitle('Attendance · MINEGUARD AI')
  const { data, loading, error, reload } = useAsync<{ records: AttendanceRecord[]; summary: AttendanceSummary }>(endpoints.attendance, [])
  const { pushToast } = useApp()
  const [showForm, setShowForm] = useState(false)

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  const summary = data?.summary
  const todayRecords = data?.records.filter((r) => r.date === data.records[0]?.date) ?? []

  return (
    <>
      <PageHeader
        eyebrow="Module · Governance"
        title="Worker attendance"
        subtitle="Muster and bio-metric face terminal aggregates mapped back to risk exposure"
        tabs={<DashboardTabs />}
        actions={<Button size="sm" variant="primary" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close form' : 'Mark attendance'}</Button>}
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-64 w-full" />}
        {showForm && <AttendanceForm onDone={() => { setShowForm(false); reload() }} />}
        {data && summary && (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Portfolio presence" value={`${summary.portfolio_present_pct.toFixed(1)}%`} tone="var(--risk-low)" sub={`${summary.portfolio_absent} absent across the portfolio`} />
              <KpiTile label="Records" value={String(data.records.length)} tone="var(--accent)" sub="last 14 days" />
              <KpiTile label="Weak mines" value={String(summary.weak_mines.length)} tone="var(--risk-high)" sub="<85% present today" />
              <Panel title="14-day trend" className="p-3" subtitle="portfolio mean present rate">
                <Sparkline values={summary.trend.map((t) => t.present_pct)} tone="var(--risk-low)" width={140} height={40} />
                <div className="mt-1 font-mono text-[11px] text-ink-dim">
                  {summary.trend[0]?.present_pct.toFixed(0)}% → {summary.trend[summary.trend.length - 1]?.present_pct.toFixed(0)}%
                </div>
              </Panel>
            </div>

            {summary.weak_mines.length > 0 && (
              <Panel title="Weak mines today" subtitle="Below 85% presence — likely needs supervisor attention">
                <ul className="grid gap-1.5 sm:grid-cols-3">
                  {summary.weak_mines.map((m) => (
                    <li key={m.mine_id} className="flex items-center justify-between rounded border border-line bg-sunken p-2">
                      <span className="text-[12px]">{m.mine_name}</span>
                      <span className="font-mono text-[12px] text-[color:var(--risk-high)]">{m.present_pct.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Daily register" subtitle="Newest first">
              <Table head={['Mine', 'Date', 'Day', 'Strength', 'Present', 'Absent', 'Unauth.', 'Contractor', 'Geo']}>
                {data.records.slice(0, 30).map((r) => (
                  <tr key={r.id} className="row-hover border-t border-line/70">
                    <td className="px-2.5 py-1.5 text-[11.5px]">{r.mine_name}</td>
                    <td className="px-2.5 py-1.5 text-[11.5px] text-ink-dim font-mono">{r.date}</td>
                    <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">{r.weekday}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{r.workforce_strength}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px] text-[color:var(--risk-low)]">{r.present}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px] text-[color:var(--risk-high)]">{r.absent}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px] text-[color:var(--risk-elevated)]">{r.absent_unauthorised}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{r.contractor_workers}</td>
                    <td className="px-2.5 py-1.5 text-[10px] text-ink-faint font-mono">{r.latitude?.toFixed(3)}, {r.longitude?.toFixed(3)}</td>
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

function AttendanceForm({ onDone }: { onDone: () => void }) {
  const { boot, pushToast } = useApp()
  const mine = boot?.mines[0]
  const [mineId, setMineId] = useState(mine?.id ?? '')
  const [present, setPresent] = useState(String(mine?.workforce ?? 1000))
  const [absent, setAbsent] = useState('0')
  const [onLeave, setOnLeave] = useState('0')
  const [contractor, setContractor] = useState('0')
  const [lat, setLat] = useState<string>('')
  const [lon, setLon] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  // Capture geo-position from the browser; falls back to mine centre.
  React.useEffect(() => {
    if (!navigator?.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(5))
        setLon(pos.coords.longitude.toFixed(5))
      },
      () => { /* silent — server defaults to mine centre */ },
      { enableHighAccuracy: true, timeout: 4000 },
    )
  }, [])

  const submit = async () => {
    setSubmitting(true)
    try {
      await api.post(endpoints.attendance, {
        mine_id: mineId,
        present: parseInt(present),
        absent: parseInt(absent),
        on_leave: parseInt(onLeave),
        contractor_workers: parseInt(contractor),
        latitude: lat ? parseFloat(lat) : undefined,
        longitude: lon ? parseFloat(lon) : undefined,
      })
      pushToast({ kind: 'success', title: 'Attendance captured', body: lat ? `geo: ${lat}, ${lon}` : 'geo: mine centre fallback' })
      onDone()
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Capture failed', body: String(err.message) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel title="Mark today's attendance" subtitle="Geo-tagged at the muster point — browser captures GPS if available, else falls back to mine centre.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Mine">
          <Select value={mineId} onChange={(e) => {
            setMineId(e.target.value)
            const m = boot?.mines.find((x) => x.id === e.target.value)
            if (m) setPresent(String(m.workforce))
          }}>
            {boot?.mines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Present">
          <Input type="number" value={present} onChange={(e) => setPresent(e.target.value)} mono />
        </Field>
        <Field label="Absent">
          <Input type="number" value={absent} onChange={(e) => setAbsent(e.target.value)} mono />
        </Field>
        <Field label="On leave">
          <Input type="number" value={onLeave} onChange={(e) => setOnLeave(e.target.value)} mono />
        </Field>
        <Field label="Contractor workers">
          <Input type="number" value={contractor} onChange={(e) => setContractor(e.target.value)} mono />
        </Field>
        <Field label="Geo-position">
          <Input value={lat ? `${lat}, ${lon}` : 'awaiting GPS…'} readOnly mono />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" loading={submitting} onClick={submit}>Submit attendance</Button>
      </div>
    </Panel>
  )
}
