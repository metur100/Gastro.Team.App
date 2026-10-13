import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { XCircle } from 'lucide-react'
import { ApiError, api, errorMessage, session } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { applyServerErrors } from '@/lib/hooks'
import { roleLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Label } from '@/components/ui/form'
import { Notice, Spinner } from '@/components/ui/display'
import type { PublicInvitation } from '@/types/api'
import { AuthLayout } from './AuthLayout'

const schema = z
  .object({
    firstName: z.string().trim().min(1, 'Bitte geben Sie Ihren Vornamen an.').max(100),
    lastName: z.string().trim().min(1, 'Bitte geben Sie Ihren Nachnamen an.').max(100),
    password: z.string().min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.').max(128),
    passwordRepeat: z.string(),
    acceptTerms: z.boolean().refine((v) => v, 'Bitte akzeptieren Sie die Nutzungsbedingungen und die Datenschutzhinweise.'),
  })
  .refine((v) => v.password === v.passwordRepeat, { message: 'Die Passwörter stimmen nicht überein.', path: ['passwordRepeat'] })
type Values = z.infer<typeof schema>

interface AcceptResult {
  tenantId: string
  newAccount: boolean
  tokens: { accessToken: string } | null
}

export default function InvitationPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { status, me, establish, switchTenant, logout } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.post<PublicInvitation>('/invitations/lookup', { token }),
    retry: false,
  })

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { acceptTerms: false } })
  const inv = invitation.data
  const { reset } = form
  useEffect(() => {
    if (inv?.firstName) reset({ firstName: inv.firstName, lastName: inv.lastName, password: '', passwordRepeat: '', acceptTerms: false })
  }, [inv, reset])

  const finish = async (result: AcceptResult) => {
    if (result.tokens) session.setToken(result.tokens.accessToken)
    session.setTenant(result.tenantId)
    if (status === 'authenticated') await switchTenant(result.tenantId)
    else await establish()
    navigate('/', { replace: true })
  }

  const createAccount = form.handleSubmit(async ({ firstName, lastName, password, acceptTerms }) => {
    const values = { firstName, lastName, password, acceptTerms }
    setError(null)
    try {
      await finish(await api.post<AcceptResult>('/invitations/accept', { token, ...values }))
    } catch (e) {
      if (!applyServerErrors(e, form.setError)) setError(errorMessage(e))
    }
  })

  const joinWithCurrentAccount = async () => {
    setError(null)
    setJoining(true)
    try {
      await finish(await api.post<AcceptResult>('/invitations/accept', { token, acceptTerms: true }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setJoining(false)
    }
  }

  if (invitation.isPending || status === 'loading')
    return (
      <AuthLayout title="Einladung">
        <Spinner />
      </AuthLayout>
    )

  if (invitation.isError || !inv || !inv.isValid)
    return (
      <AuthLayout title="Einladung nicht gültig">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-5 text-sm">
          <XCircle className="size-5 shrink-0 text-danger-600" aria-hidden />
          <p>
            {invitation.error instanceof ApiError
              ? invitation.error.message
              : 'Diese Einladung ist abgelaufen, wurde zurückgezogen oder bereits verwendet. Bitte bitten Sie Ihre Leitung um eine neue Einladung.'}
          </p>
        </div>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link to="/anmelden">Zur Anmeldung</Link>
        </Button>
      </AuthLayout>
    )

  const intro = (
    <>
      <strong>{inv.tenantName}</strong> lädt Sie {inv.role === 'Manager' ? 'als Leitung' : 'ins Team'} ein ({roleLabel[inv.role]}). Die Einladung gilt für{' '}
      <strong>{inv.email}</strong>.
    </>
  )

  // Signed in: join with the current account if the e-mail matches.
  if (status === 'authenticated' && me) {
    const matches = me.email.toLowerCase() === inv.email.toLowerCase()
    return (
      <AuthLayout title="Einladung annehmen" description={intro}>
        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
        {matches ? (
          <Button className="w-full" size="lg" loading={joining} onClick={joinWithCurrentAccount}>
            Einladung annehmen
          </Button>
        ) : (
          <div className="space-y-4">
            <Notice tone="warning">
              Sie sind als {me.email} angemeldet. Bitte melden Sie sich mit {inv.email} an, um die Einladung anzunehmen.
            </Notice>
            <Button variant="outline" className="w-full" onClick={() => void logout()}>
              Abmelden
            </Button>
          </div>
        )}
      </AuthLayout>
    )
  }

  if (inv.accountExists)
    return (
      <AuthLayout title="Einladung annehmen" description={intro}>
        <Notice tone="info">Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an – danach können Sie die Einladung annehmen.</Notice>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link to={`/anmelden?weiter=${encodeURIComponent(`/einladung/${token}`)}`}>Anmelden und annehmen</Link>
        </Button>
      </AuthLayout>
    )

  const { register, control, formState } = form
  return (
    <AuthLayout title="Konto erstellen" description={intro}>
      <form onSubmit={createAccount} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vorname" error={formState.errors.firstName?.message}>
            {(id, d, inv2) => <Input id={id} autoComplete="given-name" aria-describedby={d} aria-invalid={inv2} {...register('firstName')} />}
          </Field>
          <Field label="Nachname" error={formState.errors.lastName?.message}>
            {(id, d, inv2) => <Input id={id} autoComplete="family-name" aria-describedby={d} aria-invalid={inv2} {...register('lastName')} />}
          </Field>
        </div>
        <Field label="Passwort" hint="Mindestens 10 Zeichen." error={formState.errors.password?.message}>
          {(id, d, inv2) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv2} {...register('password')} />}
        </Field>
        <Field label="Passwort wiederholen" error={formState.errors.passwordRepeat?.message}>
          {(id, d, inv2) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv2} {...register('passwordRepeat')} />}
        </Field>
        <div>
          <div className="flex items-start gap-3">
            <Controller
              control={control}
              name="acceptTerms"
              render={({ field }) => <Checkbox id="inv-terms" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />}
            />
            <Label htmlFor="inv-terms" className="font-normal text-ink-muted">
              Ich akzeptiere die Nutzungsbedingungen und habe die Datenschutzhinweise gelesen.
            </Label>
          </div>
          {formState.errors.acceptTerms && <p role="alert" className="mt-1 text-xs font-medium text-danger-600">{formState.errors.acceptTerms.message}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Konto erstellen und beitreten
        </Button>
      </form>
    </AuthLayout>
  )
}
