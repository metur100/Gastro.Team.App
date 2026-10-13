import { router } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Screen } from '@/components/ui'
import { LeaveForm } from '@/components/LeaveForm'

export default function NewLeave() {
  const qc = useQueryClient()
  return (
    <Screen>
      <LeaveForm
        onSubmit={async (v) => {
          await api.post('/leave-requests', v)
          await qc.invalidateQueries({ queryKey: ['leave'] })
          await qc.invalidateQueries({ queryKey: ['overview'] })
          router.back()
        }}
      />
    </Screen>
  )
}
