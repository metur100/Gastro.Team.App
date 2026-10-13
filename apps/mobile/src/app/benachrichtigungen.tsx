import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { fmt } from '@/lib/format'
import { routeForLink } from '@/lib/push'
import { colors, space, type } from '@/lib/theme'
import { Button, EmptyState, ErrorState, Loading, Screen } from '@/components/ui'
import type { Notification, Paged } from '@/types/api'

export default function Notifications() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Paged<Notification>>('/notifications?pageSize=50') })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['unread'] })])

  const open = async (n: Notification) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined)
    await refresh()
    router.push(routeForLink(n.link) as never)
  }

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Button title="Alle als gelesen markieren" variant="outline" icon="checkmark-done" onPress={() => void api.post('/notifications/read-all').then(refresh)} />
      <View style={{ marginTop: space.lg }}>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState icon="notifications-off-outline" title="Noch keine Benachrichtigungen" />
        ) : (
          q.data.items.map((n) => (
            <Pressable
              key={n.id}
              onPress={() => void open(n)}
              accessibilityRole="button"
              accessibilityLabel={`${n.readAt ? '' : 'Ungelesen: '}${n.title}. ${n.body}`}
              style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.line }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.readAt ? 'transparent' : colors.brand }} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontWeight: n.readAt ? '500' : '700' }]}>{n.title}</Text>
                <Text style={type.muted}>{n.body}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>{fmt.dateTime(n.createdAt)}</Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  )
}
