import { Pressable, Text, TextInput, View } from 'react-native'
import { isTime } from '@/lib/format'
import { colors, radius, space, type } from '@/lib/theme'
import type { AvailabilityKind, AvailabilitySlot, DayOfWeek } from '@/types/api'

export const DAYS: { day: DayOfWeek; label: string }[] = [
  { day: 'Monday', label: 'Montag' },
  { day: 'Tuesday', label: 'Dienstag' },
  { day: 'Wednesday', label: 'Mittwoch' },
  { day: 'Thursday', label: 'Donnerstag' },
  { day: 'Friday', label: 'Freitag' },
  { day: 'Saturday', label: 'Samstag' },
  { day: 'Sunday', label: 'Sonntag' },
]

export type DayMode = 'none' | AvailabilityKind
export interface DayRow {
  day: DayOfWeek
  mode: DayMode
  start: string
  end: string
}

const MODES: { value: DayMode; label: string }[] = [
  { value: 'none', label: 'Keine Angabe' },
  { value: 'Available', label: 'Verfügbar' },
  { value: 'Preferred', label: 'Bevorzugt' },
  { value: 'Unavailable', label: 'Nicht verfügbar' },
]

export function toRows(slots: AvailabilitySlot[]): DayRow[] {
  return DAYS.map(({ day }) => {
    const s = slots.find((x) => x.dayOfWeek === day)
    return s ? { day, mode: s.kind, start: s.startTime, end: s.endTime } : { day, mode: 'none', start: '10:00', end: '22:00' }
  })
}

/** Returns slots or a German error message for invalid input. */
export function toSlots(rows: DayRow[]): { slots: AvailabilitySlot[]; error: string | null } {
  const active = rows.filter((r) => r.mode !== 'none')
  const bad = active.find((r) => !isTime(r.start) || !isTime(r.end) || r.start === r.end)
  if (bad) return { slots: [], error: `${DAYS.find((d) => d.day === bad.day)!.label}: Bitte gültige Zeiten im Format HH:MM angeben (Beginn ≠ Ende).` }
  return { slots: active.map((r) => ({ dayOfWeek: r.day, kind: r.mode as AvailabilityKind, startTime: r.start, endTime: r.end, note: null })), error: null }
}

export function AvailabilityEditor({ rows, onChange, editable = true }: { rows: DayRow[]; onChange: (rows: DayRow[]) => void; editable?: boolean }) {
  const update = (i: number, patch: Partial<DayRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r, i) => {
        const label = DAYS.find((d) => d.day === r.day)!.label
        return (
          <View key={r.day} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.md }}>
            <Text style={type.heading}>{label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={`${label}: Verfügbarkeit`}>
              {MODES.map((m) => {
                const active = r.mode === m.value
                return (
                  <Pressable
                    key={m.value}
                    disabled={!editable}
                    onPress={() => update(i, { mode: m.value })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${label}: ${m.label}`}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                      borderColor: active ? colors.brand : colors.lineStrong, backgroundColor: active ? colors.brandTint : colors.surface,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: active ? colors.brand : colors.inkMuted }}>{m.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            {r.mode !== 'none' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
                <TextInput
                  value={r.start}
                  onChangeText={(v) => update(i, { start: v })}
                  editable={editable}
                  accessibilityLabel={`${label} von`}
                  placeholder="10:00"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={timeStyle}
                />
                <Text style={type.muted}>bis</Text>
                <TextInput
                  value={r.end}
                  onChangeText={(v) => update(i, { end: v })}
                  editable={editable}
                  accessibilityLabel={`${label} bis`}
                  placeholder="22:00"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={timeStyle}
                />
                <Text style={type.small}>Uhr</Text>
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

const timeStyle = { minHeight: 44, minWidth: 78, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 10, fontSize: 16, color: colors.ink, backgroundColor: colors.surface }
