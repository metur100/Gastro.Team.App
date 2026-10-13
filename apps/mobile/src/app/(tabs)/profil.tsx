import { useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { registerForPush, type PushState } from '@/lib/push'
import { colors, radius, space, type } from '@/lib/theme'
import { Banner, Button, Card, Row, Screen, SectionTitle, TextField } from '@/components/ui'

const ROLE: Record<string, string> = { Owner: 'Inhaber/in', Manager: 'Leitung', Employee: 'Mitarbeiter/in' }
const PUSH: Record<PushState, string> = {
  registered: 'Aktiv auf diesem Gerät.',
  denied: 'Mitteilungen sind in den Systemeinstellungen deaktiviert.',
  unsupported: 'Push-Mitteilungen sind nur auf echten Geräten verfügbar.',
  'not-configured': 'Push-Mitteilungen sind in dieser App-Version noch nicht eingerichtet.',
  error: 'Registrierung fehlgeschlagen. Bitte später erneut versuchen.',
}

export default function Profile() {
  const { me, signOut, switchTenant } = useAuth()
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), enabled: Boolean(me?.currentTenant) })
  const [push, setPush] = useState<PushState | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!me) return null

  const deleteAccount = async () => {
    setBusy(true)
    try {
      await api.post('/me/delete-account', { password })
      setDeleteOpen(false)
      await signOut()
      router.replace('/login')
    } catch (e) {
      setFeedback({ text: errorMessage(e), tone: 'danger' })
      setDeleteOpen(false)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <Screen title="Profil">
      <Banner message={feedback?.text ?? null} tone={feedback?.tone} onHide={() => setFeedback(null)} />
      <Card>
        <Text style={type.heading}>{me.firstName} {me.lastName}</Text>
        <Text style={type.muted}>{me.email}</Text>
        {me.currentTenant && <Row label="Betrieb" value={`${me.currentTenant.name} · ${ROLE[me.currentTenant.role]}`} />}
      </Card>

      {me.memberships.length > 1 && (
        <>
          <SectionTitle>Betrieb wechseln</SectionTitle>
          {me.memberships.map((m) => (
            <Pressable
              key={m.tenantId}
              onPress={() => void switchTenant(m.tenantId)}
              accessibilityRole="button"
              accessibilityState={{ selected: m.tenantId === me.currentTenant?.id }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: m.tenantId === me.currentTenant?.id ? colors.brand : colors.line, backgroundColor: colors.surface, marginBottom: space.sm }}
            >
              <Text style={[type.body, { flex: 1 }]}>{m.tenantName}</Text>
              {m.tenantId === me.currentTenant?.id && <Ionicons name="checkmark" size={18} color={colors.brand} />}
            </Pressable>
          ))}
        </>
      )}

      <SectionTitle>Benachrichtigungen</SectionTitle>
      <Pressable onPress={() => router.push('/benachrichtigungen')} accessibilityRole="button">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Ionicons name="notifications-outline" size={20} color={colors.ink} />
          <Text style={[type.body, { flex: 1 }]}>Alle Benachrichtigungen</Text>
          {(unread.data?.count ?? 0) > 0 && <Text style={{ color: colors.brand, fontWeight: '700' }}>{unread.data!.count} neu</Text>}
          <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
        </Card>
      </Pressable>
      <View style={{ marginTop: space.sm }}>
        <Button title="Push-Mitteilungen aktivieren" variant="outline" icon="phone-portrait-outline" onPress={() => void registerForPush().then(setPush)} />
        {push && <Text style={[type.small, { marginTop: space.xs }]}>{PUSH[push]}</Text>}
      </View>

      <SectionTitle>Konto</SectionTitle>
      <View style={{ gap: space.sm }}>
        <Text style={type.small}>Profil, Passwort und Datenexport verwalten Sie in der Web-App unter „Profil & Datenschutz“.</Text>
        <Button title="Abmelden" variant="outline" icon="log-out-outline" onPress={() => void signOut().then(() => router.replace('/login'))} />
        <Button title="Konto löschen" variant="ghost" onPress={() => setDeleteOpen(true)} />
      </View>

      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(28,27,24,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, paddingBottom: space.xxl }}>
            <Text style={type.heading} accessibilityRole="header">Konto endgültig löschen?</Text>
            <Text style={[type.muted, { marginVertical: space.md }]}>Ihr Login wird gelöscht und Ihre Personendaten werden anonymisiert. Diese Aktion kann nicht rückgängig gemacht werden.</Text>
            <TextField label="Passwort zur Bestätigung" value={password} onChangeText={setPassword} secureTextEntry />
            <View style={{ gap: space.sm }}>
              <Button title="Konto löschen" variant="danger" loading={busy} disabled={!password} onPress={() => void deleteAccount()} />
              <Button title="Abbrechen" variant="ghost" onPress={() => setDeleteOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}
