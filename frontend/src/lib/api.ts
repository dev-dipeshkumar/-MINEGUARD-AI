/**
 * Typed API client.
 *
 * One place owns: base URL, the actor header used for server-side
 * authorisation, error normalisation, and the abort-on-unmount pattern used by
 * every read hook.
 *
 * The base is relative by default — the dev server proxies /api and the
 * production build is served by FastAPI itself (sandbox preview, Docker
 * deploy), which keeps every call same-origin. Set `VITE_API_BASE_URL` at build
 * time only when the UI is hosted apart from the API (e.g. static hosting →
 * Render web service); the API already answers cross-origin preflights.
 */

const ACTOR_KEY = 'mineguard.actor'

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/** Resolve an app-relative `/api/...` path against the configured API origin. */
export function apiUrl(path: string): string {
  return API_BASE && path.startsWith('/api') ? `${API_BASE}${path}` : path
}

export class ApiError extends Error {
  status: number
  detail?: unknown
  constructor(message: string, status: number, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export function currentActor(): string {
  try {
    return localStorage.getItem(ACTOR_KEY) || 'U-401'
  } catch {
    return 'U-401'
  }
}

export function setActor(id: string) {
  try {
    localStorage.setItem(ACTOR_KEY, id)
  } catch {
    /* private mode — the header simply stays default */
  }
}


// ----------------------------------------------------------- engine telemetry
/**
 * The API answers every request with the engine that produced the numbers and how
 * long it took (X-Mineguard-Engine / X-Mineguard-Compute-Ms). Surfacing that in the
 * status bar costs nothing and makes the claim "these scores are computed, not
 * stored" checkable on screen.
 */
export interface EngineMeta {
  engine: string | null
  computeMs: number | null
  path: string
  at: number
}

let lastMeta: EngineMeta | null = null
const metaListeners = new Set<(m: EngineMeta) => void>()

export function getEngineMeta(): EngineMeta | null {
  return lastMeta
}

export function onEngineMeta(fn: (m: EngineMeta) => void): () => void {
  metaListeners.add(fn)
  return () => metaListeners.delete(fn)
}

function noteMeta(res: Response, path: string) {
  const raw = res.headers.get('x-mineguard-compute-ms')
  const meta: EngineMeta = {
    engine: res.headers.get('x-mineguard-engine'),
    computeMs: raw === null ? null : Number(raw),
    path,
    at: Date.now(),
  }
  if (!meta.engine && meta.computeMs === null) return
  lastMeta = meta
  metaListeners.forEach((fn) => fn(meta))
}

async function request<T>(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': currentActor(),
    },
    signal: opts.signal,
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  let res: Response
  try {
    res = await fetch(apiUrl(path), init)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(
      API_BASE
        ? `Cannot reach the MINEGUARD API at ${API_BASE}.`
        : 'Cannot reach the MINEGUARD API. Check that the backend is running on port 8000.',
      0,
    )
  }
  noteMeta(res, path)
  const text = await res.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { detail: text.slice(0, 400) }
  }
  if (!res.ok) {
    let message = payload?.detail ?? `Request failed (${res.status})`
    if (Array.isArray(message)) {
      // FastAPI validation errors → human sentences
      message = message
        .map((e: any) => `${String(e.loc?.slice(1).join('.') || 'input')}: ${e.msg?.replace(/^Value error, /, '') ?? e.msg}`)
        .join(' · ')
    }
    throw new ApiError(String(message), res.status, payload)
  }
  return payload as T
}

export const api = {
  get: <T,>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, { signal }),
  post: <T,>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('POST', path, body ?? {}, { signal }),
  patch: <T,>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('PATCH', path, body ?? {}, { signal }),
  async upload<T,>(path: string, form: FormData): Promise<T> {
    const res = await fetch(apiUrl(path), { method: 'POST', body: form, headers: { 'X-User-Id': currentActor() } })
    noteMeta(res, path)
    const text = await res.text()
    const payload = text ? JSON.parse(text) : null
    if (!res.ok) throw new ApiError(String(payload?.detail ?? `Upload failed (${res.status})`), res.status, payload)
    return payload as T
  },
  downloadUrl: (path: string) => apiUrl(path),
}

// ----------------------------------------------------------------- endpoints
export const endpoints = {
  bootstrap: '/api/bootstrap',
  dashboard: (mineId?: string) => `/api/dashboard${mineId ? `?mine_id=${mineId}` : ''}`,
  mines: '/api/mines',
  mine: (id: string) => `/api/mines/${id}`,
  mineRisk: (id: string) => `/api/mines/${id}/risk`,
  zoneRisk: (id: string) => `/api/zones/${id}/risk`,
  zone: (id: string) => `/api/zones/${id}`,
  inspections: (q = '') => `/api/inspections${q ? `?${q}` : ''}`,
  inspection: (id: string) => `/api/inspections/${id}`,
  violations: (q = '') => `/api/violations${q ? `?${q}` : ''}`,
  violation: (id: string) => `/api/violations/${id}`,
  actions: (q = '') => `/api/corrective-actions${q ? `?${q}` : ''}`,
  alerts: (q = '') => `/api/alerts${q ? `?${q}` : ''}`,
  insights: '/api/insights',
  analytics: (q = '') => `/api/analytics${q ? `?${q}` : ''}`,
  simulate: '/api/risk/simulate',
  reports: '/api/reports',
  generateReport: '/api/reports/generate',
  reportPreview: (type: string, mineId?: string, days = 30) =>
    `/api/reports/preview/${type}?days=${days}${mineId ? `&mine_id=${mineId}` : ''}`,
  documents: '/api/documents',
  config: '/api/config',
  users: '/api/users',
  activity: '/api/activity',
  health: '/api/health',
  reset: '/api/admin/reset',
  scenario: '/api/admin/scenario',
  overrides: '/api/admin/overrides',
}
