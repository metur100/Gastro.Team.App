import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useAction } from '@/lib/hooks'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay'
import type { Notification, Paged } from '@/types/api'

export default function NotificationsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const list = useQuery({
    queryKey: ['notifications', filter, page],
    queryFn: () => api.get<Paged<Notification>>(`/notifications?unreadOnly=${filter === 'unread'}&page=${page}&pageSize=20`),
  })
  const markRead = useAction({ fn: (id: string) => api.post(`/notifications/${id}/read`), invalidate: [['notifications']] })
  const markAll = useAction({ fn: () => api.post('/notifications/read-all'), success: 'Alle als gelesen markiert', invalidate: [['notifications']] })

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <PageHeader
        title="Benachrichtigungen"
        actions={
          <Button variant="outline" onClick={() => markAll.mutate()} loading={markAll.isPending}>
            <CheckCheck /> Alle als gelesen markieren
          </Button>
        }
      />
      <Tabs value={filter} onValueChange={(v) => { setFilter(v as 'all' | 'unread'); setPage(1) }}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">Alle</TabsTrigger>
          <TabsTrigger value="unread">Ungelesen</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        {list.isPending ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<Bell className="size-5" />} title={filter === 'unread' ? 'Keine ungelesenen Benachrichtigungen' : 'Noch keine Benachrichtigungen'} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cn('flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left hover:bg-subtle/60', !n.readAt && 'bg-brand-50/40')}
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', n.readAt ? 'font-medium' : 'font-semibold')}>
                      {n.title}
                      {!n.readAt && <span className="sr-only"> (ungelesen)</span>}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-muted">{n.body}</span>
                  </span>
                  <time dateTime={n.createdAt} className="shrink-0 text-xs text-ink-faint" title={fmt.dateTime(n.createdAt)}>
                    {fmt.relative(n.createdAt)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.totalCount > list.data.pageSize && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</Button>
            <Button size="sm" variant="outline" disabled={page * list.data.pageSize >= list.data.totalCount} onClick={() => setPage(page + 1)}>Weiter</Button>
          </div>
        )}
      </Card>
    </>
  )
}
