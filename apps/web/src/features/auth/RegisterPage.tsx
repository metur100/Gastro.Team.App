import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MailCheck } from 'lucide-react'
import { api, errorMessage, session } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { applyServerErrors } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Label } from '@/components/ui/form'
import { Notice } from '@/components/ui/display'
import { AuthLayout } from './AuthLayout'

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Bitte geben Sie Ihren Vornamen an.').max(100),
    lastName: z.string().trim().min(1, 'Bitte geben Sie Ihren Nachnamen an.').max(100),
    email: z.email('Bitte geben Sie eine gültige E-Mail-Adresse an.'),
    password: z.string().min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.').max(128),
    passwordRepeat: z.string(),
    acceptTerms: z.boolean().refine((v) => v, 'Bitte akzeptieren Sie die Nutzungsbedingungen und die Datenschutzhinweise.'),
  })
  .refine((v) => v.password === v.passwordRepeat, { message: 'Die Passwörter stimmen nicht überein.', path: ['passwordRepeat'] })
type Values = z.infer<typeof registerSchema>

interface RegisterResponse {
  requiresEmailVerification: boolean
  tokens?: { accessToken: string }
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const { establish } = useAuth()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, control, setError: setFieldError, formState } = useForm<Values>({
    resolver: zodResolver(registerSchema),
    defaultValues: { acceptTerms: false },
  })

  const onSubmit = handleSubmit(async ({ passwordRepeat: _, ...values }) => {
    setError(null)
    try {
      const res = await api.post<RegisterResponse>('/auth/register', values)
      if (res.requiresEmailVerification) {
        setSentTo(values.email)
        return
      }
      if (res.tokens) {
        session.setToken(res.tokens.accessToken)
        await establish()
        navigate('/onboarding', { replace: true })
      }
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(errorMessage(e))
    }
  })

  if (sentTo)
    return (
      <AuthLayout title="Fast geschafft" description={<>Wir haben eine E-Mail an <strong>{sentTo}</strong> geschickt.</>}>
        <div className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-muted">
          <MailCheck className="mb-3 size-6 text-brand-700" aria-hidden />
          Bitte klicken Sie auf den Link in der E-Mail, um Ihre Adresse zu bestätigen. Danach können Sie sich anmelden und Ihr Restaurant einrichten.
        </div>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link to="/anmelden">Zur Anmeldung</Link>
        </Button>
      </AuthLayout>
    )

  return (
    <AuthLayout
      title="Restaurant registrieren"
      description="Starten Sie mit 30 Tagen Testphase. Keine Zahlungsdaten erforderlich."
      footer={
        <>
          Bereits registriert?{' '}
          <Link to="/anmelden" className="font-medium text-brand-700 hover:underline">
            Anmelden
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vorname" error={formState.errors.firstName?.message}>
            {(id, d, inv) => <Input id={id} autoComplete="given-name" aria-describedby={d} aria-invalid={inv} {...register('firstName')} />}
          </Field>
          <Field label="Nachname" error={formState.errors.lastName?.message}>
            {(id, d, inv) => <Input id={id} autoComplete="family-name" aria-describedby={d} aria-invalid={inv} {...register('lastName')} />}
          </Field>
        </div>
        <Field label="E-Mail-Adresse" error={formState.errors.email?.message}>
          {(id, d, inv) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={inv} {...register('email')} />}
        </Field>
        <Field label="Passwort" hint="Mindestens 10 Zeichen. Eine Passphrase ist sicher und leicht zu merken." error={formState.errors.password?.message}>
          {(id, d, inv) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv} {...register('password')} />}
        </Field>
        <Field label="Passwort wiederholen" error={formState.errors.passwordRepeat?.message}>
          {(id, d, inv) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={inv} {...register('passwordRepeat')} />}
        </Field>
        <div>
          <div className="flex items-start gap-3">
            <Controller
              control={control}
              name="acceptTerms"
              render={({ field }) => (
                <Checkbox id="acceptTerms" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} aria-invalid={Boolean(formState.errors.acceptTerms)} className="mt-0.5" />
              )}
            />
            <Label htmlFor="acceptTerms" className="font-normal text-ink-muted">
              Ich akzeptiere die Nutzungsbedingungen und habe die Datenschutzhinweise gelesen.
            </Label>
          </div>
          {formState.errors.acceptTerms && <p role="alert" className="mt-1 text-xs font-medium text-danger-600">{formState.errors.acceptTerms.message}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Konto erstellen
        </Button>
      </form>
    </AuthLayout>
  )
}
