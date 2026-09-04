import React, { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, Icon, IconButton, KeyHint, cx, type IconName } from './ui'
import { useApp } from '../state/app'
import { getEngineMeta, onEngineMeta, type EngineMeta } from '../lib/api'
import { bandFor } from '../lib/format'

/**
 * Application shell: collapsible sidebar, dense top bar with global search,
 * role switcher (which drives real server-side authorisation), theme toggle and
 * the demo reset that makes a hackathon run safe.
 */

type NavItem = { to: string; label: string; icon: IconName; group: string; badge?: 'alerts' | 'violations' }

const NAV: NavItem[] = [
  { to: '/', label: 'Command Center', icon: 'dashboard', group: 'OVERRIDE' },
  { to: '/mines', label: 'Mines & Zones', icon: 'map', group: 'OPERATIONS' },
  { to: '/inspections', label: 'Inspections', icon: 'clipboard', group: 'OPERATIONS' },
  { to: '/violations', label: 'Violations', icon: 'alert', group: 'OPERATIONS' },
  { to: '/actions', label: 'Corrective Actions', icon: 'wrench', group: 'OPERATIONS' },
  { to: '/risk', label: 'Risk Intelligence', icon: 'brain', group: 'INTELLIGENCE' },
  { to: '/early-warning', label: 'Early Warning', icon: 'spark', group: 'INTELLIGENCE', badge: 'alerts' },
  { to: '/reports', label: 'Reports', icon: 'report', group: 'ENTERPRISE' },
  { to: '/documents', label: 'Documents', icon: 'file', group: 'ENTERPRISE' },
  { to: '/admin', label: 'Administration', icon: 'settings', group: 'ENTERPRISE' },
]

const COLLAPSE_KEY = 'mineguard.sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { boot, actor } = useApp()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const groups = useMemo(() => {
    const out: Record<string, NavItem[]> = {}
    NAV.forEach((n) => {
      ;(out[n.group] ||= []).push(n)
    })
    return out
  }, [])

  const enterprise = boot?.enterprise
  const tone = enterprise ? bandFor(enterprise.risk_score).tone : 'low'

  return (
    <div className="flex h-full min-h-screen">
      {/* ---------------------------------------------------------- sidebar */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-[228px] flex-col border-r border-line bg-panel transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full',
          collapsed && 'lg:w-[58px]',
        )}
      >
        <div className={cx('flex items-center gap-2.5 border-b border-line px-3 py-3', collapsed && 'lg:justify-center lg:px-0')}>
          <Logo />
          <div className={cx('min-w-0 leading-none', collapsed && 'lg:hidden')}>
            <div className="text-[13.5px] font-bold tracking-tightest">
              MINEGUARD <span className="text-[color:var(--accent)]">AI</span>
            </div>
            <div className="mt-1 text-[9.5px] uppercase tracking-wide2 text-ink-faint">Compliance intelligence</div>
          </div>
          <IconButton label="Close navigation" className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)}>
            <Icon name="close" className="h-3.5 w-3.5" />
          </IconButton>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2.5" aria-label="Primary">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-3">
              <div className={cx('px-2 pb-1 text-[9px] font-semibold uppercase tracking-wide2 text-ink-faint', collapsed && 'lg:hidden')}>{group}</div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cx(
                          'group relative flex items-center gap-2.5 rounded px-2 py-[7px] text-[12.5px] font-medium transition-colors',
                          isActive ? 'bg-raised text-ink' : 'text-ink-dim hover:bg-raised/60 hover:text-ink',
                          collapsed && 'lg:justify-center lg:px-0',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r" style={{ background: 'var(--accent)' }} />}
                          <Icon name={item.icon} className={cx('h-[15px] w-[15px] shrink-0', isActive && 'text-[color:var(--accent)]')} />
                          <span className={cx('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                          {item.badge === 'alerts' && <NavCount kind="alerts" collapsed={!!collapsed} />}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cx('border-t border-line p-2', collapsed && 'lg:px-1')}>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden w-full items-center gap-2 rounded px-2 py-1.5 text-[11.5px] text-ink-faint hover:bg-raised hover:text-ink lg:flex"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <Icon name="chevronLeft" className={cx('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
            <span className={cx(collapsed && 'hidden')}>Collapse</span>
          </button>
          {enterprise && (
            <Link
              to="/"
              className={cx('mt-1 block rounded border px-2 py-1.5', collapsed && 'lg:hidden')}
              style={{ borderColor: `color-mix(in srgb, var(--risk-${tone}) 45%, transparent)` }}
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide2 text-ink-faint">
                <span>Enterprise risk</span>
                <span className="font-mono" style={{ color: `var(--risk-${tone})` }}>
                  {enterprise.risk_score.toFixed(0)}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-sunken">
                <div className="h-full rounded" style={{ width: `${enterprise.risk_score}%`, background: `var(--risk-${tone})` }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
                <span>compliance</span>
                <span className="font-mono text-ink-dim">{enterprise.compliance_score.toFixed(0)}/100</span>
              </div>
            </Link>
          )}
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/55 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* -------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1 bg-app">{children}</main>
        <Statusbar />
      </div>
    </div>
  )
}

function NavCount({ kind, collapsed }: { kind: 'alerts'; collapsed: boolean }) {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/alerts')
      .then((r) => r.json())
      .then((d) => alive && setN(d.alerts.filter((a: any) => a.severity === 'CRITICAL').length))
      .catch(() => alive && setN(null))
    return () => {
      alive = false
    }
  }, [])
  if (!n) return null
  return (
    <span
      className={cx('ml-auto rounded px-1 font-mono text-[9.5px] font-bold', collapsed && 'lg:absolute lg:right-1 lg:top-0.5 lg:ml-0')}
      style={{ background: 'var(--risk-critical)', color: '#fff' }}
    >
      {n}
    </span>
  )
}

function Logo() {
  return (
    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sunken ring-1 ring-line">
      <svg viewBox="0 0 32 32" className="h-[18px] w-[18px]" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round">
        <path d="M5 24l6-14 5 9 3-5 8 10z" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: 'var(--risk-critical)' }} />
    </span>
  )
}

// ------------------------------------------------------------------- top bar
function Topbar({ onMenu }: { onMenu: () => void }) {
  const { boot, actor, actorId, setActorId, theme, toggleTheme, invalidate, mutate } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const navigate = useNavigate()

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2 || !boot) return []
    const out: { label: string; sub: string; to: string; icon: IconName }[] = []
    boot.mines.forEach((m) => {
      if (m.name.toLowerCase().includes(term) || m.code.toLowerCase().includes(term) || m.location.toLowerCase().includes(term))
        out.push({ label: m.name, sub: `Mine · ${m.location}`, to: `/mines/${m.id}`, icon: 'map' })
    })
    boot.zones.forEach((z) => {
      if (z.name.toLowerCase().includes(term)) out.push({ label: z.name, sub: `Zone · ${z.mine_name}`, to: `/mines/${z.mine_id}?zone=${z.id}`, icon: 'pin' })
    })
    boot.users.forEach((u) => {
      if (u.name.toLowerCase().includes(term)) out.push({ label: u.name, sub: `${u.role} · ${u.designation}`, to: '/admin', icon: 'user' })
    })
    if (/vio-\d+/.test(term)) out.push({ label: term.toUpperCase(), sub: 'Violation record', to: `/violations?search=${term}`, icon: 'alert' })
    return out.slice(0, 7)
  }, [q, boot])

  const doReset = async () => {
    setResetting(true)
    await mutate(() => fetch('/api/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': actorId } }).then(async (r) => {
      const payload = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(String((payload as any).detail ?? 'Reset failed'))
      return payload
    }), { success: 'Demo scenario reset — all mines, violations and risk history restored to the seeded baseline' })
    setResetting(false)
    invalidate()
  }

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel/95 px-3 py-2 backdrop-blur">
      <IconButton label="Open navigation" className="lg:hidden" onClick={onMenu}>
        <Icon name="menu" className="h-4 w-4" />
      </IconButton>

      <div className="relative min-w-0 flex-1 max-w-[420px]">
        <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) {
              navigate(results[0].to)
              setQ('')
              setOpen(false)
            }
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search mines, zones, officers, violation IDs…"
          aria-label="Global search"
          className="field-input pl-7 pr-14 text-[12.5px]"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><KeyHint>↵</KeyHint></span>
        {open && results.length > 0 && (
          <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 animate-fade-up overflow-hidden rounded-md border border-line bg-panel shadow-pop">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onMouseDown={() => {
                    navigate(r.to)
                    setQ('')
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-raised"
                >
                  <Icon name={r.icon} className="h-3.5 w-3.5 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]">{r.label}</span>
                    <span className="block truncate text-[10.5px] text-ink-faint">{r.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 xl:flex" title={boot ? `${boot.engine.label} · ${boot.engine.phase}` : ''}>
          <Badge tone="neutral">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: boot?.engine.mode === 'rule-based' ? 'var(--accent)' : 'var(--ok)' }} />
            {boot?.engine.mode === 'rule-based' ? 'Rule-based Phase 1' : 'ML Phase 2'}
          </Badge>
          <Badge tone="neutral">as of {boot?.as_of}</Badge>
        </span>

        <RoleSwitcher actorId={actorId} setActorId={setActorId} actor={actor} />

        <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-3.5 w-3.5" />
        </IconButton>
        <Button size="sm" variant="subtle" loading={resetting} onClick={doReset} icon={<Icon name="refresh" className="h-3 w-3" />} title="Restore the deterministic demo scenario">
          <span className="hidden sm:inline">Reset demo</span>
        </Button>
      </div>
    </header>
  )
}

function RoleSwitcher({ actorId, setActorId, actor }: { actorId: string; setActorId: (id: string) => void; actor: any }) {
  const { boot } = useApp()
  const [open, setOpen] = useState(false)
  const users = boot?.users ?? []
  const groups = useMemo(() => {
    const out: Record<string, any[]> = {}
    users.forEach((u) => ((out[u.role] ||= []).push(u)))
    return out
  }, [users])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded border border-line bg-raised px-1.5 py-1 text-left hover:border-line-strong"
        title="Switch the acting user. Permissions are enforced by the API, not hidden by the UI."
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sunken font-mono text-[9.5px] font-semibold text-ink-dim">{actor?.initials ?? '··'}</span>
        <span className="hidden leading-none md:block">
          <span className="block text-[11.5px] font-medium">{actor?.name ?? 'Guest'}</span>
          <span className="block text-[9.5px] uppercase tracking-wide2 text-ink-faint">{actor?.role}</span>
        </span>
        <Icon name="chevron" className="h-3 w-3 text-ink-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-[268px] animate-fade-up rounded-md border border-line bg-panel p-2 shadow-pop">
          <p className="px-1 pb-1.5 text-[10px] leading-snug text-ink-faint">
            Acting as… <span className="text-ink-dim">permissions are enforced server-side, so switching role changes what the API accepts — not just what is shown.</span>
          </p>
          {Object.entries(groups).map(([role, list]) => (
            <div key={role} className="mb-1.5">
              <div className="label px-1 py-0.5">{role}</div>
              {list.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setActorId(u.id)
                    setOpen(false)
                  }}
                  className={cx('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-raised', u.id === actorId && 'bg-raised')}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sunken font-mono text-[9px] font-semibold text-ink-dim">{u.initials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{u.name}</span>
                    <span className="block truncate text-[10px] text-ink-faint">{u.designation}</span>
                  </span>
                  {u.id === actorId && <Icon name="check" className="h-3 w-3 text-[color:var(--accent)]" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- status bar
function Statusbar() {
  const { boot } = useApp()
  const [health, setHealth] = useState<any>(null)
  const [meta, setMeta] = useState<EngineMeta | null>(getEngineMeta())
  useEffect(() => {
    const off = onEngineMeta(setMeta)
    return off
  }, [])
  useEffect(() => {
    let alive = true
    const ping = () =>
      fetch('/api/health')
        .then((r) => r.json())
        .then((d) => alive && setHealth(d))
        .catch(() => alive && setHealth(null))
    ping()
    const t = setInterval(ping, 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  const counts = health?.counts
  return (
    <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-panel px-3 py-1.5 text-[10px] text-ink-faint">
      <span className="flex items-center gap-1">
        <span className={cx('h-1.5 w-1.5 rounded-full', health ? 'bg-[color:var(--ok)]' : 'bg-[color:var(--danger)]')} />
        {health ? 'API connected' : 'API unreachable'}
      </span>
      {counts && (
        <span className="font-mono">
          {counts.mines} mines · {counts.zones} zones · {counts.violations} violations · {counts.corrective_actions} actions · {counts.inspections} inspections · {counts.history_rows} history rows
        </span>
      )}
      <span className="ml-auto hidden items-center gap-2 sm:flex">
        {boot?.engine.label}
        {meta?.engine && (
          <span className="font-mono" title={`Last computed by the ${meta.engine} engine at ${meta.path}`}>
            · {meta.computeMs !== null ? `${meta.computeMs} ms` : 'served'}
          </span>
        )}
      </span>
      <span className="hidden lg:inline">MINEGUARD AI v1.0 · SIH26024</span>
    </footer>
  )
}

// -------------------------------------------------------------- page header
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  tabs,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
}) {
  return (
    <div className="border-b border-line bg-panel/60 px-4 py-3 lg:px-5">
      <div className="mx-auto flex max-w-[1720px] flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="label mb-1">{eyebrow}</div>}
          <h1 className="text-[19px] font-semibold leading-tight tracking-tightest">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-[12px] leading-snug text-ink-dim">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {tabs && <div className="mx-auto mt-3 max-w-[1720px]">{tabs}</div>}
    </div>
  )
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('mx-auto max-w-[1720px] p-4 lg:p-5', className)}>{children}</div>
}
