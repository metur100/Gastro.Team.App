import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { colors, space, type } from '@/lib/theme'
import { Banner, Button, Card, ErrorState, Loading, Screen, TextField } from '@/components/ui'
import type { PublicInvitation } from '@/types/api'

/** Opened via gastroteam://einladung/<token> or the web invitation link. */
export default function InvitationScreen() {
  const { token = '' } = useLocalSearchParams<{ token: string }>()
  const { status, me, signIn, switchTenant } = useAuth()
  const inv = useQuery({ queryKey: ['invitation', token], queryFn: () => api.post<PublicInvitation>('/invitations/lookup', { token }), retry: false })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (inv.isPending) return <Screen><Loading /></Screen>
  if (inv.isError) return <Screen><ErrorState error={inv.error} onRetry={() => void inv.refetch()} /></Screen>
  const data = inv.data
  if (!data.isValid)
    return (
      <Screen title="Einladung nicht gültig">
        <Text style={type.muted}>Diese Einladung ist abgelaufen, wurde zurückgezogen oder bereits verwendet. Bitte bitten Sie Ihre Leitung um eine neue Einladung.</Text>
      </Screen>
    )

  const accept = async () => {
    setError(null)
    if (status !== 'authenticated') {
      if (password.length < 10) return setError('Das Passwort muss mindestens 10 Zeichen lang sein.')
      if (!terms) return setError('Bitte akzeptieren Sie die Nutzungsbedingungen und die Datenschutzhinweise.')
    }
    setBusy(true)
    try {
      const res = await api.post<{ tenantId: string }>('/invitations/accept', {
        token, firstName: firstName || data.firstName, lastName: lastName || data.lastName, password: status === 'authenticated' ? null : password, acceptTerms: true,
      })
      if (status === 'authenticated') await switchTenant(res.tenantId)
      else await signIn(data.email, password)
      router.replace('/heute')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const intro = `${data.tenantName} lädt Sie ${data.role === 'Manager' ? 'als Leitung' : 'ins Team'} ein. Die Einladung gilt für ${data.email}.`
  return (
    <Screen title="Einladung annehmen" subtitle={intro}>
      <Banner message={error} tone="danger" />
      {status === 'authenticated' ? (
        me?.email.toLowerCase() === data.email.toLowerCase() ? (
          <Button title="Einladung annehmen" onPress={() => void accept()} loading={busy} />
        ) : (
          <Card><Text style={type.body}>Sie sind als {me?.email} angemeldet. Bitte melden Sie sich mit {data.email} an.</Text></Card>
        )
      ) : data.accountExists ? (
        <Card>
          <Text style={type.body}>Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an und öffnen Sie den Link erneut.</Text>
          <View style={{ marginTop: space.lg }}><Button title="Zur Anmeldung" onPress={() => router.replace('/login')} /></View>
        </Card>
      ) : (
        <>
          <TextField label="Vorname" value={firstName} placeholder={data.firstName} onChangeText={setFirstName} />
          <TextField label="Nachname" value={lastName} placeholder={data.lastName} onChangeText={setLastName} />
          <TextField label="Passwort" value={password} onChangeText={setPassword} secureTextEntry hint="Mindestens 10 Zeichen." />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg }}>
            <Switch value={terms} onValueChange={setTerms} trackColor={{ true: colors.brand }} accessibilityLabel="Nutzungsbedingungen akzeptieren" />
            <Text style={[type.muted, { flex: 1 }]}>Ich akzeptiere die Nutzungsbedingungen und habe die Datenschutzhinweise gelesen.</Text>
          </View>
          <Button title="Konto erstellen und beitreten" onPress={() => void accept()} loading={busy} />
        </>
      )}
    </Screen>
  )
}
