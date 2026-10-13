import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Notice, Spinner } from '@/components/ui/display'
import { AuthLayout } from './AuthLayout'

export function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const schema = z.object({ email: z.email('Bitte geben Sie eine gültige E-Mail-Adresse an.') })
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(schema) })
  const [error, setError] = useState<string | null>(null)

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <AuthLayout
      title="Passwort vergessen"
      description="Wir senden Ihnen einen Link, mit dem Sie ein neues Passwort festlegen können."
      footer={
        <Link to="/anmelden" className="font-medium text-brand-700 hover:underline">
          Zurück zur Anmeldung
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-muted">
          <MailCheck className="mb-3 size-6 text-brand-700" aria-hidden />
          Falls ein Konto mit dieser Adresse existiert, haben wir Ihnen eine E-Mail geschickt. Der Link ist 2 Stunden gültig.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="E-Mail-Adresse" error={formState.errors.email?.message}>
            {(id, d, inv) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={inv} {...register('email')} />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
            Link anfordern
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

const resetSchema = z
  .object({
    password: z.string().min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.').max(128),
    passwordRepeat: z.string(),
  })
  .refine((v) => v.password === v.passwordRepeat, { message: 'Die Passwörter stimmen nicht überein.', path: ['passwordRepeat'] })

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { status, logout } = useAuth()
  const email = params.get('email') ?? ''
  const token = params.get('token') ?? ''
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) })

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null)
    try {
      await api.post('/auth/reset-password', { email, token, newPassword: password })
      if (status === 'authenticated') await logout()
      navigate('/anmelden?passwort=neu', { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  if (!email || !token)
    return (
      <AuthLayout title="Link ungültig" description="Der Link ist unvollständig. Bitte fordern Sie einen neuen an.">
        <Button asChild className="w-full">
          <Link to="/passwort-vergessen">Neuen Link anfordern</Link>
        </Button>
      </AuthLayout>
    )

  return (
    <AuthLayout title="Neues Passwort festlegen" description={<>Für <strong>{email}</strong></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Notice tone="danger">
            {error}{' '}
            <Link to="/passwort-vergessen" className="font-medium underline">
              Neuen Link anfordern
            </Link>
          </Notice>
        )}
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen." error={formState.errors.password?.message}>
          {(id, d, inv) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv} {...register('password')} />}
        </Field>
        <Field label="Passwort wiederholen" error={formState.errors.passwordRepeat?.message}>
          {(id, d, inv) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv} {...register('passwordRepeat')} />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Passwort speichern
        </Button>
      </form>
    </AuthLayout>
  )
}

export function VerifyEmail() {
  const [params] = useSearchParams()
  const { status, refreshMe } = useAuth()
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending')
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const userId = params.get('userId')
    const token = params.get('token')
    if (!userId || !token) {
      setState('error')
      setMessage('Der Bestätigungslink ist unvollständig.')
      return
    }
    api
      .post('/auth/verify-email', { userId, token })
      .then(() => {
        setState('ok')
        if (status === 'authenticated') void refreshMe()
      })
      .catch((e: unknown) => {
        setState('error')
        setMessage(errorMessage(e))
      })
  }, [params, status, refreshMe])

  return (
    <AuthLayout title="E-Mail-Adresse bestätigen">
      {state === 'pending' && <Spinner label="Ihre E-Mail-Adresse wird bestätigt …" />}
      {state === 'ok' && (
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-5 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-success-700" aria-hidden />
            <p>Vielen Dank! Ihre E-Mail-Adresse ist bestätigt.</p>
          </div>
          <Button asChild className="w-full" size="lg">
            <Link to={status === 'authenticated' ? '/' : '/anmelden'}>{status === 'authenticated' ? 'Weiter zu GastroTeam' : 'Jetzt anmelden'}</Link>
          </Button>
        </div>
      )}
      {state === 'error' && (
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-5 text-sm">
            <XCircle className="size-5 shrink-0 text-danger-600" aria-hidden />
            <p>{message} Melden Sie sich an, um einen neuen Link anzufordern.</p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/anmelden">Zur Anmeldung</Link>
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}
