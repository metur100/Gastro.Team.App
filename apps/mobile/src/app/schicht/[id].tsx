import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api, errorMessage } from '@/lib/api'
import { usePermissions } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { colors, radius, space, type } from '@/lib/theme'
import { Badge, Banner, Button, Card, ErrorState, Loading, Row, Screen, SectionTitle, TextField } from '@/components/ui'
import type { EligibleColleague, Shift } from '@/types/api'

export default function ShiftDetail() {
  const { id = '' } = useLocalSearchParams<{ id: string }>()
  const p = usePermissions()
  const qc = useQueryClient()
  const shift = useQuery({ queryKey: ['shift', id], queryFn: () => api.get<Shift>(`/shifts/${id}`) })
  const [swapOpen, setSwapOpen] = useState(false)
  const [target, setTarget] = useState<string>('open')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null)
  const colleagues = useQuery({
    queryKey: ['eligible', id],
    queryFn: () => api.get<EligibleColleague[]>(`/shift-swaps/eligible-colleagues?shiftId=${id}`),
    enabled: swapOpen,
  })

  if (shift.isPending) return <Screen><Loading /></Screen>
  if (shift.isError) return <Screen><ErrorState error={shift.error} onRetry={() => void shift.refetch()} /></Screen>
  const s = shift.data
  const upcoming = new Date(s.startUtc).getTime() > Date.now()
  const canSwap = upcoming && s.status === 'Published' && p.hasFeature('ShiftSwaps') && s.employeeId === p.employeeId

  const send = async () => {
    setBusy(true)
    try {
      await api.post('/shift-swaps', { shiftId: s.id, targetEmployeeId: target === 'open' ? null : target, message: message.trim() || null })
      await qc.invalidateQueries({ queryKey: ['swaps'] })
      setFeedback({ text: 'Tauschanfrage gesendet.', tone: 'success' })
      setSwapOpen(false)
      setTimeout(() => router.push('/anfragen?tab=tausch'), 800)
    } catch (e) {
      setFeedback({ text: errorMessage(e), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Banner message={feedback?.text ?? null} tone={feedback?.tone} onHide={() => setFeedback(null)} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.jobRoleColor }} />
          <Text style={type.heading}>{s.jobRoleName}</Text>
          {s.status === 'Cancelled' ? <Badge label="Abgesagt" tone="danger" /> : <Badge label="Veröffentlicht" tone="success" />}
        </View>
        <Text style={type.title}>{fmt.timeRange(s.startTime, s.endTime)} Uhr</Text>
        <Text style={[type.muted, { marginBottom: space.md }]}>{fmt.dayLong(s.date)}{s.endsNextDay ? ' (endet am Folgetag)' : ''}</Text>
        <Row label="Standort" value={s.locationName ?? '–'} />
        <Row label="Pause" value={`${s.breakMinutes} Min.`} />
        <Row label="Geplante Arbeitszeit" value={fmt.hours(s.paidHours)} />
        {s.notes ? <Row label="Notiz" value={s.notes} /> : null}
      </Card>

      {canSwap && !swapOpen && (
        <View style={{ marginTop: space.lg }}>
          <Button title="Schicht tauschen" variant="outline" icon="swap-horizontal" onPress={() => setSwapOpen(true)} />
        </View>
      )}

      {swapOpen && (
        <>
          <SectionTitle>Wer soll übernehmen?</SectionTitle>
          {colleagues.isPending ? (
            <Loading />
          ) : colleagues.isError ? (
            <ErrorState error={colleagues.error} onRetry={() => void colleagues.refetch()} />
          ) : (
            <View style={{ gap: space.sm }}>
              {[{ id: 'open', fullName: 'Allen anbieten', jobRoleName: 'Alle Kolleginnen und Kollegen am Standort', hasConflict: false, conflictReason: null }, ...colleagues.data].map((c) => {
                const selected = target === c.id
                return (
                  <Pressable
                    key={c.id}
                    disabled={c.hasConflict}
                    onPress={() => setTarget(c.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: c.hasConflict }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1,
                      borderColor: selected ? colors.brand : colors.line, backgroundColor: selected ? colors.brandTint : colors.surface, opacity: c.hasConflict ? 0.5 : 1,
                    }}
                  >
                    <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.brand : colors.inkFaint} />
                    <View style={{ flex: 1 }}>
                      <Text style={type.body}>{c.fullName}</Text>
                      <Text style={type.small}>{c.conflictReason ?? c.jobRoleName ?? ''}</Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )}
          <View style={{ marginTop: space.lg }}>
            <TextField label="Nachricht (optional)" value={message} onChangeText={setMessage} maxLength={300} placeholder="z. B. Ich habe einen Arzttermin." />
            <View style={{ gap: space.sm }}>
              <Button title="Anfrage senden" onPress={() => void send()} loading={busy} />
              <Button title="Abbrechen" variant="ghost" onPress={() => setSwapOpen(false)} />
            </View>
          </View>
        </>
      )}
    </Screen>
  )
}
