import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldOff, WifiOff } from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { ApiError, NetworkError, errorMessage } from '@/lib/api'
import { Button } from './button'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface shadow-card', className)} {...props} />
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />
}

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'border-line bg-subtle text-ink-muted',
      brand: 'border-brand-200 bg-brand-50 text-brand-800',
      success: 'border-transparent bg-success-50 text-success-700',
      warning: 'border-warning-200 bg-warning-50 text-warning-700',
      danger: 'border-transparent bg-danger-50 text-danger-700',
      info: 'border-transparent bg-info-50 text-info-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-line/70', className)} aria-hidden />
}

export function Spinner({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function Avatar({ name, className, color }: { name: string; className?: string; color?: string | null }) {
  return (
    <span
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800', className)}
      style={color ? { backgroundColor: `${color}1f`, color } : undefined}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-subtle text-ink-faint">{icon ?? <Inbox className="size-5" />}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Error state with permission/network distinction and a retry action. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403
  const offline = error instanceof NetworkError
  const Icon = forbidden ? ShieldOff : offline ? WifiOff : AlertTriangle
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <Icon className="size-5" />
      </div>
      <h3 className="text-sm font-semibold text-ink">
        {forbidden ? 'Kein Zugriff' : offline ? 'Keine Verbindung' : 'Daten konnten nicht geladen werden'}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{errorMessage(error)}</p>
      {onRetry && !forbidden && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Erneut versuchen
        </Button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    info: 'border-info-700/20 bg-info-50 text-info-700',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    danger: 'border-danger-600/20 bg-danger-50 text-danger-700',
    success: 'border-success-700/20 bg-success-50 text-success-700',
  }[tone]
  return (
    <div className={cn('flex flex-col gap-2 rounded-md border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between', styles)}>
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function StatCard({ label, value, hint, icon, tone = 'neutral', onClick }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'neutral' | 'warning' | 'brand'
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'flex w-full flex-col rounded-lg border border-line bg-surface p-4 text-left shadow-card transition-colors',
        onClick && 'cursor-pointer hover:border-line-strong hover:bg-subtle/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-muted">{label}</span>
        {icon && (
          <span className={cn('text-ink-faint [&_svg]:size-4', tone === 'warning' && 'text-warning-700', tone === 'brand' && 'text-brand-700')}>{icon}</span>
        )}
      </div>
      <span className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</span>
      {hint && <span className="mt-1 text-xs text-ink-faint">{hint}</span>}
    </Comp>
  )
}
