import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, KeyHint, cx } from './ui'
import type { IconName } from './ui'

/**
 * Cmd+K command palette.
 *
 * A senior-UX touch: every action the user can take should be reachable in
 * 2 keystrokes from anywhere. The palette surfaces:
 *  * Page navigation (matches the sidebar)
 *  * Quick-record actions (new inspection, raise grievance, mark attendance)
 *  * Demo controls (reset, escalation scenario)
 *
 * Open with Cmd+K (Mac) / Ctrl+K (other). Arrow keys to navigate,
 * Enter to fire, Esc to close.
 */
interface Cmd {
  id: string
  label: string
  sub?: string
  to?: string
  icon: IconName
  run?: () => void
  group: string
}

const COMMANDS: Cmd[] = [
  // --- Navigation ---
  { id: 'nav-home', label: 'Go to Command Center', sub: 'Today\'s dashboard', to: '/', icon: 'dashboard', group: 'Navigate' },
  { id: 'nav-3d', label: 'Go to 3D Portfolio', sub: 'Immersive multi-mine scene', to: '/3d', icon: 'map', group: 'Navigate' },
  { id: 'nav-forecast', label: 'Go to 7-Day Forecast', sub: 'MLPRegressor risk forecast', to: '/forecast', icon: 'spark', group: 'Navigate' },
  { id: 'nav-carbon', label: 'Go to Carbon Footprint', sub: 'IPCC Scope 1+2 emissions', to: '/carbon', icon: 'chart', group: 'Navigate' },
  { id: 'nav-mines', label: 'Go to Mines & Zones', to: '/mines', icon: 'map', group: 'Navigate' },
  { id: 'nav-inspections', label: 'Go to Inspections', to: '/inspections', icon: 'clipboard', group: 'Navigate' },
  { id: 'nav-violations', label: 'Go to Violations', to: '/violations', icon: 'alert', group: 'Navigate' },
  { id: 'nav-actions', label: 'Go to Corrective Actions', to: '/actions', icon: 'wrench', group: 'Navigate' },
  { id: 'nav-risk', label: 'Go to Risk Intelligence', to: '/risk', icon: 'brain', group: 'Navigate' },
  { id: 'nav-early-warning', label: 'Go to Early Warning', to: '/early-warning', icon: 'spark', group: 'Navigate' },
  { id: 'nav-ml', label: 'Go to ML Severity classifier', to: '/ml', icon: 'brain', group: 'Navigate' },
  { id: 'nav-production', label: 'Go to Production', to: '/production', icon: 'report', group: 'Navigate' },
  { id: 'nav-attendance', label: 'Go to Attendance', to: '/attendance', icon: 'clipboard', group: 'Navigate' },
  { id: 'nav-contractors', label: 'Go to Contractors', to: '/contractors', icon: 'file', group: 'Navigate' },
  { id: 'nav-grievances', label: 'Go to Grievances', to: '/grievances', icon: 'alert', group: 'Navigate' },
  { id: 'nav-reports', label: 'Go to Reports', to: '/reports', icon: 'report', group: 'Navigate' },
  { id: 'nav-documents', label: 'Go to Documents', to: '/documents', icon: 'file', group: 'Navigate' },
  { id: 'nav-admin', label: 'Go to Administration', to: '/admin', icon: 'settings', group: 'Navigate' },
  // --- Quick actions ---
  { id: 'qa-inspect', label: 'Record an inspection', sub: 'Open the inspection form on the zone of your choice', to: '/inspections?new=1', icon: 'plus', group: 'Quick action' },
  { id: 'qa-violation', label: 'Raise a violation', sub: 'Create a finding without an inspection round', to: '/violations?new=1', icon: 'plus', group: 'Quick action' },
  { id: 'qa-attendance', label: 'Mark today\'s attendance', sub: 'Geo-tagged at the muster point', to: '/attendance', icon: 'plus', group: 'Quick action' },
  { id: 'qa-grievance', label: 'Lodge a grievance', sub: 'Multilingual intake', to: '/grievances', icon: 'plus', group: 'Quick action' },
  { id: 'qa-ml', label: 'Try the ML severity classifier', sub: 'Predict severity from free-text', to: '/ml', icon: 'brain', group: 'Quick action' },
  { id: 'qa-3d', label: 'Open the 3D mine site view', sub: 'Extruded risk view, orbit controls', to: '/mines/MINE-ALPHA', icon: 'map', group: 'Quick action' },
  { id: 'qa-3d-portfolio', label: 'Open the 3D portfolio scene', sub: 'All four mines in one immersive scene', to: '/3d', icon: 'map', group: 'Quick action' },
]

export function CommandPalette({ onReset, onEscalate }: { onReset?: () => void; onEscalate?: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const navigate = useNavigate()

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQ('')
        setIdx(0)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Build the command list. Reset and escalate are appended only if their
  // callbacks were passed in — keeps the palette free of stub actions.
  const all = useMemo(() => {
    const list = [...COMMANDS]
    if (onReset) list.push({ id: 'demo-reset', label: 'Reset demo scenario', sub: 'Restore the seeded baseline', run: onReset, icon: 'refresh', group: 'Demo' })
    if (onEscalate) list.push({ id: 'demo-escalate', label: 'Run Zone B escalation', sub: 'One-click scripted demo', run: onEscalate, icon: 'spark', group: 'Demo' })
    return list
  }, [onReset, onEscalate])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((c) => (c.label + ' ' + (c.sub ?? '') + ' ' + c.group).toLowerCase().includes(term))
  }, [all, q])

  // Reset selection when filter changes
  useEffect(() => { setIdx(0) }, [q])

  // Group the filtered results for display
  const grouped = useMemo(() => {
    const out: Record<string, Cmd[]> = {}
    filtered.forEach((c) => { (out[c.group] ||= []).push(c) })
    return out
  }, [filtered])

  const fire = (cmd: Cmd) => {
    setOpen(false)
    setQ('')
    if (cmd.run) {
      cmd.run()
    } else if (cmd.to) {
      navigate(cmd.to)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-app/60 backdrop-blur-sm animate-fade-up"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      {/* Palette */}
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-lg border border-line bg-panel shadow-pop animate-fade-up">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Icon name="search" className="h-4 w-4 text-ink-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && filtered[idx]) { e.preventDefault(); fire(filtered[idx]) }
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Type a page name, an action, or a demo command…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
          />
          <KeyHint>Esc</KeyHint>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-ink-faint">No matches for "{q}"</div>
          ) : (
            Object.entries(grouped).map(([group, cmds]) => (
              <div key={group} className="mb-1.5">
                <div className="px-2 py-0.5 text-[9.5px] uppercase tracking-wide2 text-ink-faint">{group}</div>
                {cmds.map((cmd) => {
                  const i = filtered.indexOf(cmd)
                  return (
                    <button
                      key={cmd.id}
                      onMouseEnter={() => setIdx(i)}
                      onClick={() => fire(cmd)}
                      className={cx(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                        i === idx ? 'bg-raised' : 'hover:bg-raised/50',
                      )}
                    >
                      <Icon name={cmd.icon} className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px]">{cmd.label}</span>
                        {cmd.sub && <span className="block truncate text-[10.5px] text-ink-faint">{cmd.sub}</span>}
                      </span>
                      {i === idx && <KeyHint>↵</KeyHint>}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-line bg-sunken px-3 py-1.5 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <KeyHint>↑</KeyHint><KeyHint>↓</KeyHint> navigate
            <span className="mx-1">·</span>
            <KeyHint>↵</KeyHint> select
            <span className="mx-1">·</span>
            <KeyHint>Esc</KeyHint> close
          </span>
        </div>
      </div>
    </div>
  )
}
