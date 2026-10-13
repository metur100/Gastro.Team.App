import { useState } from 'react'
import { View } from 'react-native'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { errorMessage } from '@/lib/api'
import { space } from '@/lib/theme'
import { Banner, Button, TextField } from './ui'

export const loginSchema = z.object({
  email: z.string().trim().email('Bitte geben Sie eine gültige E-Mail-Adresse an.'),
  password: z.string().min(1, 'Bitte geben Sie Ihr Passwort ein.'),
})
type Values = z.infer<typeof loginSchema>

export function LoginForm({ onSubmit, onForgot }: { onSubmit: (email: string, password: string) => Promise<void>; onForgot?: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const submit = handleSubmit(async (v) => {
    setError(null)
    try {
      await onSubmit(v.email, v.password)
    } catch (e) {
      setError(errorMessage(e))
    }
  })
  return (
    <View>
      <Banner message={error} tone="danger" />
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            label="E-Mail-Adresse"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            error={formState.errors.email?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            label="Passwort"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            error={formState.errors.password?.message}
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      <View style={{ marginTop: space.sm, gap: space.sm }}>
        <Button title="Anmelden" onPress={() => void submit()} loading={formState.isSubmitting} />
        {onForgot ? <Button title="Passwort vergessen?" variant="ghost" onPress={onForgot} /> : null}
      </View>
    </View>
  )
}
