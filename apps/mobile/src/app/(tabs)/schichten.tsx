import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { addDaysTo, todayString } from '@/lib/format'
import { ErrorState, Loading, Screen } from '@/components/ui'
import { ShiftAgenda } from '@/components/ShiftAgenda'
import type { Shift } from '@/types/api'

export default function MyShifts() {
  const from = addDaysTo(todayString(), -7)
  const to = addDaysTo(todayString(), 42)
  const q = useQuery({ queryKey: ['my-shifts', from, to], queryFn: () => api.get<Shift[]>(`/shifts/mine?from=${from}&to=${to}`) })
  return (
    <Screen title="Meine Schichten" subtitle="Veröffentlichte Schichten der kommenden Wochen" refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <ShiftAgenda shifts={q.data} onOpen={(s) => router.push(`/schicht/${s.id}`)} />}
    </Screen>
  )
}
