import type { ReactNode } from 'react'
import { CalendarCheck, CheckCircle2 } from 'lucide-react'

const POINTS = [
  'Schichtplan für die ganze Woche in Minuten',
  'Urlaubsanträge und Schichttausch an einem Ort',
  'Ihr Team sieht seine Schichten auf dem Handy',
]

export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-md bg-white/10" aria-hidden>
            <CalendarCheck className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">GastroTeam</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Weniger WhatsApp-Chaos. Mehr Zeit für Ihre Gäste.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-brand-100">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-200" aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-brand-200">Schichtplanung für Restaurants, Cafés und Bars.</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border border-white/5" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -right-10 size-[28rem] rounded-full border border-white/5" aria-hidden />
      </aside>
      <main className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand-700 text-white" aria-hidden>
              <CalendarCheck className="size-4.5" />
            </span>
            <span className="text-base font-semibold tracking-tight">GastroTeam</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="mt-2 text-sm text-ink-muted">{description}</div>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
