import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './state/app'
import { AppShell } from './components/layout'
import { Button, Icon, Spinner, cx } from './components/ui'
import { CommandCenter } from './pages/CommandCenter'
import { MinesPage, MineDetailPage } from './pages/Mines'
import { InspectionsPage } from './pages/Inspections'
import { ViolationsPage } from './pages/Violations'
import { ActionsPage } from './pages/Actions'
import { RiskIntelligencePage } from './pages/RiskIntelligence'
import { EarlyWarningPage } from './pages/EarlyWarning'
import { ReportsPage } from './pages/Reports'
import { DocumentsPage } from './pages/Documents'
import { AdminPage } from './pages/Admin'

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function Shell() {
  const { boot, bootError, reloadBoot } = useApp()

  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-line bg-panel p-6 text-center shadow-pop">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)' }}>
            <Icon name="alert" className="h-5 w-5 text-[color:var(--danger)]" />
          </div>
          <h1 className="mt-3 text-[16px] font-semibold">Backend not reachable</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{bootError}</p>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Start it with <code className="rounded bg-sunken px-1 font-mono">uvicorn api.main:app --port 8000</code> from the project root.
          </p>
          <Button className="mt-4" variant="primary" onClick={reloadBoot} icon={<Icon name="refresh" className="h-3.5 w-3.5" />}>
            Retry connection
          </Button>
        </div>
      </div>
    )
  }

  if (!boot) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Spinner className="h-6 w-6 text-[color:var(--accent)]" />
        <p className="text-[12px] tracking-wide2 text-ink-faint uppercase">Initialising compliance intelligence…</p>
      </div>
    )
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/mines" element={<MinesPage />} />
        <Route path="/mines/:mineId" element={<MineDetailPage />} />
        <Route path="/inspections" element={<InspectionsPage />} />
        <Route path="/violations" element={<ViolationsPage />} />
        <Route path="/actions" element={<ActionsPage />} />
        <Route path="/risk" element={<RiskIntelligencePage />} />
        <Route path="/early-warning" element={<EarlyWarningPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </AppShell>
  )
}

function ToastHost() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[60] flex w-[min(390px,calc(100vw-24px))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto animate-fade-up rounded-md border bg-panel p-2.5 shadow-pop',
            t.kind === 'error' ? 'border-[color:var(--danger)]/50' : t.kind === 'success' ? 'border-[color:var(--ok)]/50' : 'border-line',
          )}
          role="status"
        >
          <div className="flex items-start gap-2">
            <Icon
              name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'}
              className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', t.kind === 'error' ? 'text-[color:var(--danger)]' : t.kind === 'success' ? 'text-[color:var(--ok)]' : 'text-[color:var(--accent)]')}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold leading-snug">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-dim break-words">{t.body}</p>}
              {t.action && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 -ml-1"
                  onClick={() => {
                    t.action!.run()
                    dismissToast(t.id)
                  }}
                >
                  {t.action.label}
                </Button>
              )}
            </div>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" className="text-ink-faint hover:text-ink">
              <Icon name="close" className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
