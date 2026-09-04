import React, { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, Divider, EmptyState, ErrorState, Field, Icon, Input, Panel, Progress, Select, Skeleton, Switch, cx } from '../components/ui'
import { Donut } from '../components/charts'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { fmt, fmtDate, humanize, relative } from '../lib/format'

/**
 * Module 9 — document intelligence.
 *
 * Deliberately narrow: the pipeline is upload → text/OCR → classification →
 * key-information extraction → cross-check against the register → suggested
 * entries. A document earns its place here only when it can be reconciled with
 * the open register, which is what the `flags` and the link step are for.
 */
export function DocumentsPage() {
  const { boot, revision, mutate, invalidate } = useApp()
  const navigate = useNavigate()
  useDocumentTitle('Documents · MINEGUARD AI')
  const [mineId, setMineId] = useState('')
  const [status, setStatus] = useState('')
  const { data, loading, error, reload } = useAsync<any>(`${endpoints.documents}${mineId || status ? `?${new URLSearchParams(Object.fromEntries(Object.entries({ mine_id: mineId, status }).filter(([, v]) => v)) as any)}` : ''}`, [mineId, status, revision])
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [linkZone, setLinkZone] = useState('')
  const [createViolations, setCreateViolations] = useState(true)

  const docs: any[] = data?.documents ?? []
  const pipeline: string[] = data?.pipeline ?? []
  const engines: Record<string, boolean> = data?.engines ?? {}
  const available = Object.values(engines).filter(Boolean).length

  const byStatus = useMemo(() => {
    const acc: Record<string, number> = {}
    docs.forEach((d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1
    })
    return acc
  }, [docs])

  const runAction = (id: string, action: 'reprocess' | 'link', body?: Record<string, unknown>) =>
    mutate(
      () => api.post(`/api/documents/${id}/${action}`, body ?? {}),
      {
        success: (res: any) => res?.message ?? (action === 'reprocess' ? `${id} re-processed` : `${id} linked to the zone register`),
        onError: (e: any) => e.message,
      },
    ).then((res) => {
      if (res) {
        reload()
        invalidate()
      }
      return res
    })

  return (
    <>
      <PageHeader
        eyebrow="Module 9 · Document intelligence"
        title="Documents & extraction"
        subtitle="Statutory returns, inspection reports and registers, read back into the compliance record instead of sitting in a folder."
        actions={
          <Button size="sm" onClick={() => document.getElementById('doc-file')?.click()} icon={<Icon name="upload" className="h-3.5 w-3.5" />}>
            Upload document
          </Button>
        }
      />

      <PageBody className="space-y-3.5">
        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-3.5">
            <UploadCard onUploaded={() => reload()} />

            <Panel
              title="Register of documents"
              subtitle={`${fmt(docs.length)} file(s) in view · newest first`}
              right={
                <div className="flex items-center gap-1.5">
                  <Select className="h-7 w-[150px] text-[11.5px]" value={mineId} onChange={(e) => setMineId(e.target.value)}>
                    <option value="">All mines</option>
                    {boot?.mines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name.split(' ')[0]}
                      </option>
                    ))}
                  </Select>
                  <Select className="h-7 w-[150px] text-[11.5px]" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">Any status</option>
                    {Object.keys(byStatus).map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </Select>
                </div>
              }
              dense
              bodyClass="p-0"
            >
              {error && (
                <div className="p-3">
                  <ErrorState message={error} onRetry={reload} />
                </div>
              )}
              {loading && !data && (
                <div className="space-y-2 p-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-28 w-full" />
                  ))}
                </div>
              )}
              {!loading && docs.length === 0 && !error && (
                <EmptyState icon="file" title="No documents here yet" body="Upload a PDF or scan; extraction runs synchronously and the result is shown against the register." className="py-10" />
              )}
              <ul className="divide-y divide-[color:var(--line)]">
                {docs.map((d) => (
                  <li key={d.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-sunken text-ink-faint">
                        <Icon name="file" className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{d.file_name}</span>
                        <span className="block truncate text-[10.5px] text-ink-faint">
                          {d.id} · {d.mine_name}
                          {d.zone_name ? ` · ${d.zone_name}` : ''} · {relative(d.uploaded_at)} · {d.uploader}
                        </span>
                      </span>
                      <Badge tone="neutral">{d.type_label}</Badge>
                      <Badge tone={d.status === 'PROCESSED' ? 'low' : d.status === 'FAILED' ? 'high' : 'moderate'} dot>
                        {humanize(d.status)}
                      </Badge>
                      {d.confidence > 0 && (
                        <span className="font-mono text-[10.5px] text-ink-faint" title="classifier confidence">
                          {(d.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 text-[11.5px] leading-snug text-ink-dim">{d.summary}</p>

                    <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="rounded border border-line bg-sunken p-2">
                        <div className="label mb-1">
                          Extracted · {d.ocr_engine} · {d.pages}p · {fmt(d.text_chars)} chars
                        </div>
                        {Object.keys(d.extracted ?? {}).length === 0 ? (
                          <p className="text-[10.5px] text-ink-faint">No fields recovered — the reader found no text layer and no OCR engine is available in this environment.</p>
                        ) : (
                          <dl className="grid grid-cols-2 gap-x-3">
                            {Object.entries(d.extracted).map(([k, v]) => (
                              <div key={k} className="flex items-baseline gap-1.5 border-b border-line/50 py-0.5 last:border-0">
                                <dt className="text-[10px] text-ink-faint">{humanize(k)}</dt>
                                <dd className="ml-auto truncate font-mono text-[10.5px] text-ink-dim" title={String(v)}>
                                  {typeof v === 'number' ? fmt(v) : String(v)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>

                      <div className="rounded border border-line bg-sunken p-2">
                        <div className="label mb-1">Cross-check against the register</div>
                        {(d.flags ?? []).length === 0 ? (
                          <p className="text-[10.5px] text-ink-dim">No variance between the document and the open register for this scope.</p>
                        ) : (
                          <ul className="space-y-1">
                            {d.flags.map((f: string, i: number) => (
                              <li key={i} className="flex items-start gap-1.5 text-[10.5px] leading-snug text-ink-dim">
                                <Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0 text-[color:var(--risk-elevated)]" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(d.linked_violations ?? []).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span className="label">linked</span>
                            {d.linked_violations.map((id: string) => (
                              <button key={id} onClick={() => navigate(`/violations?search=${id}`)} className="rounded border border-line bg-panel px-1 font-mono text-[9.5px] text-[color:var(--accent)] hover:underline">
                                {id}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => runAction(d.id, 'reprocess')}>
                            <Icon name="refresh" className="h-3 w-3" /> Re-run extraction
                          </Button>
                          {d.mine_id && (
                            <Button size="sm" variant="outline" onClick={() => (setLinkFor(linkFor === d.id ? null : d.id), setLinkZone(d.zone_id ?? ''))}>
                              Link to zone register
                            </Button>
                          )}
                        </div>
                        {linkFor === d.id && (
                          <div className="mt-2 rounded border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/6 p-2">
                            <Field label="Zone" required hint="Suggested violations are created only from defects the document reports">
                              <Select value={linkZone} onChange={(e) => setLinkZone(e.target.value)}>
                                <option value="">Select zone…</option>
                                {(boot?.zones ?? []).filter((z) => z.mine_id === d.mine_id).map((z) => (
                                  <option key={z.id} value={z.id}>
                                    {z.short_name} — {z.name.split('— ')[1] ?? ''} (risk {z.risk_score.toFixed(0)})
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <label className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-dim">
                              <Switch checked={createViolations} onChange={setCreateViolations} label="Create suggested violations" />
                              Create the suggested violation entries
                            </label>
                            <Button size="sm" variant="primary" className="mt-1.5" disabled={!linkZone} onClick={() => runAction(d.id, 'link', { zone_id: linkZone, create_violations: createViolations }).then(() => setLinkFor(null))}>
                              Link {d.file_name.length > 22 ? `${d.file_name.slice(0, 22)}…` : d.file_name}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="space-y-3.5">
            <Panel title="Extraction pipeline" subtitle="Each stage runs server-side; the UI never invents an intermediate result">
              <ol className="space-y-1.5">
                {pipeline.map((step, i) => {
                  const failed = docs.some((d) => d.status === 'FAILED') && i === 1
                  return (
                    <li key={step} className="flex items-center gap-2">
                      <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px]', failed ? 'border-[color:var(--danger)]/50 text-[color:var(--danger)]' : 'border-line text-ink-faint')}>{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">{humanize(step.toLowerCase())}</span>
                      {i === 1 && <Badge tone={available ? 'low' : 'elevated'}>{available} engine(s)</Badge>}
                    </li>
                  )
                })}
              </ol>
              <Divider className="my-2.5" />
              <div className="label mb-1">Reader availability</div>
              <ul className="space-y-1">
                {Object.entries(engines).map(([name, ok]) => (
                  <li key={name} className="flex items-center gap-2 text-[11px]">
                    <span className={cx('h-1.5 w-1.5 rounded-full', ok ? 'bg-[color:var(--ok)]' : 'bg-[color:var(--line-strong)]')} />
                    <span className="text-ink-dim">{name}</span>
                    <span className="ml-auto font-mono text-[10px] text-ink-faint">{ok ? 'installed' : 'absent'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 rounded border border-dashed border-line bg-sunken p-2 text-[10.5px] leading-snug text-ink-faint">
                {available === 0
                  ? 'No OCR engine is installed here, so scanned images report status FAILED rather than a fabricated transcription. PDFs carrying a real text layer are still read and classified — which is what the seeded documents demonstrate.'
                  : `${available} reader(s) available. Documents without a text layer fall through to OCR and report the engine that produced the text.`}
              </p>
            </Panel>

            <Panel title="Corpus" subtitle="Status mix across all uploaded files">
              {docs.length === 0 ? (
                <EmptyState icon="file" title="Nothing uploaded" className="py-6" />
              ) : (
                <>
                  <Donut
                    segments={Object.entries(byStatus).map(([k, v]) => ({ label: humanize(k), value: v as number, color: k === 'PROCESSED' ? 'var(--ok)' : k === 'FAILED' ? 'var(--danger)' : 'var(--accent)' }))}
                    center={`${docs.length}`}
                    size={112}
                  />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stat label="Files" value={fmt(data?.stats?.total)} />
                    <Stat label="Processed" value={fmt(data?.stats?.processed)} tone="var(--risk-low)" />
                    <Stat label="Flags raised" value={fmt(data?.stats?.flags)} tone="var(--risk-elevated)" />
                  </div>
                </>
              )}
            </Panel>

            <Panel title="What linking does" subtitle="The only write operation this module performs">
              <p className="text-[11.5px] leading-relaxed text-ink-dim">
                Linking a document to a zone reconciles the extracted defect counts against that zone's open findings. Where the document reports a defect the register does not, a violation is raised through the normal workflow — severity, owner and
                corrective action included — and the zone is re-scored. Where the counts agree, the document is attached as evidence to the existing records.
              </p>
              <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ink-faint">
                <Icon name="info" className="h-3 w-3" />
                Confidence below 0.5 is surfaced as a flag rather than silently converted into a record.
              </div>
              <Progress className="mt-2" value={docs.filter((d) => d.linked_violations?.length).length} max={Math.max(1, docs.length)} tone="var(--accent)" height={4} />
              <p className="mt-1 text-[10px] text-ink-faint">{docs.filter((d) => d.linked_violations?.length).length} of {docs.length} document(s) currently linked to register entries.</p>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  )
}

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const { boot, mutate, invalidate } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mineId, setMineId] = useState(boot?.mines[0]?.id ?? '')
  const [zoneId, setZoneId] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const zones = useMemo(() => (boot?.zones ?? []).filter((z) => z.mine_id === mineId), [boot, mineId])

  const submit = async () => {
    if (!file || !mineId) return
    const form = new FormData()
    form.append('file', file)
    form.append('mine_id', mineId)
    form.append('zone_id', zoneId)
    form.append('notes', notes)
    const res = await mutate(() => api.upload<any>('/api/documents/upload', form), { success: (r: any) => `${r.document?.id ?? 'Document'} processed by ${r.document?.ocr_engine ?? 'reader'}` })
    if (res) {
      setFile(null)
      setNotes('')
      if (inputRef.current) inputRef.current.value = ''
      onUploaded()
      invalidate()
    }
  }

  return (
    <Panel title="Upload for extraction" subtitle="PDF or image. The file is stored server-side and read back in the same request." bodyClass="p-3">
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
        <label
          className={cx(
            'flex min-h-[74px] cursor-pointer flex-col items-center justify-center rounded border border-dashed px-3 py-2 text-center transition-colors',
            file ? 'border-[color:var(--ok)]/60 bg-[color:var(--ok)]/6' : 'border-line bg-sunken hover:border-line-strong',
          )}
        >
          <input
            id="doc-file"
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.txt"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Icon name="upload" className={cx('h-4 w-4', file ? 'text-[color:var(--ok)]' : 'text-ink-faint')} />
          <span className="mt-1 text-[11.5px] font-medium">{file ? file.name : 'Choose a file or drop it here'}</span>
          <span className="text-[10px] text-ink-faint">{file ? `${(file.size / 1024).toFixed(0)} KB · stored on the server, not in the browser` : 'pdf, png, jpg, tiff, txt'}</span>
        </label>
        <Field label="Mine" required>
          <Select value={mineId} onChange={(e) => (setMineId(e.target.value), setZoneId(''))}>
            {boot?.mines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Zone" hint="optional — enables cross-check">
          <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">Not scoped</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.short_name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Field label="Note for the register">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Regional office copy, received by post" />
          </Field>
        </div>
        <Button variant="primary" disabled={!file || !mineId} onClick={submit} loading={false}>
          {file ? `Upload ${file.name.length > 18 ? `${file.name.slice(0, 18)}…` : file.name}` : 'Select a file'}
        </Button>
      </div>
    </Panel>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-sunken px-2 py-1.5">
      <div className="label">{label}</div>
      <div className="font-mono text-[14px] font-semibold" style={{ color: tone }}>
        {value}
      </div>
    </div>
  )
}
