import React, { useEffect, useRef, useState } from 'react'

/**
 * Small, dependency-free UI primitives.
 *
 * Everything here is a controlled, accessible building block: focus rings from
 * the theme, aria-invalid + message wiring for fields, real buttons (not divs)
 * for actions, and no colour-only meaning anywhere.
 */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

// ------------------------------------------------------------------- layout
export function Panel({
  title,
  subtitle,
  right,
  children,
  className,
  bodyClass,
  dense,
  as: As = 'section',
  tone,
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClass?: string
  dense?: boolean
  as?: any
  /** Marks a panel that asks for a decision: a coloured rule, no tint soup. */
  tone?: 'accent' | 'elevated' | 'danger' | 'neutral'
}) {
  const rule = tone === 'danger' ? 'var(--danger)' : tone === 'elevated' ? 'var(--risk-elevated)' : tone === 'accent' ? 'var(--accent)' : null
  return (
    <As className={cx('panel flex flex-col min-w-0', className)} style={rule ? { boxShadow: `inset 3px 0 0 ${rule}` } : undefined}>
      {(title || right) && (
        <header className="panel-header">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-faint">{subtitle}</p>}
          </div>
          {right && <div className="flex items-center gap-1.5 shrink-0">{right}</div>}
        </header>
      )}
      <div className={cx(dense ? 'p-0' : 'p-4', 'min-w-0 flex-1', bodyClass)}>{children}</div>
    </As>
  )
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('section-label', className)}>{children}</div>
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('hairline my-3', className)} />
}

// ------------------------------------------------------------------ buttons
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

export function Button({ variant = 'outline', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-all select-none disabled:opacity-45 disabled:cursor-not-allowed active:translate-y-px'
  const sizes = { sm: 'text-[11px] px-2 py-1', md: 'text-[12.5px] px-3 py-1.5', lg: 'text-[14px] px-4 py-2.5' }[size]
  const variants = {
    primary: 'bg-accent text-[color:var(--accent-ink)] hover:brightness-110 shadow-panel font-semibold',
    outline: 'bg-raised text-ink border border-line hover:border-line-strong hover:bg-sunken',
    ghost: 'text-ink-dim hover:text-ink hover:bg-raised',
    subtle: 'bg-sunken text-ink-dim hover:text-ink border border-transparent hover:border-line',
    danger: 'bg-[color:var(--danger)]/12 text-[color:var(--danger)] border border-[color:var(--danger)]/45 hover:bg-[color:var(--danger)]/22',
  }[variant]
  return (
    <button type="button" className={cx(base, sizes, variants, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner className="h-3.5 w-3.5" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded border border-line bg-raised text-ink-dim hover:text-ink hover:border-line-strong transition-colors',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'h-4 w-4')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// -------------------------------------------------------------------- badges
export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
  dot,
}: {
  children: React.ReactNode
  tone?: string
  className?: string
  title?: string
  dot?: boolean
}) {
  const style: React.CSSProperties | undefined =
    tone === 'info'
      ? ({ ['--tone' as any]: 'var(--info)' } as any)
      : tone !== 'neutral'
      ? ({ ['--tone' as any]: `var(--risk-${tone})` } as any)
      : undefined
  const neutral = tone === 'neutral'
  return (
    <span
      title={title}
      style={style}
      className={cx(
        'chip',
        neutral ? 'border-line bg-sunken text-ink-dim' : 'tone-soft border',
        className,
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', neutral ? 'bg-ink-faint' : 'tone-bg')} />}
      {children}
    </span>
  )
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded bg-sunken border border-line px-1.5 py-0.5 text-[11px] text-ink-dim', className)}>{children}</span>
}

// -------------------------------------------------------------------- forms
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <label htmlFor={htmlFor} className="label flex items-center gap-1 mb-1">
        {label}
        {required && <span className="text-[color:var(--danger)]">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-[color:var(--danger)]" role="alert">
          <Icon name="alert" className="h-3 w-3 mt-0.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean }) {
  const { invalid, mono, className, ...rest } = props
  return <input aria-invalid={invalid || undefined} className={cx('field-input', mono && 'font-mono', className)} {...rest} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props
  return <textarea aria-invalid={invalid || undefined} className={cx('field-input resize-y min-h-[70px] leading-snug', className)} {...rest} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const { invalid, className, children, ...rest } = props
  return (
    <div className="relative">
      <select aria-invalid={invalid || undefined} className={cx('field-input appearance-none pr-7', className)} {...rest}>
        {children}
      </select>
      <Icon name="chevron" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number; tone?: string }[]
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div role="tablist" className={cx('inline-flex flex-wrap items-center gap-0.5 rounded border border-line bg-sunken p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded px-2 font-medium transition-colors',
              size === 'sm' ? 'text-[11px] py-0.5' : 'text-[12px] py-1',
              active ? 'bg-panel text-ink shadow-panel border border-line' : 'text-ink-dim hover:text-ink border border-transparent',
            )}
          >
            {o.tone && <span className={cx('mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle', `tone-${o.tone}`)} style={{ background: `var(--risk-${o.tone})` }} />}
            {o.label}
            {o.count !== undefined && <span className={cx('ml-1 font-mono text-[10px]', active ? 'text-ink-dim' : 'text-ink-faint')}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-[18px] w-8 rounded-full border transition-colors', checked ? 'bg-accent/80 border-accent' : 'bg-sunken border-line')}
    >
      <span className={cx('absolute top-[2px] h-3 w-3 rounded-full bg-panel transition-all', checked ? 'left-[16px]' : 'left-[2px]')} />
    </button>
  )
}

// --------------------------------------------------------------------- misc
export function Progress({ value, max = 100, tone = 'var(--accent)', className, height = 6 }: { value: number; max?: number; tone?: string; className?: string; height?: number }) {
  const width = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  return (
    <div className={cx('w-full rounded-full bg-sunken overflow-hidden', className)} style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, background: tone }} />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />
}

export function EmptyState({
  icon = 'check',
  title,
  body,
  action,
  className,
}: {
  icon?: IconName
  title: string
  body?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 py-10 text-center', className)}>
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-sunken text-ink-faint">
        <Icon name={icon} className="h-4 w-4" />
      </div>
      <p className="text-[13px] font-medium text-ink-dim">{title}</p>
      {body && <p className="max-w-sm text-[12px] leading-relaxed text-ink-faint">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/8 p-3">
      <div className="flex items-start gap-2">
        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--danger)]" />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink">Request failed</p>
          <p className="text-[12px] leading-snug text-ink-dim break-words">{message}</p>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} icon={<Icon name="refresh" className="h-3 w-3" />}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cx('w-full animate-fade-up rounded-lg border border-line bg-panel shadow-pop', width)}>
        <header className="panel-header">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="text-[11.5px] text-ink-faint mt-0.5">{subtitle}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <Icon name="close" className="h-3.5 w-3.5" />
          </IconButton>
        </header>
        <div className="max-h-[64vh] overflow-y-auto px-4 py-3.5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-[560px] animate-fade-up flex-col border-l border-line bg-panel shadow-pop" role="dialog" aria-modal="true">
        <header className="panel-header sticky top-0 bg-panel">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-[11.5px] text-ink-faint mt-0.5 truncate">{subtitle}</p>}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <Icon name="close" className="h-3.5 w-3.5" />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  )
}

export function Tooltip({ children, tip, className }: { children: React.ReactNode; tip: React.ReactNode; className?: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className={cx('relative inline-flex', className)} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[280px] -translate-x-1/2 rounded border border-line bg-raised px-2 py-1 text-[11px] leading-snug text-ink shadow-pop">
          {tip}
        </span>
      )}
    </span>
  )
}

export function Avatar({ name, className, tone }: { name: string; className?: string; tone?: string }) {
  const txt = (name || '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      className={cx('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold', className)}
      style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-sunken)', color: tone ? `var(--risk-${tone})` : 'var(--text-dim)' }}
      title={name}
    >
      {txt || '··'}
    </span>
  )
}

export function Table({ head, children, className }: { head: React.ReactNode[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto -mx-4 px-4', className)}>
      <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className={cx('label px-2 py-2 text-left font-semibold first:pl-0 last:pr-0 whitespace-nowrap', typeof h === 'string' && '' )}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--line)]">{children}</tbody>
      </table>
    </div>
  )
}

// --------------------------------------------------------------------- icons
export type IconName =
  | 'dashboard'
  | 'map'
  | 'brain'
  | 'clipboard'
  | 'alert'
  | 'wrench'
  | 'chart'
  | 'file'
  | 'report'
  | 'settings'
  | 'close'
  | 'chevron'
  | 'chevronLeft'
  | 'refresh'
  | 'search'
  | 'plus'
  | 'check'
  | 'arrowUp'
  | 'arrowDown'
  | 'arrowRight'
  | 'download'
  | 'sun'
  | 'moon'
  | 'user'
  | 'clock'
  | 'pin'
  | 'target'
  | 'spark'
  | 'shield'
  | 'menu'
  | 'info'
  | 'link'
  | 'eye'
  | 'upload'

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h7v8H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  map: 'M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Zm0 0v16m6-14v16',
  brain: 'M12 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8A3 3 0 0 0 16 16v-3.2A3 3 0 0 0 15 7a3 3 0 0 0-3-3Zm0 0v15',
  clipboard: 'M8 4h8v3H8zM6 6h12v15H6zM9 11h6M9 15h6',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v5m0 2.5v.5',
  wrench: 'M15 4a5 5 0 0 0-4.6 7L4 17.4 6.6 20l6.4-6.4A5 5 0 0 0 20 9l-3 3-2-2 3-3a5 5 0 0 0-3-3Z',
  chart: 'M4 20V9m5 11V4m5 16v-7m5 7V7',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  report: 'M6 3h9l3 3v15H6zM9 11h6M9 15h6M9 19h3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3-2-.6.5-1.7-1.4-1.4-1.7.5L15 8V6l-2-1.5h-2L9 6v2l-1.4 1.3-1.7-.5L4.5 10l.5 1.7L3 12l.6 2 1.7-.5-.5 1.7 1.4 1.4 1.7-.5L9 18l2 1.5h2l1.5-1.7 1.7.5 1.4-1.4-.5-1.7 1.7-.6Z',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm6 9 6 6 6-6',
  chevronLeft: 'm15 6-6 6 6 6',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.4M20 5v6h-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4',
  plus: 'M12 5v14M5 12h14',
  check: 'm4 13 5 5L20 7',
  arrowUp: 'M12 20V5m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 4v15m0 0 6-6m-6 6-6-6',
  arrowRight: 'M4 12h15m0 0-6-6m6 6-6 6',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  moon: 'M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10Z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-7 16a7 7 0 0 1 14 0',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v4l3 2',
  pin: 'M12 3a5 5 0 0 0-5 5c0 4 5 13 5 13s5-9 5-13a5 5 0 0 0-5-5Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  shield: 'M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Zm0 6v4m0 2v.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v.5m0 3V16',
  link: 'M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.6-5.6l-1 1m-1.4 5.1a4 4 0 0 1-6-.5l-2 2A4 4 0 0 0 9 18.2l1-1',
  eye: 'M12 5C6 5 3 12 3 12s3 7 9 7 9-7 9-7-3-7-9-7Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  upload: 'M12 20V9m0 0 4 4m-4-4-4 4M5 5h14',
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cx('h-4 w-4', className)} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function KeyHint({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-sunken px-1 font-mono text-[10px] text-ink-dim">{children}</kbd>
}

export function useCopy(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false)
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      },
      () => setDone(false),
    )
  }
  return [done, copy]
}

// --------------------------------------------------------------------- tabs
export function Tabs({
  value,
  onChange,
  items,
  className,
}: {
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string; count?: number }[]
  className?: string
}) {
  return (
    <div role="tablist" aria-orientation="horizontal" className={cx('flex gap-0.5 overflow-x-auto', className)}>
      {items.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cx(
              'relative whitespace-nowrap rounded-t border-b-2 px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              active ? 'border-[color:var(--accent)] text-ink' : 'border-transparent text-ink-dim hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cx('ml-1.5 rounded px-1 font-mono text-[10px]', active ? 'bg-sunken text-ink-dim' : 'bg-sunken text-ink-faint')}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
