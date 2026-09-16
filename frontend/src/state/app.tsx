import { useEffect, useMemo, useRef, useState } from 'react'
import { api, endpoints, setActor } from '../lib/api'
import type { Bootstrap } from '../lib/types'

/**
 * Application state.
 *
 * `useAsync` is the single fetch primitive: it aborts on unmount, distinguishes
 * loading / error / empty, and refreshes on demand. `AppContext` holds what must
 * be shared — bootstrap data, the acting user (which the API uses for real
 * authorisation), theme, and the toast queue that reports every mutation.
 */

export type AsyncState<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void; setData: (updater: (prev: T | null) => T | null) => void }

export function useAsync<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError(null)
    api
      .get<T>(path, controller.signal)
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, loading, error, reload: () => setNonce((n) => n + 1), setData: (updater) => setData((prev) => updater(prev)) }
}

// ------------------------------------------------------------------- context
export type Toast = { id: number; kind: 'success' | 'error' | 'info'; title: string; body?: string; action?: { label: string; run: () => void } }

type AppCtx = {
  boot: Bootstrap | null
  bootError: string | null
  reloadBoot: () => void
  actorId: string
  setActorId: (id: string) => void
  actor: { id: string; name: string; role: string; designation: string; mine_id: string | null; initials: string } | null
  theme: 'dark' | 'light'
  toggleTheme: () => void
  revision: number
  invalidate: () => void
  toasts: Toast[]
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  /** run a mutation, refresh dependent views, toast the result */
  mutate: <T,>(fn: () => Promise<T>, opts: { success?: string | ((res: T) => string); onError?: (e: Error) => string }) => Promise<T | null>
  busy: boolean
}

import React from 'react'
export const AppContext = React.createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = React.useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [actorId, setActorIdState] = useState<string>(() => {
    try {
      return localStorage.getItem('mineguard.actor') || 'U-401'
    } catch {
      return 'U-401'
    }
  })
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('mineguard.theme') as 'dark' | 'light') || 'dark'
    } catch {
      return 'dark'
    }
  })
  const [revision, setRevision] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)
  const toastId = useRef(1)

  const loadBoot = useMemo(
    () => () =>
      api
        .get<Bootstrap>(endpoints.bootstrap)
        .then((b) => {
          setBoot(b)
          setBootError(null)
        })
        .catch((e: Error) => setBootError(e.message)),
    [],
  )

  useEffect(() => {
    loadBoot()
  }, [loadBoot, revision])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-dark', 'theme-light')
    root.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light')
    try {
      localStorage.setItem('mineguard.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const pushToast = (t: Omit<Toast, 'id'>) => {
    const id = toastId.current++
    setToasts((prev) => [...prev, { ...t, id }].slice(-4))
    const ttl = t.kind === 'error' ? 9000 : 5200
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl)
  }

  const actor = useMemo(() => boot?.users.find((u) => u.id === actorId) ?? null, [boot, actorId])

  const ctx: AppCtx = {
    boot,
    bootError,
    reloadBoot: loadBoot,
    actorId,
    actor,
    setActorId: (id) => {
      setActorIdState(id)
      setActor(id)
      setRevision((r) => r + 1)
    },
    theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    revision,
    invalidate: () => setRevision((r) => r + 1),
    toasts,
    pushToast,
    dismissToast: (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    busy,
    mutate: async <T,>(fn: () => Promise<T>, opts: { success?: string | ((res: T) => string); onError?: (e: Error) => string } = {}) => {
      setBusy(true)
      try {
        const res = await fn()
        if (opts.success) {
          const msg = typeof opts.success === 'function' ? opts.success(res) : opts.success
          pushToast({ kind: 'success', title: msg })
        }
        setRevision((r) => r + 1)
        return res
      } catch (e) {
        pushToast({
          kind: 'error',
          title: 'Action rejected',
          body: opts.onError ? opts.onError(e as Error) : (e as Error).message,
        })
        return null
      } finally {
        setBusy(false)
      }
    },
  }

  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
