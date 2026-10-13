import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/form'
import { ErrorState, Spinner } from '@/components/ui/display'
import { Dialog } from '@/components/ui/overlay'
import type { EligibleColleague, Shift, Swap } from '@/types/api'

/** Lets an employee offer one of their published shifts to a colleague or to everyone eligible. */
export function RequestSwapDialog({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const [target, setTarget] = useState<string>('open')
  const [message, setMessage] = useState('')
  const colleagues = useQuery({
    queryKey: ['swap-colleagues', shift?.id],
    queryFn: () => api.get<EligibleColleague[]>(`/shift-swaps/eligible-colleagues?shiftId=${shift!.id}`),
    enabled: Boolean(shift),
  })
  const create = useAction({
    fn: () => api.post<Swap>('/shift-swaps', { shiftId: shift!.id, targetEmployeeId: target === 'open' ? null : target, message: message.trim() || null }),
    success: target === 'open' ? 'Schicht an alle passenden Kolleginnen und Kollegen angeboten' : 'Tauschanfrage gesendet',
    invalidate: [['swaps'], ['my-shifts']],
    onSuccess: () => {
      setMessage('')
      setTarget('open')
      onClose()
    },
  })

  return (
    <Dialog
      open={Boolean(shift)}
      onOpenChange={(o) => !o && onClose()}
      title="Schicht tauschen"
      description={shift ? `${fmt.dayLong(shift.date)}, ${fmt.timeRange(shift.startTime, shift.endTime)} Uhr · ${shift.jobRoleName}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>Anfrage senden</Button>
        </>
      }
    >
      {colleagues.isPending ? (
        <Spinner />
      ) : colleagues.isError ? (
        <ErrorState error={colleagues.error} onRetry={() => void colleagues.refetch()} />
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Wer soll die Schicht übernehmen?</legend>
            <div className="space-y-1.5">
              <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm', target === 'open' ? 'border-brand-600 bg-brand-50' : 'border-line')}>
                <input type="radio" name="swap-target" value="open" checked={target === 'open'} onChange={() => setTarget('open')} className="mt-1 accent-brand-700" />
                <span>
                  <span className="font-medium">Allen anbieten</span>
                  <span className="block text-ink-muted">Alle Kolleginnen und Kollegen am Standort sehen das Angebot; die erste passende Zusage gilt.</span>
                </span>
              </label>
              {colleagues.data.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    'flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm',
                    c.hasConflict ? 'cursor-not-allowed border-line opacity-60' : 'cursor-pointer',
                    target === c.id ? 'border-brand-600 bg-brand-50' : 'border-line',
                  )}
                >
                  <input
                    type="radio"
                    name="swap-target"
                    value={c.id}
                    disabled={c.hasConflict}
                    checked={target === c.id}
                    onChange={() => setTarget(c.id)}
                    className="mt-1 accent-brand-700"
                  />
                  <span>
                    <span className="font-medium">{c.fullName}</span>
                    {c.jobRoleName && <span className="text-ink-muted"> · {c.jobRoleName}</span>}
                    {c.conflictReason && <span className="block text-xs text-ink-muted">{c.conflictReason}</span>}
                  </span>
                </label>
              ))}
              {colleagues.data.length === 0 && <p className="text-sm text-ink-muted">Am Standort gibt es keine weiteren Kolleginnen und Kollegen mit Zugang.</p>}
            </div>
          </fieldset>
          <Field label="Nachricht (optional)">
            {(id) => <Textarea id={id} rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Ich habe einen Arzttermin." />}
          </Field>
          <p className="text-xs text-ink-muted">Je nach Einstellung Ihres Betriebs muss die Leitung den Tausch noch freigeben.</p>
        </div>
      )}
    </Dialog>
  )
}
