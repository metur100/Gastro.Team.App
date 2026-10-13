import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api, errorMessage } from '@/lib/api'
import { fmt, parseGermanDate, todayString } from '@/lib/format'
import { colors, space, type } from '@/lib/theme'
import { Banner, Button, Card, ErrorState, Loading, Screen, SectionTitle, TextField } from '@/components/ui'
import { AvailabilityEditor, toRows, toSlots, type DayRow } from '@/components/AvailabilityEditor'
import type { Availability } from '@/types/api'

export default function AvailabilityScreen() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['availability'], queryFn: () => api.get<Availability>('/availability') })
  const [rows, setRows] = useState<DayRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (q.data) {
      setRows(toRows(q.data.weekly))
      setDirty(false)
    }
  }, [q.data])

  if (q.isPending) return <Screen title="Verfügbarkeit"><Loading /></Screen>
  if (q.isError) return <Screen title="Verfügbarkeit"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Screen>

  const save = async () => {
    const { slots, error } = toSlots(rows)
    if (error) return setFeedback({ text: error, tone: 'danger' })
    setBusy(true)
    try {
      await api.put('/availability/weekly', { employeeId: null, slots, validFrom: null })
      await qc.invalidateQueries({ queryKey: ['availability'] })
      setFeedback({ text: 'Verfügbarkeit gespeichert.', tone: 'success' })
    } catch (e) {
      setFeedback({ text: errorMessage(e), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const addException = async () => {
    const iso = parseGermanDate(date)
    if (!iso || iso < todayString()) return setFeedback({ text: 'Bitte ein gültiges, zukünftiges Datum im Format TT.MM.JJJJ angeben.', tone: 'danger' })
    try {
      await api.post('/availability/exceptions', { employeeId: null, date: iso, startTime: null, endTime: null, note: note.trim() || null })
      setDate('')
      setNote('')
      await qc.invalidateQueries({ queryKey: ['availability'] })
      setFeedback({ text: 'Tag als nicht verfügbar eingetragen.', tone: 'success' })
    } catch (e) {
      setFeedback({ text: errorMessage(e), tone: 'danger' })
    }
  }

  const removeException = async (id: string) => {
    try {
      await api.del(`/availability/exceptions/${id}`)
      await qc.invalidateQueries({ queryKey: ['availability'] })
    } catch (e) {
      setFeedback({ text: errorMessage(e), tone: 'danger' })
    }
  }

  const upcoming = q.data.exceptions.filter((x) => x.date >= todayString())
  return (
    <Screen title="Verfügbarkeit" subtitle="Wann können Sie in der Regel arbeiten?" refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Banner message={feedback?.text ?? null} tone={feedback?.tone} onHide={() => setFeedback(null)} />
      <AvailabilityEditor rows={rows} onChange={(r) => { setRows(r); setDirty(true) }} />
      <View style={{ marginTop: space.lg }}>
        <Button title="Änderungen speichern" onPress={() => void save()} loading={busy} disabled={!dirty} />
      </View>
      <Text style={[type.small, { marginTop: space.sm }]}>Bereits veröffentlichte Schichten werden nicht automatisch geändert. Für Urlaub stellen Sie bitte einen Antrag.</Text>

      <SectionTitle>Einzelne Tage nicht verfügbar</SectionTitle>
      <Card>
        <TextField label="Datum" value={date} onChangeText={setDate} placeholder="TT.MM.JJJJ" keyboardType="numbers-and-punctuation" maxLength={10} />
        <TextField label="Notiz (optional)" value={note} onChangeText={setNote} maxLength={200} />
        <Button title="Eintragen" variant="outline" icon="calendar-outline" onPress={() => void addException()} />
      </Card>
      {upcoming.map((x) => (
        <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <View style={{ flex: 1 }}>
            <Text style={type.body}>{fmt.dayLong(x.date)}</Text>
            <Text style={type.small}>{x.startTime ? fmt.timeRange(x.startTime, x.endTime ?? '') : 'ganztägig'}{x.note ? ` · ${x.note}` : ''}</Text>
          </View>
          <Pressable onPress={() => void removeException(x.id)} accessibilityRole="button" accessibilityLabel={`Ausnahme am ${fmt.date(x.date)} entfernen`} hitSlop={12}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        </View>
      ))}
    </Screen>
  )
}
