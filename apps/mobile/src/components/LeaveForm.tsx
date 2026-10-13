import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { errorMessage } from '@/lib/api'
import { parseGermanDate, todayString } from '@/lib/format'
import { colors, space } from '@/lib/theme'
import type { LeaveType } from '@/types/api'
import { Banner, Button, TextField } from './ui'

export const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'Vacation', label: 'Urlaub' },
  { value: 'Sick', label: 'Krankmeldung' },
  { value: 'Unpaid', label: 'Unbezahlt' },
  { value: 'Training', label: 'Fortbildung' },
  { value: 'Other', label: 'Sonstiges' },
]

export interface LeaveInput {
  type: LeaveType
  startDate: string
  endDate: string
  note: string | null
}

/** Validates German date input; returns field errors or the request body. */
export function validateLeave(type: LeaveType, start: string, end: string, note: string): { errors: Record<string, string>; value?: LeaveInput } {
  const errors: Record<string, string> = {}
  const s = parseGermanDate(start)
  const e = parseGermanDate(end)
  if (!s) errors.start = 'Bitte ein Datum im Format TT.MM.JJJJ angeben.'
  if (!e) errors.end = 'Bitte ein Datum im Format TT.MM.JJJJ angeben.'
  if (s && e && e < s) errors.end = 'Das Enddatum muss am oder nach dem Startdatum liegen.'
  if (s && type !== 'Sick' && s < todayString()) errors.start = 'Urlaub kann nicht rückwirkend beantragt werden.'
  if (note.length > 500) errors.note = 'Höchstens 500 Zeichen.'
  if (Object.keys(errors).length > 0) return { errors }
  return { errors, value: { type, startDate: s!, endDate: e!, note: note.trim() || null } }
}

export function LeaveForm({ onSubmit }: { onSubmit: (v: LeaveInput) => Promise<void> }) {
  const [type, setType] = useState<LeaveType>('Vacation')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const result = validateLeave(type, start, end, note)
    setErrors(result.errors)
    if (!result.value) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(result.value)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <Banner message={error} tone="danger" />
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 6 }}>Art</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md }} accessibilityRole="radiogroup">
        {LEAVE_TYPES.map((t) => {
          const active = t.value === type
          return (
            <Pressable
              key={t.value}
              onPress={() => setType(t.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: active ? colors.brand : colors.lineStrong, backgroundColor: active ? colors.brandTint : colors.surface }}
            >
              <Text style={{ fontWeight: '600', color: active ? colors.brand : colors.inkMuted }}>{t.label}</Text>
            </Pressable>
          )
        })}
      </View>
      <TextField label="Von" value={start} onChangeText={setStart} placeholder="TT.MM.JJJJ" keyboardType="numbers-and-punctuation" maxLength={10} error={errors.start} />
      <TextField label="Bis" value={end} onChangeText={setEnd} placeholder="TT.MM.JJJJ" keyboardType="numbers-and-punctuation" maxLength={10} error={errors.end} />
      <TextField
        label="Notiz (optional)"
        value={note}
        onChangeText={setNote}
        multiline
        error={errors.note}
        hint={type === 'Sick' ? 'Bitte keine Diagnosen angeben. Nur Sie und die Leitung sehen die Notiz.' : 'Sichtbar für Sie und Ihre Leitung.'}
        style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }}
      />
      <Button title="Antrag einreichen" onPress={() => void submit()} loading={busy} />
    </View>
  )
}
