import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Download, Trash2 } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { applyServerErrors } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import { Card, CardBody, CardHeader, Notice, PageHeader } from '@/components/ui/display'
import { ConfirmDialog } from '@/components/ui/overlay'
import type { Employee } from '@/types/api'

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Bitte geben Sie Ihren Vornamen an.').max(100),
  lastName: z.string().trim().min(1, 'Bitte geben Sie Ihren Nachnamen an.').max(100),
  preferredLanguage: z.string(),
  phone: z.string().max(40).regex(/^[0-9 +()/-]*$/, 'Die Telefonnummer enthält ungültige Zeichen.'),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Bitte geben Sie Ihr aktuelles Passwort ein.'),
    newPassword: z.string().min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.').max(128),
    repeat: z.string(),
  })
  .refine((v) => v.newPassword === v.repeat, { message: 'Die Passwörter stimmen nicht überein.', path: ['repeat'] })

export default function ProfilePage() {
  const { me, refreshMe, logout } = useAuth()
  const navigate = useNavigate()
  const employeeId = me?.currentTenant?.employeeId
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const profile = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema) })
  const pw = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) })

  useEffect(() => {
    if (!me) return
    let phone = ''
    const load = async () => {
      if (employeeId) {
        try {
          phone = (await api.get<Employee>(`/employees/${employeeId}`)).phone ?? ''
        } catch {
          /* phone stays empty */
        }
      }
      profile.reset({ firstName: me.firstName, lastName: me.lastName, preferredLanguage: me.preferredLanguage, phone })
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, employeeId])

  const saveProfile = profile.handleSubmit(async (v) => {
    try {
      await api.put('/me/profile', { ...v, phone: v.phone || null })
      await refreshMe()
      toast.success('Profil gespeichert')
    } catch (e) {
      if (!applyServerErrors(e, profile.setError)) toast.error(errorMessage(e))
    }
  })

  const changePassword = pw.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword })
      // All sessions are revoked server-side after a password change.
      await logout()
      navigate('/anmelden?passwort=neu', { replace: true })
    } catch (e) {
      if (!applyServerErrors(e, pw.setError)) toast.error(errorMessage(e))
    }
  })

  const exportData = async () => {
    try {
      const data = await api.get<unknown>('/me/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'gastroteam-meine-daten.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const deleteAccount = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.post('/me/delete-account', { password: deletePassword })
      await logout()
      toast.success('Ihr Konto wurde gelöscht.')
      navigate('/anmelden', { replace: true })
    } catch (e) {
      setDeleteError(errorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader title="Profil & Datenschutz" description={me?.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Persönliche Angaben" />
          <form onSubmit={saveProfile} noValidate>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Vorname" required error={profile.formState.errors.firstName?.message}>{(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...profile.register('firstName')} />}</Field>
              <Field label="Nachname" required error={profile.formState.errors.lastName?.message}>{(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} {...profile.register('lastName')} />}</Field>
              <Field label="Sprache">
                {(id) => (
                  <Select id={id} {...profile.register('preferredLanguage')}>
                    <option value="de-DE">Deutsch</option>
                    <option value="en-US">Englisch (in Vorbereitung)</option>
                    <option value="bs-BA">Bosnisch (in Vorbereitung)</option>
                    <option value="hr-HR">Kroatisch (in Vorbereitung)</option>
                    <option value="sr-Latn-RS">Serbisch (in Vorbereitung)</option>
                  </Select>
                )}
              </Field>
              {employeeId && (
                <Field label="Telefon" error={profile.formState.errors.phone?.message}>{(id, d, inv) => <Input id={id} type="tel" aria-describedby={d} aria-invalid={inv} {...profile.register('phone')} />}</Field>
              )}
            </CardBody>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button type="submit" loading={profile.formState.isSubmitting}>Änderungen speichern</Button>
            </div>
          </form>
        </Card>
        <Card>
          <CardHeader title="Passwort ändern" description="Nach der Änderung werden Sie auf allen Geräten abgemeldet." />
          <form onSubmit={changePassword} noValidate>
            <CardBody className="space-y-4">
              <Field label="Aktuelles Passwort" error={pw.formState.errors.currentPassword?.message}>{(id, d, inv) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={inv} {...pw.register('currentPassword')} />}</Field>
              <Field label="Neues Passwort" hint="Mindestens 10 Zeichen." error={pw.formState.errors.newPassword?.message}>{(id, d, inv) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv} {...pw.register('newPassword')} />}</Field>
              <Field label="Neues Passwort wiederholen" error={pw.formState.errors.repeat?.message}>{(id, d, inv) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv} {...pw.register('repeat')} />}</Field>
            </CardBody>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button type="submit" loading={pw.formState.isSubmitting}>Passwort ändern</Button>
            </div>
          </form>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Datenschutz" />
          <CardBody className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl text-sm text-ink-muted">
              <p className="font-medium text-ink">Meine Daten exportieren</p>
              <p className="mt-1">Laden Sie die zu Ihrem Konto gespeicherten Daten (Profil, Schichten, Anträge, Verfügbarkeiten, Benachrichtigungen) als JSON-Datei herunter.</p>
            </div>
            <Button variant="outline" onClick={exportData}><Download /> Export herunterladen</Button>
          </CardBody>
          <CardBody className="flex flex-col gap-6 border-t border-line sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl text-sm text-ink-muted">
              <p className="font-medium text-ink">Konto löschen</p>
              <p className="mt-1">Ihr Login wird gelöscht und Ihre Personendaten werden anonymisiert. Planungsdaten, die Ihr Arbeitgeber aufbewahren muss, bleiben ohne Personenbezug erhalten.</p>
            </div>
            <Button variant="outline" className="text-danger-600" onClick={() => setDeleteOpen(true)}><Trash2 /> Konto löschen</Button>
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => { setDeleteOpen(o); if (!o) { setDeletePassword(''); setDeleteError(null) } }}
        title="Konto endgültig löschen?"
        description="Diese Aktion kann nicht rückgängig gemacht werden. Bitte bestätigen Sie mit Ihrem Passwort."
        confirmLabel="Konto löschen"
        destructive
        loading={deleting}
        onConfirm={deleteAccount}
      >
        <div className="mt-4 space-y-3">
          {deleteError && <Notice tone="danger">{deleteError}</Notice>}
          <Field label="Passwort">{(id) => <Input id={id} type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />}</Field>
        </div>
      </ConfirmDialog>
    </>
  )
}
