import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, space, type } from '@/lib/theme'
import { fmt } from '@/lib/format'
import type { Shift } from '@/types/api'
import { Badge } from './ui'

export function ShiftCard({ shift, onPress, showEmployee }: { shift: Shift; onPress?: () => void; showEmployee?: boolean }) {
  const cancelled = shift.status === 'Cancelled'
  const label = `${fmt.dayLong(shift.date)}, ${fmt.timeRange(shift.startTime, shift.endTime)} Uhr, ${shift.jobRoleName}${shift.locationName ? `, ${shift.locationName}` : ''}${cancelled ? ', abgesagt' : ''}`
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={({ pressed }) => [s.card, cancelled && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
    >
      <View style={[s.bar, { backgroundColor: shift.jobRoleColor }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[type.heading, cancelled && { textDecorationLine: 'line-through' }]}>{fmt.timeRange(shift.startTime, shift.endTime)} Uhr</Text>
          {shift.endsNextDay ? <Text style={type.small}>bis Folgetag</Text> : null}
          {cancelled ? <Badge label="Abgesagt" tone="danger" /> : null}
        </View>
        {showEmployee ? <Text style={type.body}>{shift.employeeName ?? 'Nicht besetzt'}</Text> : null}
        <Text style={type.muted}>
          {shift.jobRoleName}
          {shift.locationName ? ` · ${shift.locationName}` : ''}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} /> : null}
    </Pressable>
  )
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.md, marginBottom: space.sm },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
})
