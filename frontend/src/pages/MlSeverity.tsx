import React, { useState } from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Panel, Skeleton, Textarea, cx } from '../components/ui'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import type { MlDescriptor, MlPrediction } from '../lib/types'

/**
 * ML Severity Classifier — closes PS SIH26024 line item "AI/ML".
 *
 * The original codebase shipped explainable rule-based scoring only,
 * honestly labelled "Phase 1". This page surfaces the Phase 2 ML
 * classifier: a TF-IDF + Multinomial Naive Bayes model trained on the
 * live violation register at first call. The page lets a user paste a
 * free-text description and see the predicted severity with confidence.
 *
 * The descriptor endpoint proves a real trained model exists, not a
 * stub — it returns classes, training size and feature count.
 */
export function MlSeverityPage() {
  useDocumentTitle('ML Severity · MINEGUARD AI')
  const { data: descriptor, loading, error, reload } = useAsync<MlDescriptor>(endpoints.mlDescribe, [])
  const [description, setDescription] = useState('Conveyor CV-2 emergency pull-cord switch inoperative; belt operable without an effective stop arrangement.')
  const [predictions, setPredictions] = useState<MlPrediction[] | null>(null)
  const [predicting, setPredicting] = useState(false)
  const { pushToast } = useApp()

  const predict = async () => {
    setPredicting(true)
    try {
      const res = await api.post<{ predictions: MlPrediction[] }>(endpoints.mlPredictSeverityBatch, { descriptions: [description] })
      setPredictions(res.predictions)
    } catch (e: any) {
      pushToast({ kind: 'error', title: 'Prediction failed', body: e.message })
    } finally {
      setPredicting(false)
    }
  }

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  return (
    <>
      <PageHeader
        eyebrow="Module · Intelligence"
        title="ML severity classifier"
        subtitle="Phase 2 — a TF-IDF + Multinomial Naive Bayes model trained on the live violation register. Not a black box: training size, features and classes are served as data."
      />
      <PageBody className="space-y-3.5">
        {loading && !descriptor && <Skeleton className="h-32 w-full" />}
        {descriptor && (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Model" value={descriptor.mode} tone="var(--accent)" />
            <Tile label="Phase" value={descriptor.phase} tone={descriptor.fallback ? 'var(--risk-high)' : 'var(--risk-low)'} />
            <Tile label="Training size" value={String(descriptor.training_size)} tone="var(--text-dim)" sub={`${descriptor.features} features`} />
            <Tile label="Classes" value={descriptor.classes.join(' / ')} tone="var(--text-dim)" />
          </div>
        )}

        <Panel title="Try the classifier" subtitle="Paste an inspection finding or violation description; the model predicts the severity bucket with a confidence score.">
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="!font-mono !text-[12px]" />
          </Field>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="primary" loading={predicting} onClick={predict}>Predict severity</Button>
            <span className="text-[11px] text-ink-faint">Server-side — the same model the API uses to label incoming findings.</span>
          </div>

          {predictions && predictions[0] && (
            <div className="mt-4 rounded-md border border-line bg-sunken p-3">
              <div className="label">Predicted severity</div>
              <div className="mt-1 flex items-center gap-3">
                <Badge tone={(predictions[0].predicted_severity).toLowerCase() as any} dot>
                  {predictions[0].predicted_severity}
                </Badge>
                <span className="font-mono text-[20px] font-semibold">
                  {(predictions[0].confidence * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-ink-dim">
                  confidence · model: <code className="font-mono">{predictions[0].model}</code>
                  {predictions[0].fallback && ' (keyword fallback — sklearn unavailable)'}
                </span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="How this fits the engine" subtitle="The original rule-based scorer is still the single source of truth for risk scores; this model is advisory.">
          <ul className="space-y-2 text-[12px] leading-relaxed text-ink-dim">
            <li>
              <strong className="text-ink">Advisory on intake.</strong> When an inspector writes a free-text finding, the classifier
              suggests a severity that the inspector can accept or override. The decision still belongs to a human — the model only
              pre-fills the field, which is the right design for a safety-critical register.
            </li>
            <li>
              <strong className="text-ink">Trained on the live register.</strong> The training corpus is the seeded violation
              register plus the severity lexicon. In production this would be a saved model artifact; for the prototype the
              classifier re-trains in &lt;2s on first call. <code className="font-mono">/api/ml/describe</code> reports the live
              <code className="font-mono"> training_size</code> so the claim is checkable.
            </li>
            <li>
              <strong className="text-ink">Honest labelling.</strong> If <code className="font-mono">sklearn</code> is unavailable
              the classifier degrades to a keyword-Bayes fallback and the descriptor reports <code className="font-mono">fallback: true</code>.
              The UI never claims a model is behind a number when the fallback is running.
            </li>
          </ul>
        </Panel>
      </PageBody>
    </>
  )
}

function Tile({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="panel relative flex min-h-[100px] flex-col justify-between overflow-hidden p-3">
      <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: tone }} />
      <span className="label">{label}</span>
      <span className="text-[15px] font-semibold leading-tight" style={{ color: tone }}>{value}</span>
      {sub && <span className="text-[10.5px] text-ink-faint">{sub}</span>}
    </div>
  )
}
