import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Icon, Panel, SegmentedControl, Select, Skeleton, cx } from '../components/ui'
import { ExplanationPanel, RiskBadge } from '../components/risk'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { downloadText, fmt, fmtDate } from '../lib/format'

/**
 * Module 10 — reporting.
 *
 * The document you see is the document you download: the renderer walks the
 * `sections[]` the report service produces and nothing else, so a paragraph can
 * never appear on screen that is missing from the exported file.
 */
export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const { boot, revision } = useApp()
  useDocumentTitle('Reports · MINEGUARD AI')
  const types = useMemo(() => {
    const r = reportMeta()
    return r
  }, [])
  const [reportType, setReportType] = useState(params.get('type') ?? 'MINE_RISK_ASSESSMENT')
  const [mineId, setMineId] = useState(params.get('mine') ?? '')
  const [days, setDays] = useState<'30' | '60' | '90'>((params.get('days') as any) ?? '30')
  const [generated, setGenerated] = useState<any>(null)
  const [generating, setGenerating] = useState(false)
  const previewPath = `${endpoints.reportPreview(reportType, mineId || undefined, Number(days))}`
  const { data, loading, error, reload } = useAsync<any>(previewPath, [reportType, mineId, days, revision])
  const { data: index } = useAsync<any>(endpoints.reports, [revision])

  useEffect(() => {
    const next = new URLSearchParams()
    if (reportType !== 'MINE_RISK_ASSESSMENT') next.set('type', reportType)
    if (mineId) next.set('mine', mineId)
    if (days !== '30') next.set('days', days)
    setParams(next, { replace: true })
  }, [reportType, mineId, days, setParams])

  const doc = generated ?? data
  const scoped = reportType === 'MINE_RISK_ASSESSMENT' || reportType === 'MINE_COMPLIANCE_SUMMARY'

  const generate = async () => {
    setGenerating(true)
    try {
      const res = await api.post<any>(endpoints.generateReport, { report_type: reportType, mine_id: mineId || null, days: Number(days) })
      setGenerated(res.report ?? res)
    } catch (e) {
      // surfaced by the caller below
      setGenerated({ error: (e as Error).message })
    } finally {
      setGenerating(false)
    }
  }

  const download = async (format: 'md' | 'csv' | 'txt') => {
    const qs = new URLSearchParams({ days, format })
    if (mineId) qs.set('mine_id', mineId)
    const res = await fetch(`/api/reports/download/${reportType}?${qs}`)
    if (!res.ok) return
    const text = await res.text()
    downloadText(`mineguard-${reportType.toLowerCase()}-${mineId || 'enterprise'}-${days}d.${format}`, text, format === 'csv' ? 'text/csv' : 'text/plain')
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 10 · Reporting"
        title="Reports & register extracts"
        subtitle="Every section is rendered from the report payload the service builds from live records. Nothing is typed into a template."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => window.print()} icon={<Icon name="file" className="h-3.5 w-3.5" />}>
              Print
            </Button>
            <Button size="sm" variant="outline" onClick={() => download('md')}>
              Markdown
            </Button>
            <Button size="sm" variant="outline" onClick={() => download('csv')}>
              CSV
            </Button>
            <Button size="sm" variant="primary" loading={generating} onClick={generate}>
              Generate & stamp
            </Button>
          </>
        }
      />

      <PageBody className="space-y-3.5">
        <div className="grid gap-3.5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Panel title="Document" subtitle="Six report types, all built from the same live store">
              <ul className="space-y-1">
                {(index?.types ?? types).map((t: any) => {
                  const active = t.id === reportType
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => {
                          setReportType(t.id)
                          setGenerated(null)
                        }}
                        className={cx('w-full rounded border px-2 py-1.5 text-left transition-colors', active ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/8' : 'border-line bg-sunken hover:border-line-strong')}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{t.name}</span>
                          <Badge tone={t.scope === 'MINE' ? 'neutral' : 'accent'}>{t.scope === 'MINE' ? 'per site' : 'portfolio'}</Badge>
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-ink-faint">{t.description}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Panel>

            <Panel title="Scope & period">
              <div className="space-y-2.5">
                <div>
                  <div className="label mb-1">Mine</div>
                  <Select value={mineId} onChange={(e) => (setMineId(e.target.value), setGenerated(null))} disabled={!scoped}>
                    <option value="">Enterprise portfolio</option>
                    {(index?.mines ?? boot?.mines ?? []).map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  {!scoped && <p className="mt-1 text-[10px] text-ink-faint">This document is enterprise-wide by design; it accepts an optional mine filter but aggregates regardless.</p>}
                </div>
                <div>
                  <div className="label mb-1">Period</div>
                  <SegmentedControl
                    size="sm"
                    value={days}
                    onChange={(v) => (setDays(v as any), setGenerated(null))}
                    options={[
                      { value: '30', label: '30 days' },
                      { value: '60', label: '60 days' },
                      { value: '90', label: '90 days' },
                    ]}
                  />
                </div>
                {generated && (
                  <div className="rounded border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/6 p-2 text-[10.5px] leading-snug text-ink-dim">
                    Showing the copy generated at {fmtDate(generated.generated_at ?? new Date().toISOString())}.
                    <button className="ml-1 text-[color:var(--accent)] hover:underline" onClick={() => setGenerated(null)}>
                      back to live preview
                    </button>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Recently generated" subtitle="Stamped copies kept in the store for the session">
              {(index?.recent ?? []).length === 0 ? (
                <EmptyState icon="report" title="Nothing generated yet" body="Use “Generate & stamp” to record this exact version of the document." className="py-5" />
              ) : (
                <ul className="space-y-1">
                  {index.recent.map((r: any) => (
                    <li key={r.id ?? `${r.report_type}-${r.generated_at}`} className="flex items-center gap-2 rounded border border-line bg-sunken px-2 py-1.5 text-[10.5px]">
                      <span className="font-mono text-ink-faint">{fmtDate(r.generated_at)}</span>
                      <span className="min-w-0 flex-1 truncate">{r.title ?? r.report_type}</span>
                      <Badge tone="neutral">{r.days ?? days}d</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* ------------------------------------------------ the document */}
          <div className="print-area">
            {error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : loading && !doc ? (
              <Panel>
                <div className="space-y-2">
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              </Panel>
            ) : (doc as any)?.error ? (
              <ErrorState message={(doc as any).error} onRetry={generate} />
            ) : !doc ? (
              <EmptyState icon="report" title="No document loaded" body="Pick a report type and generate it." />
            ) : (
              <ReportDocument doc={doc} />
            )}
          </div>
        </div>
      </PageBody>
    </>
  )
}

function reportMeta() {
  // Fallback list so the picker is never empty if the index request is slow.
  return [
    { id: 'MINE_RISK_ASSESSMENT', name: 'Mine Risk Assessment Report', description: 'Zone ranking, engine explanations, overdue exposure, recommended actions.', scope: 'MINE' },
    { id: 'MINE_COMPLIANCE_SUMMARY', name: 'Mine Compliance Summary', description: 'Closure performance, cadence adherence, evidence completeness.', scope: 'MINE' },
    { id: 'OPEN_VIOLATIONS', name: 'Open Violations Register', description: 'Every open finding with owner, age and contribution.', scope: 'ALL' },
    { id: 'OVERDUE_ACTIONS', name: 'Overdue Corrective Actions', description: 'Escalation list by owner and zone.', scope: 'ALL' },
    { id: 'DEPARTMENT_COMPLIANCE', name: 'Department Compliance Analysis', description: 'Safety, environment and labour compared on exposure and velocity.', scope: 'ALL' },
    { id: 'EARLY_WARNING', name: 'Early Warning Briefing', description: 'Active alerts with evidence and recommended actions.', scope: 'ALL' },
  ]
}

export function ReportDocument({ doc }: { doc: any }) {
  return (
    <article className="panel overflow-hidden">
      <header className="border-b border-line bg-sunken px-4 py-3.5 print-header">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="label">
              MINEGUARD AI · {doc.meta?.engine === 'rule-based' ? 'rule-based risk intelligence' : doc.meta?.engine} · {doc.meta?.prepared_by}
            </div>
            <h1 className="mt-1 text-[19px] font-semibold leading-tight">{doc.title}</h1>
            <p className="mt-0.5 text-[11.5px] text-ink-dim">
              {doc.subtitle} period {fmtDate(doc.period?.from)} → {fmtDate(doc.period?.to)} ({doc.period?.days} days) · generated {fmtDate(doc.generated_at)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {doc.counts?.risk_score !== undefined && <RiskBadge score={doc.counts.risk_score} />}
            <div className="mt-1 text-[10px] text-ink-faint">audience: {doc.meta?.audience}</div>
          </div>
        </div>
      </header>

      <div className="space-y-3.5 p-4">
        <div className="rounded border border-line bg-sunken p-3">
          <div className="label mb-1">Executive summary</div>
          <p className="text-[12.5px] leading-relaxed text-ink">{doc.executive_summary}</p>
        </div>

        {doc.sections?.map((s: any, i: number) => (
          <section key={i} className="break-inside-avoid">
            {s.title && (
              <h2 className="mb-1.5 mt-3 text-[13px] font-semibold uppercase tracking-wide2 text-ink-dim first:mt-0">
                {s.title}
              </h2>
            )}
            {renderSection(s)}
          </section>
        ))}
      </div>
    </article>
  )
}

function renderSection(s: any) {
  switch (s.type) {
    case 'KEY_FACTS':
      return (
        <dl className="grid gap-x-4 gap-y-1 rounded border border-line bg-sunken p-3 sm:grid-cols-2 lg:grid-cols-3">
          {(s.items ?? []).map((f: any, i: number) => (
            <div key={i} className="flex items-baseline justify-between gap-2 border-b border-line/60 py-1 last:border-0">
              <dt className="text-[10.5px] uppercase tracking-wide2 text-ink-faint">{f.label}</dt>
              <dd className="truncate text-right font-mono text-[12px] text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )
    case 'TABLE':
      return (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="bg-sunken text-[10px] uppercase tracking-wide2 text-ink-faint">
                {(s.columns ?? []).map((c: string) => (
                  <th key={c} className="px-2.5 py-1.5 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(s.rows ?? []).map((row: string[], i: number) => (
                <tr key={i} className="border-t border-line/70">
                  {row.map((cell, j) => (
                    <td key={j} className={cx('px-2.5 py-1.5', j > 0 && /^-?\d/.test(cell) ? 'font-mono' : '', j === 2 && /^(CRITICAL|HIGH|ELEVATED|MODERATE|LOW)$/.test(cell) ? 'text-ink' : '')}>
                      {/^(CRITICAL|HIGH)$/.test(cell) ? <Badge tone={cell === 'CRITICAL' ? 'critical' : 'high'}>{cell}</Badge> : cell}
                    </td>
                  ))}
                </tr>
              ))}
              {(s.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={Math.max(1, (s.columns ?? []).length)} className="px-2.5 py-4 text-center text-[11px] text-ink-faint">
                    Nothing in this table for the selected scope and period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )
    case 'LIST':
      return (
        <ul className="divide-y divide-[color:var(--line)] rounded border border-line">
          {(s.items ?? []).map((it: any, i: number) => (
            <li key={it.id ?? i} className="px-2.5 py-1.5">
              <div className="text-[11.5px] font-medium">{it.primary}</div>
              <div className="text-[10.5px] text-ink-faint">{it.secondary}</div>
            </li>
          ))}
          {(s.items ?? []).length === 0 && <li className="px-2.5 py-3 text-center text-[11px] text-ink-faint">No entries.</li>}
        </ul>
      )
    case 'EXPLANATION':
      return (
        <ExplanationPanel
          risk={{
            risk_score: s.score,
            risk_level: s.level,
            factors: s.factors ?? [],
            drivers: s.drivers ?? [],
            metrics: s.metrics ?? {},
            method: s.method ?? '',
          } as any}
          title={undefined}
          showRaw
        />
      )
    case 'ACTIONS':
      return (
        <ul className="space-y-1.5">
          {(s.items ?? []).map((a: any, i: number) => (
            <li key={i} className="flex items-start gap-2 rounded border border-line bg-sunken px-2.5 py-1.5">
              <Badge tone={a.priority === 'immediate' ? 'critical' : a.priority === 'high' ? 'high' : 'moderate'}>{a.priority}</Badge>
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-dim">{a.action}</span>
              {a.owner_hint && <span className="shrink-0 text-[10px] text-ink-faint">{a.owner_hint}</span>}
              {a.due && <span className="shrink-0 font-mono text-[10px] text-ink-faint">by {a.due}</span>}
            </li>
          ))}
        </ul>
      )
    case 'CALLOUT':
      return (
        <div className="rounded border-l-2 border-[color:var(--risk-elevated)] bg-sunken px-3 py-2">
          <div className="label">{s.title}</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-dim">{s.body}</p>
        </div>
      )
    default:
      return <pre className="overflow-x-auto rounded border border-line bg-sunken p-2 text-[10.5px] text-ink-dim">{JSON.stringify(s, null, 2)}</pre>
  }
}
