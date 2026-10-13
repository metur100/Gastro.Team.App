import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '@/lib/api'
import { useAuth, usePermissions } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { colors, space, type } from '@/lib/theme'
import { Card, EmptyState, ErrorState, Loading, Screen, SectionTitle } from '@/components/ui'
import { ShiftCard } from '@/components/ShiftCard'
import type { DashboardSummary, EmployeeOverview, Shift } from '@/types/api'

function Stat({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={{ flex: 1 }}>
      <Card style={{ padding: space.md }}>
        <Text style={type.small}>{label}</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink, marginTop: 4 }}>{value}</Text>
      </Card>
    </Pressable>
  )
}

export default function Today() {
  const { me } = useAuth()
  const p = usePermissions()
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<EmployeeOverview>('/dashboard/employee'), enabled: Boolean(p.employeeId) })
  const team = useQuery({ queryKey: ['today'], queryFn: () => api.get<Shift[]>('/dashboard/today'), enabled: p.isManager })
  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api.get<DashboardSummary>('/dashboard/summary'), enabled: p.isManager })
  const refreshing = overview.isRefetching || team.isRefetching || summary.isRefetching
  const refresh = () => {
    void overview.refetch()
    void team.refetch()
    void summary.refetch()
  }

  if (!me?.currentTenant)
    return (
      <Screen title={`Hallo ${me?.firstName ?? ''}`}>
        <EmptyState icon="business-outline" title="Noch keinem Betrieb zugeordnet" text="Bitte öffnen Sie den Einladungslink Ihrer Leitung, um Ihrem Team beizutreten." />
      </Screen>
    )

  const o = overview.data
  return (
    <Screen title={`Hallo ${me.firstName}`} subtitle={`${me.currentTenant.name} · ${fmt.dayLong(new Date().toISOString().slice(0, 10))}`} refreshing={refreshing} onRefresh={refresh}>
      {p.employeeId ? (
        overview.isPending ? (
          <Loading />
        ) : overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        ) : (
          o && (
            <>
              <SectionTitle>Meine nächste Schicht</SectionTitle>
              {o.nextShift ? (
                <ShiftCard shift={o.nextShift} onPress={() => router.push(`/schicht/${o.nextShift!.id}`)} />
              ) : (
                <Card><EmptyState icon="calendar-clear-outline" title="Keine anstehenden Schichten" text="Sobald ein Schichtplan veröffentlicht ist, sehen Sie Ihre Schichten hier." /></Card>
              )}
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <Stat label="Diese Woche geplant" value={fmt.hours(o.scheduledHoursThisWeek)} />
                <Stat label="Offene Anträge" value={String(o.pendingLeaveRequests)} onPress={() => router.push('/anfragen?tab=urlaub')} />
              </View>
              {o.contractHoursPerWeek != null && <Text style={[type.small, { marginTop: space.sm }]}>Vereinbart: {fmt.hours(o.contractHoursPerWeek)} pro Woche (geplante Stunden, keine erfassten Arbeitszeiten)</Text>}
              {o.openSwapOffers > 0 && (
                <Pressable onPress={() => router.push('/anfragen?tab=tausch')} accessibilityRole="button" style={{ marginTop: space.md }}>
                  <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.brandTint, borderColor: colors.brandTintStrong }}>
                    <Ionicons name="swap-horizontal" size={20} color={colors.brand} />
                    <Text style={[type.body, { flex: 1 }]}>{o.openSwapOffers} {o.openSwapOffers === 1 ? 'Schicht wird' : 'Schichten werden'} zum Tausch angeboten</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.brand} />
                  </Card>
                </Pressable>
              )}
              {o.upcomingShifts.length > 1 && (
                <>
                  <SectionTitle>Demnächst</SectionTitle>
                  {o.upcomingShifts.slice(1, 5).map((s) => (
                    <ShiftCard key={s.id} shift={s} onPress={() => router.push(`/schicht/${s.id}`)} />
                  ))}
                </>
              )}
            </>
          )
        )
      ) : null}

      {p.isManager && (
        <>
          <SectionTitle>Team heute</SectionTitle>
          {summary.data && (
            <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
              <Stat label="Im Einsatz" value={String(summary.data.employeesWorkingToday)} />
              <Stat label="Unbesetzt" value={String(summary.data.unassignedShifts)} />
              <Stat label="Freigaben" value={String(summary.data.pendingLeaveRequests + summary.data.pendingSwapRequests)} onPress={() => router.push('/anfragen?tab=freigaben')} />
            </View>
          )}
          {team.isPending ? (
            <Loading />
          ) : team.isError ? (
            <ErrorState error={team.error} onRetry={() => void team.refetch()} />
          ) : team.data.length === 0 ? (
            <Card><EmptyState title="Heute sind keine Schichten geplant" /></Card>
          ) : (
            team.data.map((s) => <ShiftCard key={s.id} shift={s} showEmployee />)
          )}
        </>
      )}
    </Screen>
  )
}
