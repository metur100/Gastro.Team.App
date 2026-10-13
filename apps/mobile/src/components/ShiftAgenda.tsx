import { Text, View } from 'react-native'
import { fmt, todayString } from '@/lib/format'
import { colors, space, type } from '@/lib/theme'
import type { Shift } from '@/types/api'
import { ShiftCard } from './ShiftCard'
import { EmptyState } from './ui'

/** Shifts grouped by day; used by the "Schichten" tab. */
export function ShiftAgenda({ shifts, onOpen }: { shifts: Shift[]; onOpen: (s: Shift) => void }) {
  if (shifts.length === 0)
    return <EmptyState icon="calendar-clear-outline" title="Keine Schichten im Zeitraum" text="Veröffentlichte Schichten erscheinen hier automatisch." />
  const groups = new Map<string, Shift[]>()
  for (const s of shifts) groups.set(s.date, [...(groups.get(s.date) ?? []), s])
  const today = todayString()
  return (
    <View>
      {[...groups.entries()].map(([date, list]) => (
        <View key={date} style={{ marginBottom: space.md }}>
          <Text style={[type.small, { fontWeight: '700', marginBottom: space.sm, color: date === today ? colors.brand : colors.inkMuted }]} accessibilityRole="header">
            {fmt.dayLong(date)}
            {date === today ? ' · Heute' : ''}
          </Text>
          {list.map((s) => (
            <ShiftCard key={s.id} shift={s} onPress={() => onOpen(s)} />
          ))}
        </View>
      ))}
    </View>
  )
}
