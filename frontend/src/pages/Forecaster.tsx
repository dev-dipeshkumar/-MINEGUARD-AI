import React, { useState, useMemo } from 'react'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Button, EmptyState, ErrorState, Panel, Progress, Skeleton, Table, cx } from '../components/ui'
import { Sparkline } from '../components/charts'
import { useApp, useAsync, useDocumentTitle } from '../state/app'
import { api, endpoints } from '../lib/api'
import { fmt, fmtDate, signed } from '../lib/format'

/**
 * Risk Forecaster page — research-grounded 7-day risk forecast per zone.
 *
 * Uses an sklearn MLPRegressor over a 14-day sliding window, with a
 * LinearRegression baseline for confidence calibration. The model is
 * trained per-zone from the 90-day history series already produced by
 * the rule-based risk engine — no new data collection needed.
 *
 * Research grounding: Dey 2021 (142 citations) CNN-LSTM for coal mine
 * hazards; Shi 2024 (163 citations) LSTM-Transformer for time-series.
 */
interface ForecastDay {
  date: string
  day_offset: number
  predicted_score: number
  lower: number
  upper: number
  linear_baseline: number
}

interface ZoneForecast {
  zone_id: string
  zone_name: string
  current_score: number
  forecast: ForecastDay[]
  forecast_mean_7d: number
  delta_from_current: number
  signal: 'RISING' | 'FALLING' | 'STABLE' | string
  peak_day: { date: string; predicted_score: number }
  model: string
  low_confidence: boolean
  training_size: number
  trained_at: string
  window: number
  horizon: number
}

const SIGNAL_TONES: Record<string, string> = {
  RISING: 'var(--risk-high)',
  FALLING: 'var(--risk-low)',
  STABLE: 'var(--text-dim)',
}

export function ForecasterPage() {
  useDocumentTitle('Risk Forecast · MINEGUARD AI')
  const { data, loading, error, reload } = useAsync<{ forecasts: ZoneForecast[] }>(endpoints.riskForecast, [])
  const [selected, setSelected] = useState<string | null>(null)

  if (error) return <PageBody><ErrorState message={error} onRetry={reload} /></PageBody>

  const forecasts = data?.forecasts ?? []
  const focused = forecasts.find((f) => f.zone_id === selected) ?? forecasts[0]

  return (
    <>
      <PageHeader
        eyebrow="Module · Intelligence"
        title="7-day risk forecast"
        subtitle="A sliding-window MLPRegressor predicts the next 7 days of risk per zone from the 90-day history series. Research-grounded: Dey 2021 (142 citations) CNN-LSTM for mine hazards; Shi 2024 (163 citations) LSTM-Transformer."
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-64 w-full" />}
        {data && (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Zones forecast" value={String(forecasts.length)} tone="var(--accent)" />
              <KpiTile label="RISING" value={String(forecasts.filter((f) => f.signal === 'RISING').length)} tone="var(--risk-high)" />
              <KpiTile label="FALLING" value={String(forecasts.filter((f) => f.signal === 'FALLING').length)} tone="var(--risk-low)" />
              <KpiTile label="Low confidence" value={String(forecasts.filter((f) => f.low_confidence).length)} tone="var(--risk-elevated)" sub="MLP and linear baseline disagree > 15 pts" />
            </div>

            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Panel title="Zone forecasts ranked by 7-day delta" subtitle="Positive delta = risk rising. Most-at-risk zones first.">
                <Table head={['Zone', 'Current', '7d mean', 'Δ', 'Signal', 'Peak day', 'Conf.', 'Action']}>
                  {forecasts.map((f) => (
                    <tr key={f.zone_id} className={cx('row-hover border-t border-line/70', focused?.zone_id === f.zone_id && 'bg-raised')}>
                      <td className="px-2.5 py-1.5 text-[11.5px] font-medium">
                        <button onClick={() => setSelected(f.zone_id)} className="text-left hover:text-[color:var(--accent)]">
                          {f.zone_name}
                        </button>
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]">{fmt(f.current_score, 0)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-[11.5px]" style={{ color: SIGNAL_TONES[f.signal] }}>
                        {fmt(f.forecast_mean_7d, 0)}
                      </td>
                      <td className={cx('px-2.5 py-1.5 text-right font-mono text-[11.5px]', f.delta_from_current > 0 ? 'text-[color:var(--risk-high)]' : f.delta_from_current < 0 ? 'text-[color:var(--risk-low)]' : 'text-ink-dim')}>
                        {signed(f.delta_from_current, 1)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <Badge tone={f.signal === 'RISING' ? 'high' : f.signal === 'FALLING' ? 'low' : 'neutral'} dot>
                          {f.signal}
                        </Badge>
                      </td>
                      <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">
                        {fmt(f.peak_day.predicted_score, 0)} on {fmtDate(f.peak_day.date)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <Badge tone={f.low_confidence ? 'elevated' : 'low'}>{f.low_confidence ? 'low' : 'high'}</Badge>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <button onClick={() => setSelected(f.zone_id)} className="text-[10.5px] text-[color:var(--accent)] hover:underline">
                          focus
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
                {forecasts.length === 0 && <EmptyState title="No forecasts available" body="Need at least 30 days of history per zone to train the model." />}
              </Panel>

              {focused && (
                <Panel title={focused.zone_name} subtitle={`Current ${fmt(focused.current_score, 0)} → 7d mean ${fmt(focused.forecast_mean_7d, 0)}`}>
                  <div className="space-y-3">
                    <div>
                      <div className="label mb-1">Signal</div>
                      <div className="flex items-center gap-2">
                        <Badge tone={focused.signal === 'RISING' ? 'high' : focused.signal === 'FALLING' ? 'low' : 'neutral'} dot>
                          {focused.signal}
                        </Badge>
                        <span className="font-mono text-[15px]" style={{ color: SIGNAL_TONES[focused.signal] }}>
                          {signed(focused.delta_from_current, 1)} pts in 7 days
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="label mb-1">7-day forecast</div>
                      <Sparkline values={focused.forecast.map((f) => f.predicted_score)} tone={SIGNAL_TONES[focused.signal]} width={260} height={56} />
                      <div className="mt-1 flex gap-1">
                        {focused.forecast.map((f) => (
                          <div key={f.day_offset} className="flex-1 text-center">
                            <div className="font-mono text-[10.5px]" style={{ color: SIGNAL_TONES[focused.signal] }}>{fmt(f.predicted_score, 0)}</div>
                            <div className="text-[9px] text-ink-faint">d+{f.day_offset}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="label mb-1">Peak day</div>
                      <div className="text-[12px]">
                        <span className="font-mono">{fmt(focused.peak_day.predicted_score, 0)}</span>
                        <span className="text-ink-faint"> on {fmtDate(focused.peak_day.date)}</span>
                      </div>
                    </div>
                    <div>
                      <div className="label mb-1">Model provenance</div>
                      <div className="text-[10.5px] text-ink-dim">
                        <code className="font-mono">{focused.model}</code> · trained on <code className="font-mono">{focused.training_size}</code> sliding windows (last 14 days → next 7).
                        <br />
                        {focused.low_confidence ? (
                          <span className="text-[color:var(--risk-elevated)]">⚠ MLP and linear baseline disagree by &gt;15 pts — treat with caution.</span>
                        ) : (
                          <span className="text-[color:var(--risk-low)]">✓ MLP and linear baseline agree within 15 pts.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Panel>
              )}
            </div>
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
