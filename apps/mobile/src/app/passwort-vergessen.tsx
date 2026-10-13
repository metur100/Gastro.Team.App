import { useState } from 'react'
import { Text } from 'react-native'
import { api, errorMessage } from '@/lib/api'
import { type } from '@/lib/theme'
import { Banner, Button, Card, Screen, TextField } from '@/components/ui'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Bitte geben Sie eine gültige E-Mail-Adresse an.')
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Screen>
      {sent ? (
        <Card>
          <Text style={type.body}>Falls ein Konto mit dieser Adresse existiert, haben wir Ihnen einen Link zum Zurücksetzen geschickt. Der Link ist 2 Stunden gültig.</Text>
        </Card>
      ) : (
        <>
          <Text style={[type.muted, { marginBottom: 16 }]}>Wir senden Ihnen einen Link, mit dem Sie ein neues Passwort festlegen können.</Text>
          <Banner message={error} tone="danger" />
          <TextField label="E-Mail-Adresse" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Button title="Link anfordern" onPress={() => void submit()} loading={busy} />
        </>
      )}
    </Screen>
  )
}
