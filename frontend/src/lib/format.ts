/** Formatting helpers shared by every view. */

export const RISK_TONES = ['low', 'moderate', 'elevated', 'high', 'critical'] as const
export type RiskTone = (typeof RISK_TONES)[number]

export function bandFor(score: number): { label: string; tone: RiskTone } {
  if (score <= 20) return { label: 'LOW', tone: 'low' }
  if (score <= 40) return { label: 'MODERATE', tone: 'moderate' }
  if (score <= 60) return { label: 'ELEVATED', tone: 'elevated' }
  if (score <= 80) return { label: 'HIGH', tone: 'high' }
  return { label: 'CRITICAL', tone: 'critical' }
}

export function toneClass(tone: string) {
  return `tone-${tone}`
}

export function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function signed(n: number, digits = 1): string {
  const v = fmt(Math.abs(n), digits)
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${v}`
}

export function pct(n: number, digits = 0): string {
  return `${signed(n, digits)}%`
}

export function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(value?: string | null): string {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(value?: string | null): string {
  const d = parseDate(value)
  if (!d) return '—'
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

export function daysBetween(from: string, to: string | Date = new Date()): number {
  const a = parseDate(from)
  const b = to instanceof Date ? to : parseDate(to)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function relative(value?: string | null): string {
  const d = parseDate(value)
  if (!d) return '—'
  const diff = Math.round((Date.now() - d.getTime()) / 86_400_000)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff < 30) return `${diff} days ago`
  if (diff < 60) return 'last month'
  return `${Math.round(diff / 30)} months ago`
}

export function humanize(value?: string | null): string {
  if (!value) return '—'
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function initials(name?: string): string {
  if (!name) return '··'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return ''
  const cols = columns ?? Object.keys(rows[0])
  const head = cols.map(csvEscape).join(',')
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n')
  return `${head}\n${body}`
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export const STATUS_TONE: Record<string, RiskTone | 'neutral'> = {
  OPEN: 'high',
  ASSIGNED: 'elevated',
  IN_PROGRESS: 'moderate',
  ACTION_SUBMITTED: 'info' as any,
  UNDER_VERIFICATION: 'info' as any,
  CLOSED: 'low',
  PENDING: 'moderate',
  SUBMITTED: 'moderate',
  VERIFIED: 'low',
  REJECTED: 'high',
  COMPLETED: 'low',
  COMPLIANT: 'low',
  NON_COMPLIANT: 'high',
  NEEDS_ATTENTION: 'elevated',
  OPERATIONAL: 'low',
  PROCESSED: 'low',
  FAILED: 'high',
  QUEUED_FOR_EXTRACTION: 'moderate',
  CLASSIFIED: 'moderate',
}

export const SEVERITY_TONE: Record<string, RiskTone> = {
  LOW: 'low',
  MEDIUM: 'moderate',
  HIGH: 'high',
  CRITICAL: 'critical',
}
