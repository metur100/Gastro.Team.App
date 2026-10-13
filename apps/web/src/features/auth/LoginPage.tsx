import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ApiError, api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Notice } from '@/components/ui/display'
import { AuthLayout } from './AuthLayout'

const schema = z.object({
  email: z.email('Bitte geben Sie eine gültige E-Mail-Adresse an.'),
  password: z.string().min(1, 'Bitte geben Sie Ihr Passwort ein.'),
})
type Values = z.infer<typeof schema>

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [resent, setResent] = useState(false)
  const { register, handleSubmit, getValues, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      await login(values.email, values.password)
      const next = params.get('weiter')
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true })
    } catch (e) {
      setError({ message: errorMessage(e), code: e instanceof ApiError ? e.code : undefined })
    }
  })

  const resend = async () => {
    await api.post('/auth/resend-verification', { email: getValues('email') }).catch(() => undefined)
    setResent(true)
  }

  return (
    <AuthLayout
      title="Willkommen zurück"
      description="Melden Sie sich bei GastroTeam an."
      footer={
        <>
          Noch kein Konto?{' '}
          <Link to="/registrieren" className="font-medium text-brand-700 hover:underline">
            Restaurant registrieren
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Notice tone="danger">
            {error.message}
            {error.code === 'email_not_verified' && (
              <div className="mt-2">
                {resent ? (
                  'Wir haben Ihnen einen neuen Link geschickt.'
                ) : (
                  <button type="button" className="cursor-pointer font-medium underline" onClick={resend}>
                    Bestätigungslink erneut senden
                  </button>
                )}
              </div>
            )}
          </Notice>
        )}
        {params.get('passwort') === 'neu' && <Notice tone="success">Ihr Passwort wurde geändert. Bitte melden Sie sich an.</Notice>}
        <Field label="E-Mail-Adresse" error={formState.errors.email?.message}>
          {(id, d, invalid) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={invalid} {...register('email')} />}
        </Field>
        <Field label="Passwort" error={formState.errors.password?.message}>
          {(id, d, invalid) => (
            <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={invalid} {...register('password')} />
          )}
        </Field>
        <div className="flex justify-end">
          <Link to="/passwort-vergessen" className="text-sm font-medium text-brand-700 hover:underline">
            Passwort vergessen?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Anmelden
        </Button>
      </form>
    </AuthLayout>
  )
}
