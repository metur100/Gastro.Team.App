import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { fmt, plural } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox, Label } from '@/components/ui/form'
import { ErrorState, Notice, Spinner } from '@/components/ui/display'
import { Dialog } from '@/components/ui/overlay'
import type { Issue, PublishResult, ValidationReport } from '@/types/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  locationId: string
  locationName: string
  weekStart: string
  draftCount: number
  onShowIssue: (issue: Issue) => void
}

function IssueList({ issues, onShowIssue }: { issues: Issue[]; onShowIssue: (i: Issue) => void }) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {issues.map((i, idx) => (
        <li key={idx} className="flex items-start gap-2.5 px-3 py-2 text-sm">
          {i.severity === 'Error' ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-600" aria-label="Fehler" />
          ) : i.severity === 'Warning' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-label="Hinweis" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-info-700" aria-label="Info" />
          )}
          <span className="flex-1">
            {i.date && <span className="font-medium">{fmt.dayShort(i.date)}: </span>}
            {i.message}
          </span>
          {i.shiftId && (
            <button type="button" className="shrink-0 cursor-pointer text-xs font-medium text-brand-700 hover:underline" onClick={() => onShowIssue(i)}>
              Anzeigen
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function PublishDialog({ open, onOpenChange, locationId, locationName, weekStart, draftCount, onShowIssue }: Props) {
  const qc = useQueryClient()
  const [ack, setAck] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const report = useQuery({
    queryKey: ['validation', locationId, weekStart],
    queryFn: () => api.get<ValidationReport>(`/schedules/validation?locationId=${locationId}&date=${weekStart}`),
    enabled: open,
    gcTime: 0,
  })

  const publish = async () => {
    setPublishing(true)
    try {
      const r = await api.post<PublishResult>('/schedules/publish', { locationId, weekStart, acknowledgeWarnings: ack })
      toast.success(`Schichtplan veröffentlicht: ${plural(r.publishedShifts, 'Schicht', 'Schichten')}, ${plural(r.notifiedEmployees, 'Person', 'Personen')} benachrichtigt.`)
      await qc.invalidateQueries({ queryKey: ['week'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      onOpenChange(false)
      setAck(false)
    } catch (e) {
      toast.error(errorMessage(e))
      void report.refetch()
    } finally {
      setPublishing(false)
    }
  }

  const r = report.data
  const errors = r?.issues.filter((i) => i.severity === 'Error') ?? []
  const warnings = r?.issues.filter((i) => i.severity === 'Warning') ?? []
  const infos = r?.issues.filter((i) => i.severity === 'Info') ?? []
  const canPublish = r !== undefined && errors.length === 0 && (warnings.length === 0 || ack) && draftCount > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setAck(false)
      }}
      size="lg"
      title="Schichtplan veröffentlichen"
      description={`${locationName} · ${fmt.week(weekStart)}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={publish} loading={publishing} disabled={!canPublish}>
            {plural(draftCount, 'Schicht', 'Schichten')} veröffentlichen
          </Button>
        </>
      }
    >
      {report.isPending ? (
        <Spinner label="Schichtplan wird geprüft …" />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-ink-muted">
            Nach dem Veröffentlichen sehen die eingeplanten Mitarbeitenden ihre Schichten und werden benachrichtigt. Die Veröffentlichung wird protokolliert.
          </p>
          {draftCount === 0 && <Notice tone="info">In dieser Woche gibt es keine unveröffentlichten Schichten.</Notice>}
          {errors.length === 0 && warnings.length === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-success-700/20 bg-success-50 px-4 py-3 text-sm font-medium text-success-700">
              <CheckCircle2 className="size-4" aria-hidden /> Keine Fehler oder Hinweise gefunden.
            </div>
          )}
          {errors.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-danger-700">
                {plural(errors.length, 'Fehler', 'Fehler')} – müssen vor dem Veröffentlichen behoben werden
              </h3>
              <IssueList issues={errors} onShowIssue={onShowIssue} />
            </section>
          )}
          {warnings.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-warning-700">{plural(warnings.length, 'Hinweis', 'Hinweise')} – bitte prüfen</h3>
              <IssueList issues={warnings} onShowIssue={onShowIssue} />
              {errors.length === 0 && (
                <div className="mt-3 flex items-start gap-3">
                  <Checkbox id="ack-warnings" checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
                  <Label htmlFor="ack-warnings" className="font-normal">
                    Ich habe die Hinweise geprüft und möchte den Schichtplan trotzdem veröffentlichen.
                  </Label>
                </div>
              )}
            </section>
          )}
          {infos.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink-muted">Informationen</h3>
              <IssueList issues={infos} onShowIssue={onShowIssue} />
            </section>
          )}
          <p className="text-xs text-ink-faint">
            Die Prüfungen (z. B. Ruhezeiten, Pausen, Höchstarbeitszeiten) sind konfigurierbare Hilfen und ersetzen keine arbeitsrechtliche Prüfung.
          </p>
        </div>
      )}
    </Dialog>
  )
}
