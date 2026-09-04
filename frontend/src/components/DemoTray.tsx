import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, endpoints } from '../lib/api'
import { useApp } from '../state/app'
import { Badge, Button, Icon, cx } from './ui'
import { bandFor, signed } from '../lib/format'

/**
 * Hackathon demo mode.
 *
 * A judging slot is 8 minutes and laptops fail. This tray lets the presenter
 * either walk the scripted eight scenes manually or let the app place them:
 * every step is a real API call through the real workflow, and the reset button
 * restores the seeded baseline, so a broken take-back is impossible.
 */
const SCENES = [
  {
    id: 1,
    label: 'Problem',
    title: 'Compliance is fragmented',
    body: 'Inspections, findings, departments and corrective actions live in separate places. Nothing tells management which of them is becoming dangerous.',
    route: '/',
    cta: 'Show command center',
  },
  {
    id: 2,
    label: 'Discover',
    title: 'One zone is critical',
    body: 'Alpha Colliery Zone B carries the highest engine score in the portfolio. The map paints it before any table does.',
    route: '/mines/MINE-ALPHA',
    cta: 'Open mine map',
  },
  {
    id: 3,
    label: 'Ask why',
    title: 'Explainability, not a number',
    body: 'Open the zone dossier: five capped factors with their points, the conditions detected in words, and what to do about them.',
    route: '/risk',
    cta: 'Open risk intelligence',
  },
  {
    id: 4,
    label: 'New inspection',
    title: 'A field inspector records a finding',
    body: 'The inspection form projects the risk impact before submission — live re-scoring, not a formula in the browser.',
    route: '/inspections?new=1',
    cta: 'Open inspection form',
  },
  {
    id: 5,
    label: 'AI reacts',
    title: 'The score moves immediately',
    body: 'On submit, the engine re-scores the zone, the mine, the enterprise and re-evaluates every alert in the same request.',
    route: '/violations?zone=Z-ALPHA-B&status=OPEN_ANY',
    cta: 'See the new finding',
  },
  {
    id: 6,
    label: 'Action',
    title: 'Assign ownership with a deadline',
    body: 'The violation cannot skip stages. A corrective action is raised with an officer and a committed date.',
    route: '/actions?status=ACTIVE',
    cta: 'Open action queue',
  },
  {
    id: 7,
    label: 'Resolution',
    title: 'Evidence, then verification',
    body: 'The officer submits evidence (ACTION_SUBMITTED). Only a manager can verify — an officer cannot sign off their own work.',
    route: '/actions?status=PENDING_VERIFICATION',
    cta: 'Open verification queue',
  },
  {
    id: 8,
    label: 'Result',
    title: 'Risk falls, learning remains',
    body: 'Closure re-scores the zone. Recurring categories keep their weight, so the insight says to keep watching.',
    route: '/early-warning',
    cta: 'See updated warnings',
  },
]

export function DemoTray() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const navigate = useNavigate()
  const { invalidate, pushToast, boot } = useApp()

  const scene = SCENES[active]

  const runScenario = async () => {
    setRunning(true)
    setNote(null)
    try {
      const res = await api.post<any>(endpoints.scenario, { name: 'ZONE_B_ESCALATION' })
      setNote(`Baseline ${res.risk_impact.before.toFixed(1)} → ${res.risk_impact.after.toFixed(1)} (${signed(res.risk_impact.delta, 1)}) — scripted escalation applied through the real workflow.`)
      invalidate()
      navigate('/mines/MINE-ALPHA')
      pushToast({ kind: 'success', title: 'Demo scenario applied', body: `Zone B risk is now ${res.risk_impact.after.toFixed(0)}.` })
    } catch (e) {
      pushToast({ kind: 'error', title: 'Scenario failed', body: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  const doReset = async () => {
    setRunning(true)
    try {
      await api.post(endpoints.reset)
      invalidate()
      setActive(0)
      setNote(null)
      navigate('/')
      pushToast({ kind: 'success', title: 'Demo reset', body: 'Seeded baseline restored — safe to present again.' })
    } catch (e) {
      pushToast({ kind: 'error', title: 'Reset failed', body: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-11 left-3 z-40 flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1.5 text-[11px] font-medium text-ink-dim shadow-pop transition-colors hover:border-accent hover:text-ink no-print"
        title="Demo mode — scripted scenarios and reset"
      >
        <Icon name="target" className="h-3.5 w-3.5 text-[color:var(--accent)]" />
        Demo mode
      </button>
    )
  }

  return (
    <div className="fixed bottom-11 left-3 z-40 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-md border border-line bg-panel shadow-pop no-print">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Icon name="target" className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          <span className="panel-title">Demo mode · SIH26024</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Collapse demo tray" className="text-ink-faint hover:text-ink">
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3">
        <div className="flex flex-wrap gap-1">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setActive(i)
                navigate(s.route)
              }}
              className={cx(
                'h-6 w-6 rounded border font-mono text-[10.5px] transition-colors',
                i === active ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-sunken text-ink-faint hover:text-ink',
              )}
              title={s.title}
            >
              {s.id}
            </button>
          ))}
          <Badge tone="neutral" className="ml-auto self-center">
            {boot?.enterprise.risk_score.toFixed(0) ?? '—'} risk
          </Badge>
        </div>

        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide2 text-ink-faint">Scene {scene.id} · {scene.label}</p>
        <h4 className="mt-0.5 text-[13px] font-semibold leading-snug">{scene.title}</h4>
        <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">{scene.body}</p>
        {note && (
          <p className="mt-2 rounded border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/8 p-1.5 text-[11px] leading-snug text-ink-dim">{note}</p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => navigate(scene.route)}>
            {scene.cta}
          </Button>
          <Button size="sm" variant="outline" loading={running} onClick={runScenario} title="Seed baseline, then record the repeat safety-equipment finding that starts the story">
            Run escalation
          </Button>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => {
              const next = (active + 1) % SCENES.length
              setActive(next)
              navigate(SCENES[next].route)
            }}
          >
            Next scene
          </Button>
          <Button size="sm" variant="danger" loading={running} onClick={doReset} title="Restore the deterministic seed state">
            Reset
          </Button>
        </div>
      </div>
    </div>
  )
}
